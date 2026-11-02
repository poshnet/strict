// A launch, start to finish. `prepare` checks the coin, picks its mint key and builds every transaction it takes: the
// list (open + the first wallets, then up to 28 wallets each, in ascending order) and the launch itself (mint,
// metadata, the whole supply into the curve, mint authority revoked, `create` sealing the list, and the creator's
// optional first buy). The mint key signs here; the creator's wallet signs them all at once in the browser. `submit`
// checks each signed transaction is exactly what was handed out, sends the list in order, then the launch.
// The rules ride in `create`: the list (no KOLs), the snipe shield (no snipers), no dev buy, no bundles and the max
// wallet are the program's; no vamps is checked here, before anything is signed. So does who the creator fees go to:
// the creator's wallet, or a dev pass (pass.js), minted in the launch transaction, or just before it when a first buy
// leaves no room.
import { MINT_SIZE, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { decryptSecret, encryptSecret } from './crypto.js';
import * as P from './program.js';
import { indexSignature } from './indexer.js';
import { recordCoin } from './market.js';
import { passKey, passMeta } from './pass.js';
import { Keypair, VersionedTransaction, buildTx, connection, pk, sendAndConfirm } from './sol.js';
import { HttpError, b64decode, b64encode, isBase58Address, randomId, sha256hex } from './util.js';
import { uncache } from './cache.js';
import { vampCheck, vampFailures } from './vamp.js';

const METADATA_RENT = 5_616_720; // a Metaplex metadata account (679 bytes)
const METAPLEX_FEE = 10_000_000; // Metaplex's create fee
const FIRST_CHUNK = 22; // open_list and the mint's signature share the first transaction

const PASS_RENT = P.rentExempt(1 + 32 + 33 + 4 + P.PASS_NAME_MAX + 4 + 120 + 1); // a dev pass, at its longest

/** what launching costs the creator, in lamports, before any first buy */
export function launchCost(listed, pass = false) {
  const rent = P.rentExempt(MINT_SIZE) + METADATA_RENT + METAPLEX_FEE + P.rentExempt(165) + P.rentExempt(8 + 261) + P.rentExempt(0) + (pass ? PASS_RENT : 0);
  const txs = 1 + (pass ? 1 : 0) + (listed ? 1 + Math.ceil(Math.max(0, listed - FIRST_CHUNK) / P.MAX_ADD) : 0);
  return { rent, list: P.listRent(listed), fees: txs * 30_000, txs };
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const url = (s) => {
  const v = clean(s, 200);
  if (!v) return null;
  const u = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try { return new URL(u).toString(); } catch { throw new HttpError(400, `"${v}" isn't a link.`); }
};

function checkMeta(c, b) {
  const name = clean(b.name, 32);
  const symbol = clean(b.symbol, 10).replace(/^\$/, '').toUpperCase();
  if (!name) throw new HttpError(400, 'Give your coin a name.');
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new HttpError(400, 'The ticker is 1 to 10 letters or numbers.');
  if (Buffer.byteLength(name) > 32) throw new HttpError(400, 'That name is too long.');
  const image = clean(b.image, 300);
  if (!image.startsWith(`${c.siteUrl}/media/`) && !image.startsWith('/media/')) throw new HttpError(400, 'Add a picture for your coin.');
  return {
    name, symbol, description: clean(b.description, 600),
    image: image.startsWith('/') ? `${c.siteUrl}${image}` : image,
    twitter: url(b.twitter), telegram: url(b.telegram), website: url(b.website),
  };
}

/**
 * The rules besides the list: no snipers (a snipe shield { kind, secs }, or none), no dev buy, no bundles, the max wallet
 * (basis points of the supply, 0 for none) and no vamps. And `pass`: the creator fees go to a dev pass, not the wallet.
 */
function checkOptions(c, b, devBuy) {
  let shield = null;
  if (b.shield && b.shield.kind) {
    const kind = b.shield.kind === 'linear' ? 'linear' : 'exponential';
    const secs = Math.round(Number(b.shield.secs));
    const [lo, hi] = P.SHIELD_RANGE[kind];
    if (!(secs >= lo && secs <= hi)) throw new HttpError(400, `A ${kind} snipe shield lasts ${lo} to ${hi} seconds.`);
    shield = { kind, secs };
  }
  const noDevBuy = !!b.noDevBuy;
  const noBundles = !!b.noBundles;
  const maxWalletBps = Math.round(Number(b.maxWalletBps || 0));
  const [mlo, mhi] = P.MAX_WALLET_RANGE;
  if (maxWalletBps && !(maxWalletBps >= mlo && maxWalletBps <= mhi)) throw new HttpError(400, `A max wallet is ${mlo / 100}% to ${mhi / 100}% of the supply.`);
  if (noDevBuy && devBuy > 0) throw new HttpError(400, "No dev buy is on, so the launch can't include your first buy.");
  // the first buy rides in the launch transaction, which is the launch block
  if (noBundles && devBuy > 0) throw new HttpError(400, "No bundles is on, so nothing can buy in the launch block, your first buy included. Buy once it's live.");
  if (maxWalletBps && devBuy > 0) {
    const q = P.quoteBuy(c.params, devBuy);
    if (q.tokens > P.walletCap({ maxWalletBps, tokenSupply: c.params.tokenSupply })) throw new HttpError(400, `Your first buy would pass the ${maxWalletBps / 100}% max wallet. Buy less.`);
  }
  return { shield, noDevBuy, noBundles, maxWalletBps, noVamps: !!b.noVamps, pass: !!b.pass };
}

/** the picture's fingerprint, worked out when it was uploaded (media.js), from its /media path */
async function pictureHash(env, image) {
  const key = String(image || '').split('/media/')[1];
  if (!key) return null;
  return (await env.DB.prepare('SELECT img_hash FROM media WHERE key = ?').bind(key).first())?.img_hash || null;
}

/** The live anti-vamp panel on the launch page: each part as it's typed, against every live coin that picked no vamps. */
export async function vampPanel(env, c, b) {
  const imgHash = /^[0-9a-f]{16}$/.test(String(b.imageHash || '')) ? b.imageHash : await pictureHash(env, b.image);
  const v = await vampCheck(env, c, { symbol: clean(b.symbol, 10), name: clean(b.name, 32), twitter: clean(b.twitter, 200) || null, imgHash });
  return Object.fromEntries(Object.entries(v).map(([k, r]) => [k, r && { ok: r.ok, reason: r.reason }]));
}

/** No vamps: refuse a coin that copies a protected one, and note the stop against the coin it would have copied. */
async function noVamps(env, c, meta) {
  const imgHash = await pictureHash(env, meta.image);
  const v = await vampCheck(env, c, { symbol: meta.symbol, name: meta.name, twitter: meta.twitter, imgHash });
  const fails = vampFailures(v);
  if (fails.length) {
    // one stop for each protected coin it copied (a reserved ticker copies nobody)
    const hits = new Map();
    for (const [part, r] of Object.entries(v)) if (r && !r.ok && r.mint && !hits.has(r.mint)) hits.set(r.mint, part);
    const now = Date.now();
    if (hits.size) await env.DB.batch([...hits].map(([mint, part]) => env.DB.prepare('INSERT INTO vamp_stops (mint, part, ts) VALUES (?, ?, ?)').bind(mint, part, now)));
    const strip = Object.fromEntries(Object.entries(v).map(([k, r]) => [k, r && { ok: r.ok, reason: r.reason }]));
    throw new HttpError(409, `That copies a coin protected by its no-vamps rule. ${fails.join('; ')}.`, { vamp: strip });
  }
  return imgHash;
}

function checkWallets(c, list, creator) {
  if (!Array.isArray(list)) return [];
  const bad = list.find((w) => !isBase58Address(w));
  if (bad) throw new HttpError(400, `"${String(bad).slice(0, 48)}" isn't a Solana wallet.`);
  // the creator can't bounce their own first buy
  const sorted = P.sortWallets(list.filter((w) => w !== creator)).map((k) => k.toBase58());
  if (sorted.length > c.listMax) throw new HttpError(400, `A list holds at most ${c.listMax} wallets.`);
  return sorted;
}

/** a mint key: one ground to end in "str" when the pool has one, else a fresh one */
async function mintKey(env) {
  const row = await env.DB.prepare("UPDATE mint_pool SET used = 1 WHERE mint = (SELECT mint FROM mint_pool WHERE used = 0 LIMIT 1) RETURNING mint, secret").first();
  if (row) return Keypair.fromSecretKey(await decryptSecret(env, row.secret, row.mint));
  return Keypair.generate();
}

/**
 * The list's transactions from `from` (wallets already on chain), then the launch, all on one blockhash. A dev pass
 * (`pass`: its key, and `made` if a resumed launch already minted it) goes in the launch when it fits, else just before.
 */
function buildAll(c, { creator, mint, wallets, from, meta, devBuy, blockhash, opened, pass = null, passSeparate = false }) {
  const txs = [];
  let rest = wallets.slice(from);
  if (!opened && wallets.length) {
    const first = rest.slice(0, FIRST_CHUNK);
    rest = rest.slice(FIRST_CHUNK);
    txs.push({ kind: 'list', count: first.length, mintSigns: true, tx: buildTx(creator, [P.openListIx(creator, mint), P.addToListIx(creator, mint, first.map(pk))], blockhash, { cu: 40_000, priority: c.priority }) });
  }
  for (const chunk of P.chunk(rest, P.MAX_ADD)) {
    txs.push({ kind: 'list', count: chunk.length, tx: buildTx(creator, [P.addToListIx(creator, mint, chunk.map(pk))], blockhash, { cu: 30_000, priority: c.priority }) }); // ~13k used
  }
  const pm = pass && { asset: pass.key.publicKey, ...passMeta(c, meta, mint.toBase58()), made: pass.made || passSeparate };
  if (pass && !pass.made && passSeparate) {
    txs.push({ kind: 'pass', passSigns: true, tx: buildTx(creator, [P.passCreateIx({ ...pm, payer: creator, owner: creator, mint })], blockhash, { cu: 60_000, priority: c.priority }) });
  }
  const ixs = P.launchIxs({ creator, mint, name: meta.name, symbol: meta.symbol, uri: `${c.siteUrl}/m/${mint.toBase58()}.json`, shield: meta.shield,
    noDevBuy: meta.noDevBuy, noBundles: meta.noBundles, maxWalletBps: meta.maxWalletBps, pass: pm });
  if (devBuy > 0) {
    const q = P.quoteBuy(c.params, devBuy);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(creator, getAssociatedTokenAddressSync(mint, creator), creator, mint));
    ixs.push(P.buyIx(creator, mint, c.feeWallet, devBuy, q.tokens)); // nothing trades before it: the quote is exact
  }
  txs.push({ kind: 'launch', mintSigns: true, passSigns: !!pass && !pm.made, tx: buildTx(creator, ixs, blockhash, { cu: 300_000, priority: c.priority }) });
  return txs;
}

/** the limits every launch passes: the day's cap, one launch per wallet every few minutes, one ticker an hour */
async function gate(env, c, creator, meta) {
  const day = await env.DB.prepare("SELECT COUNT(*) n FROM coins WHERE created_at > ?").bind(Date.now() - 86_400_000).first();
  if (day.n >= c.launchDailyMax) throw new HttpError(429, 'Today is full. Launches open again soon.');
  const recent = await env.DB.prepare('SELECT created_at FROM coins WHERE creator = ? ORDER BY created_at DESC LIMIT 1').bind(creator).first();
  if (recent && Date.now() - recent.created_at < c.launchCooldownMs) throw new HttpError(429, 'You just launched. Give it a minute.');
  const taken = await env.DB.prepare("SELECT mint FROM coins WHERE symbol = ? AND created_at > ? LIMIT 1").bind(meta.symbol, Date.now() - 3_600_000).first();
  if (taken) throw new HttpError(409, `$${meta.symbol} launched here in the last hour. Pick another ticker.`);
}

const devBuyOf = (c, body) => {
  const devBuy = Math.round(Number(body.devBuySol || 0) * 1e9);
  if (!(devBuy >= 0) || devBuy > c.devBuyMaxLamports) throw new HttpError(400, `A first buy is 0 to ${c.devBuyMaxLamports / 1e9} SOL.`);
  return devBuy;
};

export async function prepare(env, c, body) {
  if (!c.launches || !c.feeWallet) throw new HttpError(503, 'Launches open soon. Everything else works: look around.');
  const creator = String(body?.creator || '');
  if (!isBase58Address(creator)) throw new HttpError(400, 'Connect a wallet first.');
  const conn = connection(c.rpcUrl);

  let row, meta, wallets, devBuy, mintKp;
  if (body.resume) {
    row = await env.DB.prepare('SELECT * FROM launches WHERE id = ? AND creator = ?').bind(String(body.resume), creator).first();
    if (!row || row.status === 'live') throw new HttpError(404, 'Nothing to resume.');
    meta = JSON.parse(row.meta);
    wallets = JSON.parse(row.wallets);
    devBuy = row.dev_buy;
    mintKp = Keypair.fromSecretKey(await decryptSecret(env, row.mint_secret, row.mint));
  } else {
    meta = checkMeta(c, body);
    wallets = checkWallets(c, body.wallets, creator);
    devBuy = devBuyOf(c, body);
    Object.assign(meta, checkOptions(c, body, devBuy));
    await gate(env, c, creator, meta);
    meta.imgHash = await noVamps(env, c, meta);
    mintKp = await mintKey(env);
  }
  const mint = mintKp.publicKey;
  const creatorKey = pk(creator);

  const passKp = meta.pass ? await passKey(mintKp) : null;
  if (passKp) meta.passAsset = passKp.publicKey.toBase58();

  // where the list stands on chain (a resumed launch may have part of it already, or its dev pass)
  const [listInfo, curveInfo, balance, passInfo] = await Promise.all([
    conn.getAccountInfo(P.listPda(mint)), conn.getAccountInfo(P.curvePda(mint)), conn.getBalance(creatorKey),
    passKp ? conn.getAccountInfo(passKp.publicKey) : null,
  ]);
  if (curveInfo) throw new HttpError(409, 'This coin is already live.');
  let from = 0, opened = false;
  if (listInfo) {
    const l = P.decodeList(listInfo.data);
    if (l.creator !== creator) throw new HttpError(409, 'That list belongs to someone else.');
    opened = true;
    from = l.count;
    if (l.wallets.join() !== wallets.slice(0, from).join()) throw new HttpError(409, 'The list on chain differs from this launch. Close it and start again.');
  }

  const pass = passKp && { key: passKp, made: !!passInfo };
  const cost = launchCost(wallets.length, !!passKp && !passInfo);
  const need = cost.rent + (opened ? P.listRent(wallets.length) - P.listRent(from) : cost.list) + cost.fees + devBuy * 1.01;
  if (balance < need) throw new HttpError(402, `This launch needs about ${(need / 1e9).toFixed(4)} SOL and the wallet holds ${(balance / 1e9).toFixed(4)}.`);

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const build = (passSeparate) => {
    const all = buildAll(c, { creator: creatorKey, mint, wallets, from, meta, devBuy, blockhash, opened, pass, passSeparate });
    for (const t of all) t.tx.sign([...(t.mintSigns ? [mintKp] : []), ...(t.passSigns ? [passKp] : [])]);
    return all;
  };
  const tooBig = (all) => all.find((t) => t.tx.serialize().length > 1232);
  let txs = build(false);
  // the pass in the launch transaction keeps it all-or-nothing; with a first buy too there's no room, so it goes first
  if (pass && !pass.made && tooBig(txs)) txs = build(true);
  const big = tooBig(txs);
  if (big) throw new HttpError(400, `A transaction came out at ${big.tx.serialize().length} bytes. Shorten the name or ticker.`);
  const hashes = await Promise.all(txs.map((t) => sha256hex(t.tx.message.serialize())));
  meta.passSeparate = txs.some((t) => t.kind === 'pass');

  const id = row?.id || randomId(12);
  const t = Date.now();
  if (row) {
    await env.DB.prepare("UPDATE launches SET status = 'prepared', meta = ?, messages = ?, error = NULL, updated_at = ? WHERE id = ?").bind(JSON.stringify(meta), JSON.stringify(hashes), t, id).run();
  } else {
    await env.DB.prepare(`INSERT INTO launches (id, creator, mint, mint_secret, meta, wallets, dev_buy, status, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`)
      .bind(id, creator, mint.toBase58(), await encryptSecret(env, mintKp.secretKey, mint.toBase58()), JSON.stringify(meta), JSON.stringify(wallets), devBuy, JSON.stringify(hashes), t, t).run();
  }
  return {
    id, mint: mint.toBase58(), lastValidBlockHeight,
    txs: txs.map((x) => ({ kind: x.kind, count: x.count || 0, tx: b64encode(x.tx.serialize()) })),
    listed: wallets.length, onChain: from,
    cost: { rent: cost.rent, list: cost.list, fees: cost.fees, devBuy, total: Math.round(need) },
  };
}

/** The signed transactions back from the wallet: the list in order, then the launch. Streams progress lines. */
export async function submit(env, c, id, signed, progress = () => {}) {
  const row = await env.DB.prepare('SELECT * FROM launches WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'No launch with that id.');
  if (row.status === 'live') return { mint: row.mint, already: true };
  if (row.status !== 'prepared') throw new HttpError(409, 'This launch is already being sent.');
  const hashes = JSON.parse(row.messages || '[]');
  if (!Array.isArray(signed) || signed.length !== hashes.length) throw new HttpError(400, 'Sign every transaction of the launch.');
  const mintKp = Keypair.fromSecretKey(await decryptSecret(env, row.mint_secret, row.mint));
  const meta = JSON.parse(row.meta);
  const passKp = meta.pass ? await passKey(mintKp) : null;
  const signs = (tx, kp) => { const at = tx.message.staticAccountKeys.findIndex((k) => k.equals(kp.publicKey)); return at >= 0 && at < tx.message.header.numRequiredSignatures; };
  const txs = [];
  for (let i = 0; i < signed.length; i++) {
    let tx;
    try { tx = VersionedTransaction.deserialize(b64decode(String(signed[i]))); } catch { throw new HttpError(400, 'A transaction came back unreadable.'); }
    if ((await sha256hex(tx.message.serialize())) !== hashes[i]) throw new HttpError(400, 'A transaction was changed after it was built. Start the launch again.');
    const keys = [mintKp, passKp].filter((kp) => kp && signs(tx, kp));
    if (keys.length) tx.sign(keys);
    txs.push(tx);
  }
  const claimed = await env.DB.prepare("UPDATE launches SET status = 'listing', updated_at = ? WHERE id = ? AND status = 'prepared'").bind(Date.now(), id).run();
  if (!claimed.meta.changes) throw new HttpError(409, 'This launch is already being sent.');

  const conn = connection(c.rpcUrl);
  const fail = async (err) => {
    await env.DB.prepare("UPDATE launches SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(String(err).slice(0, 500), Date.now(), id).run();
    return { error: err, resumable: true, id };
  };
  const finish = (signature) => landed(env, c, row, signature, progress);
  // the list's transactions in order, then (if it has its own) the dev pass's, then the launch
  const first = txs.slice(0, -1);
  const list = first.filter((tx) => !passKp || !signs(tx, passKp));
  for (let i = 0; i < list.length; i++) {
    progress({ step: 'list', done: i, of: list.length });
    const r = await sendAndConfirm(conn, list[i], { timeoutMs: 45_000 });
    if (!r.ok) return fail(`The list stopped at part ${i + 1} of ${list.length}: ${r.err}`);
  }
  for (const tx of first.filter((t) => !list.includes(t))) {
    progress({ step: 'pass' });
    const r = await sendAndConfirm(conn, tx, { timeoutMs: 45_000 });
    if (!r.ok) return fail(`The dev pass didn't mint: ${r.err}`);
  }
  progress({ step: 'launch' });
  await env.DB.prepare("UPDATE launches SET status = 'launching', updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
  const r = await sendAndConfirm(conn, txs[txs.length - 1], { timeoutMs: 60_000 });
  if (!r.ok) return fail(`The launch didn't land: ${r.err}`);
  return finish(r.signature);
}

/** a landed launch: the coin's row, the launch marked live, its first trades read */
async function landed(env, c, row, signature, progress) {
  const id = row.id;
  const r = { signature };
  const meta = JSON.parse(row.meta);
  const wallets = JSON.parse(row.wallets);
  await recordCoin(env, { mint: row.mint, creator: row.creator, meta, wallets, signature: r.signature });
  await env.DB.prepare("UPDATE launches SET status = 'live', updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
  if (meta.noVamps) await uncache('vamp:hashes');
  await indexSignature(env, c, r.signature).catch(() => {});
  progress({ step: 'live', mint: row.mint, signature: r.signature });
  return { mint: row.mint, signature: r.signature };
}

/** For a launch that stopped part-way: a transaction closing its unsealed list, so its rent comes back. */
export async function closeTx(env, c, id, creator) {
  const row = await env.DB.prepare('SELECT * FROM launches WHERE id = ? AND creator = ?').bind(id, creator).first();
  if (!row || row.status === 'live') throw new HttpError(404, 'Nothing to close.');
  const conn = connection(c.rpcUrl);
  const info = await conn.getAccountInfo(P.listPda(row.mint));
  if (!info) throw new HttpError(404, 'That launch has no list on chain.');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = buildTx(creator, [P.closeListIx(pk(creator), pk(row.mint))], blockhash, { cu: 30_000, priority: c.priority });
  return { tx: b64encode(tx.serialize()), lastValidBlockHeight, refund: info.lamports };
}
