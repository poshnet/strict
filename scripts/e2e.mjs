// The whole stack against a local validator: the worker (wrangler dev) builds every transaction, these keypairs sign
// them like a browser wallet would. Launches coins with every rule through the API, trades, gets stopped by each rule
// (by the API and on chain), refuses a vamp, launches with a dev pass and pays its fees to whoever holds it, completes a
// curve, and lets the cranks migrate it and buy it back.
//
//   program/validator.sh &   node --experimental-require-module scripts/init-program.mjs
//   npm run db:local && npm run build && npx wrangler dev --port 8789 &   node --experimental-require-module scripts/e2e.mjs
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as P from '../worker/program.js';

const API = process.env.API || 'http://localhost:8789';
const conn = new Connection(process.env.RPC || 'http://127.0.0.1:8899', 'confirmed');
const ADMIN = readFileSync(new URL('../keys/ADMIN_KEY.txt', import.meta.url), 'utf8').trim();
const FEE = readFileSync(new URL('../keys/fee-wallet.address.txt', import.meta.url), 'utf8').trim();
const kols = JSON.parse(readFileSync(new URL('../data/kols.json', import.meta.url))).kols;
let passed = 0;
// a trade's indexing runs after its response (waitUntil): poll a read until it shows, up to a few seconds
const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await new Promise((r) => setTimeout(r, 400)); } };
const ok = (c, what) => { if (!c) throw new Error(`FAILED: ${what}`); passed++; console.log(`  ✓ ${what}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, headers = {}) {
  const r = await fetch(API + path, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const fund = async (kp, sol) => conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
const signB64 = (b64, kp) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign([kp]); return Buffer.from(tx.serialize()).toString('base64'); };

/** a 512 x 512 RGB PNG drawn by fn(x, y) -> [r, g, b] (the launch form sends the same kind) */
function png(fn) {
  const w = 512, h = 512;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const swell = (x, y) => 128 + 100 * Math.sin(x / 70 + y / 90) * Math.cos(y / 110);
const ART = {
  ramp: png((x, y) => { const v = swell(x, y); return [v, v, 255 - v]; }),
  rampCopy: png((x, y) => { const v = swell(x, y) * 0.85 + 25; return [v, v * 0.9, 255 - v]; }), // the same picture, recoloured
  stripes: png((x) => (x % 150 < 75 ? [20, 20, 30] : [91, 155, 255])),
  checks: png((x, y) => ((Math.floor(x / 64) + Math.floor(y / 64)) % 2 ? [230, 232, 235] : [14, 16, 19])),
  ring: png((x, y) => (Math.abs(Math.hypot(x - 256, y - 256) - 150) < 40 ? [61, 220, 151] : [14, 16, 19])),
  wave: png((x, y) => [128 + 120 * Math.sin(x / 30), 128 + 120 * Math.cos(y / 45), 90]),
};
async function upload(name) {
  const r = await fetch(`${API}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: ART[name] });
  return r.json();
}

