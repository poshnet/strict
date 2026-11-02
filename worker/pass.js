// Dev passes. A creator can launch with their creator fees locked to their wallet (the default: the program pays nobody
// else, ever) or held by a dev pass: a 1-of-1 Metaplex Core NFT, minted to them at launch, that only the coin's curve
// can update. The program pays the creator fees (0.3% of every trade until it bonds) to whoever holds the pass when
// they're paid out, so selling or sending it hands them on. The pick is fixed at launch like the rules.
//   passKey      the pass's key, derived from the mint's (so a resumed launch makes the same one, and none is stored)
//   passMeta     its name and uri, as the launch mints it
//   passJson     /p/<mint>.json, the NFT's metadata (the coin's picture, what it earns)
//   passStatus   /api/coin/:mint/pass: who holds it now (read from chain), what's owed and what's been paid, to whom
import * as P from './program.js';
import { Keypair, connection, pk } from './sol.js';
import { json } from './util.js';

export async function passKey(mintKp) {
  const seed = await crypto.subtle.digest('SHA-256', Buffer.concat([Buffer.from('strict.fun dev pass'), Buffer.from(mintKp.secretKey.subarray(0, 32))]));
  return Keypair.fromSeed(new Uint8Array(seed));
}

export const passMeta = (c, meta, mint) => ({ name: `$${meta.symbol} dev pass`.slice(0, P.PASS_NAME_MAX), uri: `${c.siteUrl}/p/${mint}.json` });

const pctOf = (bps) => `${bps / 100}%`;

/** the pass's off-chain metadata: what wallets and marketplaces show */
export async function passJson(env, c, mint) {
  const row = await env.DB.prepare('SELECT name, symbol, image, pass FROM coins WHERE mint = ?').bind(mint).first()
    || await env.DB.prepare('SELECT meta FROM launches WHERE mint = ?').bind(mint).first().then((r) => (r ? JSON.parse(r.meta) : null));
  if (!row || !(row.pass || row.passAsset)) return json({ error: 'no dev pass for that mint' }, 404);
  const share = pctOf(c.params.creatorFeeBps);
  return json({
    name: `$${row.symbol} dev pass`.slice(0, P.PASS_NAME_MAX), symbol: 'DEVPASS', image: row.image,
    description: `The dev pass for $${row.symbol} (${row.name}) on ${c.siteName}. Whoever holds it is paid the coin's creator fees, ${share} of every trade until it bonds, straight from the program. Sell or send it and the fees go with it.`,
    external_url: `${c.siteUrl}/coin/${mint}`,
    attributes: [{ trait_type: 'Coin', value: `$${row.symbol}` }, { trait_type: 'Earns', value: `${share} of every trade until it bonds` }, { trait_type: 'Mint', value: mint }],
    properties: { category: 'image', files: row.image ? [{ uri: row.image, type: 'image/png' }] : [] },
  }, 200, { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
}

/** a coin's pass: its holder right now, what the curve owes them, and what's been paid out (and to whom) */
export async function passStatus(env, c, mint) {
  const row = await env.DB.prepare('SELECT mint, creator, pass, status, creator_paid_sol FROM coins WHERE mint = ?').bind(mint).first();
  if (!row) return null;
  const base = { mint, locked: !row.pass, creator: row.creator, earnsBps: c.params.creatorFeeBps, paidSol: row.creator_paid_sol || 0 };
  const { results: paid } = await env.DB.prepare('SELECT wallet, SUM(sol) sol, COUNT(*) n, MAX(ts) last FROM claims WHERE mint = ? GROUP BY wallet ORDER BY last DESC LIMIT 12').bind(mint).all();
  const conn = connection(c.rpcUrl);
  const [curveInfo, passInfo] = await conn.getMultipleAccountsInfo([P.curvePda(mint), ...(row.pass ? [pk(row.pass)] : [])], 'confirmed');
  const cv = curveInfo ? P.decodeCurve(curveInfo.data) : null;
  const holder = row.pass ? P.passHolder(passInfo) : row.creator;
  return {
    ...base, pass: row.pass || null, holder, burned: !!row.pass && !holder,
    owedSol: cv ? Number(cv.creatorFees) / 1e9 : 0, bonded: row.status === 'migrated' || !!cv?.migrated,
    payouts: paid.map((p) => ({ wallet: p.wallet, sol: p.sol, count: p.n, last: p.last })),
  };
}