async function launch(creator, meta, wallets, devBuySol = 0) {
  const prep = await api('/api/launch/prepare', { creator: creator.publicKey.toBase58(), ...meta, wallets, devBuySol });
  if (prep.status !== 200) throw Object.assign(new Error(`prepare: ${prep.error}`), { res: prep });
  const signed = prep.txs.map((t) => signB64(t.tx, creator));
  const r = await fetch(`${API}/api/launch/${prep.id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txs: signed }) });
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  const end = lines[lines.length - 1];
  if (end.step !== 'done') throw new Error(`submit: ${end.error}`);
  return { prep, lines, mint: end.mint };
}

async function trade(kp, mint, body) {
  const b = await api('/api/trade', { wallet: kp.publicKey.toBase58(), mint, ...body });
  if (b.status !== 200) return b;
  const sent = await api('/api/send', { tx: signB64(b.tx, kp), lastValidBlockHeight: b.lastValidBlockHeight });
  return { ...b, ...sent };
}
const admin = (task) => api(`/api/admin/run?task=${task}`, {}, { 'x-admin-key': ADMIN });

/** a buy sent straight to the program, skipping preflight: it lands on chain and fails with the rule's error */
async function rawBuy(kp, mint, lamports) {
  const m = new PublicKey(mint);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, getAssociatedTokenAddressSync(m, kp.publicKey), kp.publicKey, m),
    P.buyIx(kp.publicKey, m, FEE, lamports, 0n),
  );
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, 'confirmed').catch(() => {});
  return sig;
}

console.log('strict.fun e2e through the API');
const creator = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), doorman = Keypair.generate(), carol = Keypair.generate(), whale = Keypair.generate();
const ops = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('../keys/ops.json', import.meta.url)))));
await Promise.all([fund(creator, 30), fund(alice, 50), fund(bob, 200), fund(doorman, 10), fund(carol, 40), fund(whale, 20), fund(ops, 5)]);

console.log('config');
const cfg = await api('/api/config');
ok(cfg.launches && cfg.siteName === 'strict.fun', 'launches are open on strict.fun');
ok(cfg.kolCount > 500 && cfg.maxWalletRange?.[1] === 1000 && cfg.rulesDefault?.kols, `the rules' defaults and ranges are served (${cfg.kolCount} KOLs on the default list)`);

console.log('launch with the KOL list and no vamps');
const art = await upload('ramp');
ok(art.url?.includes('/media/coin/') && /^[0-9a-f]{16}$/.test(art.hash), `picture uploaded and fingerprinted (${art.hash})`);
const big = kols.filter((k) => k.followers >= 10_000).map((k) => k.wallet);
const listWallets = [...big, doorman.publicKey.toBase58()];
const a = await launch(creator, { name: 'Velvet Rope', symbol: 'ROPE', description: 'Every KOL with 10k followers waits outside.', image: art.url, twitter: 'x.com/ropecoin', noVamps: true }, listWallets, 0.5);
ok(a.mint, `launched $ROPE (${a.prep.txs.length} transactions, ${a.lines.filter((l) => l.step === 'list').length} list steps streamed)`);
let coin = await api(`/api/coin/${a.mint}`);
ok(coin.coin.blocked === listWallets.length && coin.coin.rules.kols && coin.coin.rules.vamps, `${coin.coin.blocked} wallets on its list (${coin.coin.kolsBlocked} KOLs) and no vamps`);
ok(coin.coin.ruleCount === 2, 'it counts 2 rules');
ok(coin.live.blocked === listWallets.length && coin.live.listHash === coin.coin.listHash, 'the chain agrees: count and hash');
ok(coin.coin.listHash === (await P.listHash(listWallets)), 'the hash is the sha256 of the sorted list');
const meta = await (await fetch(`${API}/m/${a.mint}.json`)).json();
ok(meta.name === 'Velvet Rope' && meta.image === art.url, 'the metadata json serves');
const list = await api(`/api/coin/${a.mint}/list`);
ok(list.people.length > 200 && list.othersCount === 1, `list API: ${list.people.length} KOLs reaching ${list.reach.toLocaleString()} followers, 1 other wallet`);

console.log('no vamps');
const copyArt = await upload('rampCopy');
let v = await api('/api/vamp-check', { symbol: 'R0PE', name: 'Fresh Coin', twitter: 'https://x.com/ropecoin', imageHash: copyArt.hash });
ok(!v.ticker.ok && !v.x.ok && !v.picture.ok && v.name.ok, `the live panel flags the lookalike ticker (${v.ticker.reason}), the X account and the recoloured picture`);
v = await api('/api/vamp-check', { symbol: 'FRESH', name: 'Fresh Coin', imageHash: (await upload('wave')).hash });
ok(v.ticker.ok && v.name.ok && v.picture.ok, 'an original coin passes');
const vamp = await api('/api/launch/prepare', { creator: carol.publicKey.toBase58(), name: 'Baby Rope', symbol: 'ROPEINU', image: (await upload('checks')).url, wallets: [] });
ok(vamp.status === 409 && /no-vamps/.test(vamp.error), 'a copy is refused at launch');
const copyPic = await api('/api/launch/prepare', { creator: carol.publicKey.toBase58(), name: 'Other', symbol: 'OTHER', image: copyArt.url, wallets: [] });
ok(copyPic.status === 409, 'so is a launch with the protected picture');

console.log('trading and the KOL list');
let t = await trade(alice, a.mint, { side: 'buy', sol: 2 });
ok(t.signature && t.venue === 'curve', 'alice buys 2 SOL on the curve');
t = await trade(alice, a.mint, { side: 'sell', pct: 50 });
ok(t.signature, 'alice sells half');
t = await trade(doorman, a.mint, { side: 'buy', sol: 1 });
ok(t.status === 403 && t.rule === 'kols', 'the listed wallet is refused by the API, naming the rule');
await rawBuy(doorman, a.mint, 1_000_000_000n);
await sleep(800);
await admin('index');
const feed = await api('/api/feed');
ok(feed.events.some((e) => e.kind === 'bounce' && e.rule === 'kols' && e.wallet === doorman.publicKey.toBase58()), 'its on-chain attempt failed and shows in the live log under no KOLs');
let stops = await api(`/api/coin/${a.mint}/stops`);
ok(stops.counts.kols === 1 && stops.counts.vamps === 2 && stops.events[0].rule === 'kols', `the coin's stops: ${stops.counts.kols} KOL buy, ${stops.counts.vamps} copies refused`);

console.log('more coins for the board');
const b = await launch(carol, { name: 'Brass Post', symbol: 'POST', description: 'Top 30 KOLs kept out.', image: (await upload('stripes')).url }, kols.slice(0, 30).map((k) => k.wallet), 1);
ok(b.mint, 'launched $POST with a top-30 list');
const c = await launch(bob, { name: 'Open Door', symbol: 'OPEN', description: 'No rules. Come on in.', image: (await upload('ring')).url }, [], 0);
ok(c.mint, 'launched $OPEN with no rules');
for (const [kp, sol] of [[carol, 3], [alice, 1.5], [bob, 6]]) await trade(kp, b.mint, { side: 'buy', sol });
await trade(alice, c.mint, { side: 'buy', sol: 0.8 });

console.log('no snipers and no dev buy');
const optArt = (await upload('checks')).url;
const opt = await launch(alice, { name: 'Shield Wall', symbol: 'SHLD', description: 'Sniper curve and no dev buy.', image: optArt, shield: { kind: 'linear', secs: 30 }, noDevBuy: true }, kols.slice(30, 40).map((k) => k.wallet), 0);
const snipe = await trade(carol, opt.mint, { side: 'buy', sol: 1, slippageBps: 5000 });
ok(snipe.signature, 'a sniper buys into the curve right after launch');
coin = await api(`/api/coin/${opt.mint}`);
ok(coin.coin.shield?.secs === 30 && coin.coin.noDevBuy && coin.live.shieldKind === 1 && coin.coin.ruleCount === 3, 'a coin launches with a 30 s linear sniper curve, no dev buy and a list');
const replay = await api(`/api/coin/${opt.mint}/sniper`);
const hit = replay.trades?.find((x) => x.wallet === carol.publicKey.toBase58());
ok(hit && hit.feePct > 50 && replay.taxedSol > 0.4, `the replay shows the sniper paid ${hit?.feePct.toFixed(0)}% (${replay.taxedSol?.toFixed(3)} SOL to the buyback)`);
stops = await api(`/api/coin/${opt.mint}/stops`);
ok(stops.sniperBuys === 1 && stops.sniperSol > 0.4, `the stops endpoint counts it: ${stops.sniperSol.toFixed(3)} SOL paid by ${stops.sniperBuys} sniper`);
t = await api('/api/trade', { wallet: alice.publicKey.toBase58(), mint: opt.mint, side: 'buy', sol: 0.1 });
ok(t.status === 403 && t.rule === 'dev', "the creator's buy is refused on a no-dev-buy coin");
const nod = await api('/api/launch/prepare', { creator: carol.publicKey.toBase58(), name: 'Nope', symbol: 'NOPE', image: optArt, noDevBuy: true, devBuySol: 1 });
ok(nod.status === 400, 'no dev buy and a first buy together are refused');

console.log('no bundles and the max wallet');
const nb = await api('/api/launch/prepare', { creator: carol.publicKey.toBase58(), name: 'Nope', symbol: 'NOPE', image: optArt, noBundles: true, devBuySol: 0.5 });
ok(nb.status === 400 && /launch block/.test(nb.error), "no bundles and a first buy together are refused (it would land in the launch block)");
const badCap = await api('/api/launch/prepare', { creator: carol.publicKey.toBase58(), name: 'Nope', symbol: 'NOPE', image: optArt, maxWalletBps: 2000 });
ok(badCap.status === 400, 'a max wallet over 10% is refused');
const mw = await launch(whale, { name: 'Fair Share', symbol: 'FAIR', description: 'No bundles, 2% max wallet.', image: (await upload('wave')).url, noBundles: true, maxWalletBps: 200 }, [], 0);
coin = await api(`/api/coin/${mw.mint}`);
ok(coin.coin.rules.bundles && coin.coin.rules.maxWalletBps === 200 && coin.live.createdSlot > 0, `launched $FAIR with no bundles (slot ${coin.live.createdSlot}) and a 2% max wallet`);
while ((await conn.getSlot('confirmed')) <= coin.live.createdSlot) await sleep(200); // nothing buys in the launch slot
t = await trade(carol, mw.mint, { side: 'buy', sol: 0.3 });
ok(t.signature, 'a buy under the cap goes through');
t = await trade(carol, mw.mint, { side: 'buy', sol: 0.5 });
ok(t.status === 403 && t.rule === 'maxWallet' && t.capTokens === 20_000_000, `the next buy would pass 2% and the API says so: "${t.error}"`);
await rawBuy(carol, mw.mint, 500_000_000n);
await sleep(800);
await admin('index');
stops = await api(`/api/coin/${mw.mint}/stops`);
ok(stops.counts.maxWallet === 1, 'sent straight to the program it fails with OverCap, logged under max wallet');

console.log('dev pass');
const dana = Keypair.generate(), eve = Keypair.generate();
await Promise.all([fund(dana, 10), fund(eve, 2)]);
const dp = await launch(dana, { name: 'Pass Holder', symbol: 'DPASS', description: 'The creator fees go to whoever holds the dev pass.', image: (await upload('ring')).url, pass: true }, [], 0.5);
ok(dp.prep.txs.map((x) => x.kind).join() === 'pass,launch' && dp.lines.some((l) => l.step === 'pass'), 'with a first buy, the pass is minted in its own transaction, then the launch');
coin = await api(`/api/coin/${dp.mint}`);
const passKey = coin.coin.pass;
ok(passKey && (await conn.getAccountInfo(P.curvePda(dp.mint))) && P.decodeCurve((await conn.getAccountInfo(P.curvePda(dp.mint))).data).pass === passKey, 'the coin and its curve record the same dev pass');
let ps = await api(`/api/coin/${dp.mint}/pass`);
ok(!ps.locked && ps.holder === dana.publicKey.toBase58(), 'the pass is minted to the creator (its holder read from chain)');
const pj = await (await fetch(`${API}/p/${dp.mint}.json`)).json();
ok(pj.name === '$DPASS dev pass' && pj.image === coin.coin.image && pj.external_url.endsWith(`/coin/${dp.mint}`), "the NFT's metadata names the coin, its picture and what it earns");
{
  const tx = new Transaction().add(P.passTransferIx(passKey, dana.publicKey, eve.publicKey));
  tx.feePayer = dana.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(dana);
  await conn.confirmTransaction(await conn.sendRawTransaction(tx.serialize()), 'confirmed');
}
t = await trade(alice, dp.mint, { side: 'buy', sol: 4 });
ok(t.signature, 'dana sells the pass to eve (here: sends it), and alice buys');
const eveBefore = await conn.getBalance(eve.publicKey);
let run = await admin('crank');
await admin('index');
const eveGot = (await conn.getBalance(eve.publicKey)) - eveBefore;
// the pass endpoint caches for 10 s: wait for a fresh read
ps = await until(async () => { const r = await api(`/api/coin/${dp.mint}/pass`); return r.holder === eve.publicKey.toBase58() && r.payouts.length ? r : null; }, 15_000);
ok(run.crank.paid >= 1 && eveGot > 0 && ps, `the payout crank paid the pass's holder now, eve (${(eveGot / 1e9).toFixed(4)} SOL), not the creator`);
ok(ps.payouts.length === 1 && ps.payouts[0].wallet === eve.publicKey.toBase58() && ps.owedSol === 0, 'the payout is logged against eve, and nothing is left owed');
const dp2 = await launch(eve, { name: 'Pass Atomic', symbol: 'DPAS2', image: (await upload('wave')).url, pass: true }, [], 0);
ok(dp2.prep.txs.map((x) => x.kind).join() === 'launch', 'without a first buy, the pass is minted in the launch transaction itself');
ps = await api(`/api/coin/${opt.mint}`).then(() => api(`/api/coin/${opt.mint}/pass`));
ok(ps.locked && ps.holder === alice.publicKey.toBase58(), "a coin launched without one is locked to its creator's wallet");

console.log('the board');
const strictest = await api('/api/coins?sort=strictest');
ok(strictest.coins[0].ruleCount >= strictest.coins[strictest.coins.length - 1].ruleCount && strictest.coins[0].mint === opt.mint, `"strictest" puts $${strictest.coins[0].symbol} (${strictest.coins[0].ruleCount} rules) first`);
ok(strictest.coins.find((x) => x.mint === a.mint).stopped >= 1, 'coin cards carry how many buys their rules stopped');

console.log('proof');
const sim = await api('/api/simulate', { mint: b.mint });
ok(sim.bounced?.error === 'Bounced' && sim.bounced.logs.some((l) => l.includes('Error Code: Bounced')), `simulated buy from ${sim.bounced?.kol?.name || 'a listed wallet'}: the program says Bounced`);
ok(sim.control?.ok === true, 'the same buy from a wallet off the list goes through');

console.log('bonding');
t = await trade(bob, a.mint, { side: 'buy', sol: 120 });
ok(t.signature && t.quote.completes, 'bob buys the rest: the curve completes');
coin = await until(async () => { const r = await api(`/api/coin/${a.mint}`); return r.coin?.status === 'complete' ? r : null; }) || await api(`/api/coin/${a.mint}`);
ok(coin.coin.status === 'complete', 'the index marks it complete');
run = await admin('crank');
ok(run.crank.migrated === 1, 'the crank migrated it into its Raydium pool');
// the crank waits 5 s (on the chain's clock) after migrating before it buys back
run = await until(async () => { const r = await admin('crank'); return r.crank.boughtBack ? r : null; }, 20_000) || { crank: {} };
ok(run.crank.boughtBack === 1, 'and bought it back with the list rent');
coin = await api(`/api/coin/${a.mint}`);
ok(coin.coin.status === 'migrated' && coin.coin.boughtBack && coin.coin.burnedTokens > 0, `$ROPE bonded: ${Math.round(coin.coin.burnedTokens).toLocaleString()} tokens bought back and burned`);
t = await api('/api/trade', { wallet: doorman.publicKey.toBase58(), mint: a.mint, side: 'buy', sol: 1 });
ok(t.status !== 403, 'the listed wallet is no longer refused (it routes to the pool now)');

console.log('reads');
const stats = await api('/api/stats');
ok(stats.coins === 7 && stats.bonded === 1 && stats.stopped >= 2, `stats: ${stats.coins} coins, ${stats.stopped} buys stopped, ${stats.avgRules.toFixed(1)} rules a coin`);
const check = await api(`/api/check/${big[0]}`);
ok(check.kol && check.coins.length >= 1, `the top KOL (${check.kol.name}) is on ${check.coins.length} list(s)`);
const dir = await api('/api/kols');
ok(dir.kols.some((k) => k.bouncedBy >= 2), 'the directory counts the coins keeping each KOL out');
const page = await (await fetch(`${API}/coin/${a.mint}`)).text();
ok(page.includes('Velvet Rope ($ROPE)') && page.includes('strict rule'), 'the coin page unfurls with its own title and its rules');
const candles = await api(`/api/coin/${b.mint}/candles?tf=1m`);
ok(candles.candles.length >= 1, 'candles build from trades');
console.log(`\nall ${passed} checks passed\n  ROPE ${a.mint}\n  POST ${b.mint}\n  OPEN ${c.mint}\n  SHLD ${opt.mint}\n  FAIR ${mw.mint}\n  DPASS ${dp.mint}\n  DPAS2 ${dp2.mint}`);
