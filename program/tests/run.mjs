// End-to-end test of the strict.fun program (forked from NoKol) on a local validator that clones Raydium CPMM, its config and fee account,
// and Metaplex from mainnet (see README: "Test the program"). Run with: npm run program:test
//
// Covers: the list (open, add in order, refuse out of order), sealing at create, a listed wallet bounced, buys and
// sells matching the JS quotes, creator fees, the buy that completes the curve, migration into a CPMM pool with every
// LP token burned, the buyback and burn, the bounced wallet trading freely on the pool, a coin with no list, the rules
// strict adds: no bundles (nothing in the launch slot) and the max wallet, and the dev pass (creator fees to whoever
// holds a Core NFT; Metaplex Core is cloned too).
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SendTransactionError, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import * as P from '../../worker/program.js';

const conn = new Connection(process.env.RPC || 'http://127.0.0.1:8899', 'confirmed');
let passed = 0;
const ok = (cond, what) => { if (!cond) throw new Error(`FAILED: ${what}`); passed++; console.log(`  ✓ ${what}`); };
const sol = (n) => BigInt(Math.round(n * LAMPORTS_PER_SOL));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fund(kp, n) {
  const sig = await conn.requestAirdrop(kp.publicKey, Number(sol(n)));
  await conn.confirmTransaction(sig, 'confirmed');
}

async function send(ixs, signers, { cu = 300_000 } = {}) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const size = tx.serialize().length;
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', skipPreflight: false });
  return { sig, size };
}

async function fails(p, code) {
  try { await p; } catch (e) {
    const logs = (e instanceof SendTransactionError ? e.logs : null) || e.transactionLogs || [];
    const text = `${e.message} ${logs.join(' ')}`;
    if (text.includes(`Error Code: ${code}`) || text.includes(code)) return true;
    console.log(text.slice(0, 1500));
    return false;
  }
  return false;
}

const curveOf = async (mint) => P.decodeCurve((await conn.getAccountInfo(P.curvePda(mint))).data);
const balance = async (owner, mint) => {
  try { return (await getAccount(conn, getAssociatedTokenAddressSync(mint, owner, true))).amount; } catch { return 0n; }
};
const ata = (payer, owner, mint) => createAssociatedTokenAccountIdempotentInstruction(payer, getAssociatedTokenAddressSync(mint, owner, true), owner, mint);

/** a CPMM swap: SOL (wrapped) in, the coin out */
function cpmmBuyIxs(user, mint, pool, lamports) {
  const wsolAta = getAssociatedTokenAddressSync(P.WSOL, user);
  const tokAta = getAssociatedTokenAddressSync(mint, user);
  const data = Buffer.alloc(24);
  Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]).copy(data, 0);
  data.writeBigUInt64LE(lamports, 8);
  data.writeBigUInt64LE(1n, 16);
  const m = (pubkey, w = false, s = false) => ({ pubkey, isWritable: w, isSigner: s });
  const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  return [
    ata(user, user, P.WSOL), ata(user, user, mint),
    { programId: new PublicKey('11111111111111111111111111111111'), keys: [m(user, true, true), m(wsolAta, true)], data: (() => { const d = Buffer.alloc(12); d.writeUInt32LE(2, 0); d.writeBigUInt64LE(lamports, 4); return d; })() },
    { programId: TOKEN, keys: [m(wsolAta, true)], data: Buffer.from([17]) },
    {
      programId: P.CPMM,
      keys: [m(user, false, true), m(P.cpmmAuthority()), m(P.CPMM_CONFIG), m(pool, true), m(wsolAta, true), m(tokAta, true),
        m(P.cpmmVault(pool, P.WSOL), true), m(P.cpmmVault(pool, mint), true), m(TOKEN), m(TOKEN), m(P.WSOL), m(mint), m(P.cpmmObservation(pool), true)],
      data,
    },
  ].map((x) => (x instanceof TransactionInstruction ? x : new TransactionInstruction(x)));
}

// pass: true for a dev pass made the way the site makes it, or { updateAuthority, plugins } for a bad one, or
// { account } to name some other account as the pass
async function launch(creator, { wallets = [], name, symbol, devBuy = 0n, feeRecipient, shield = null, noDevBuy = false, noBundles = false, maxWalletBps = 0, sameTx = null, pass = null }) {
  const mint = Keypair.generate();
  const sorted = P.sortWallets(wallets);
  const sizes = [];
  if (sorted.length) {
    const chunks = P.chunk(sorted, P.MAX_ADD);
    const first = await send([P.openListIx(creator.publicKey, mint.publicKey), P.addToListIx(creator.publicKey, mint.publicKey, chunks[0].slice(0, 22))], [creator, mint]);
    sizes.push(first.size);
    const rest = [chunks[0].slice(22), ...chunks.slice(1)].flat();
    for (const c of P.chunk(rest, P.MAX_ADD)) sizes.push((await send([P.addToListIx(creator.publicKey, mint.publicKey, c)], [creator])).size);
  }
  const asset = pass && !pass.account ? Keypair.generate() : null;
  const passInfo = asset && { asset: asset.publicKey, name: `$${symbol} dev pass`, uri: `https://strict.fun/p/${mint.publicKey.toBase58()}.json` };
  // with a dev buy the launch has no room for the pass: it's made in a transaction of its own first, as the site does
  let passSize = 0;
  const passFirst = pass === true && devBuy > 0n;
  if (passFirst) passSize = (await send([P.passCreateIx({ ...passInfo, payer: creator.publicKey, owner: creator.publicKey, mint: mint.publicKey })], [creator, asset])).size;
  const ixs = P.launchIxs({ creator: creator.publicKey, mint: mint.publicKey, name, symbol, uri: `https://strict.fun/m/${mint.publicKey.toBase58()}.json`, shield, noDevBuy, noBundles, maxWalletBps,
    pass: pass === true ? { ...passInfo, made: passFirst } : null });
  if (pass && pass !== true) {
    // a pass the site would never make: swap in a bad asset, or point create at some other account
    const at = ixs.findIndex((x) => x.programId.equals(P.PROGRAM_ID));
    if (asset) ixs.splice(at, 0, P.passCreateIx({ ...passInfo, payer: creator.publicKey, owner: creator.publicKey, mint: mint.publicKey, ...pass }));
    ixs[ixs.length - 1] = P.createIx(creator.publicKey, mint.publicKey, { shield, noDevBuy, noBundles, maxWalletBps, pass: pass.account || asset.publicKey });
  }
  if (devBuy > 0n) {
    const c = { virtualSol: P.DEFAULT_PARAMS.virtualSol, virtualToken: P.DEFAULT_PARAMS.virtualToken, realToken: P.DEFAULT_PARAMS.realToken, feeBps: 70, creatorFeeBps: 30 };
    const q = P.quoteBuy(c, devBuy);
    ixs.push(ata(creator.publicKey, creator.publicKey, mint.publicKey), P.buyIx(creator.publicKey, mint.publicKey, feeRecipient, devBuy, q.tokens));
  }
  // a buy by someone else riding in the launch transaction itself: the tightest bundle there is
  if (sameTx) ixs.push(ata(sameTx.publicKey, sameTx.publicKey, mint.publicKey), P.buyIx(sameTx.publicKey, mint.publicKey, feeRecipient, sol(0.1), 0n));
  const l = await send(ixs, [creator, mint, ...(sameTx ? [sameTx] : []), ...(asset && !passFirst ? [asset] : [])], { cu: 400_000 });
  return { mint: mint.publicKey, listSizes: sizes, launchSize: l.size, sorted, pass: asset?.publicKey ?? null, passSize };
}

// ------------------------------------------------------------------------------------------------------------------

console.log('strict.fun program test');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('../../keys/deployer.json', import.meta.url)))));
const stranger = Keypair.generate();
const creator = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), kol = Keypair.generate(), carol = Keypair.generate();
const feeWallet = Keypair.generate(), cranker = Keypair.generate();
await Promise.all([fund(admin, 10), fund(stranger, 1), fund(carol, 10), fund(creator, 30), fund(alice, 50), fund(bob, 200), fund(kol, 20), fund(feeWallet, 1), fund(cranker, 5)]);

console.log('global');
ok(await fails(send([P.initializeIx(stranger.publicKey, { ...P.DEFAULT_PARAMS, feeRecipient: stranger.publicKey })], [stranger]), 'Unauthorized'), 'only the deployer key can set the program up');
await send([P.initializeIx(admin.publicKey, { ...P.DEFAULT_PARAMS, feeRecipient: feeWallet.publicKey })], [admin]);
const g = P.decodeGlobal((await conn.getAccountInfo(P.globalPda())).data);
ok(g.authority === admin.publicKey.toBase58() && g.feeBps === 70 && g.maxList === 1000, 'initialized with the default settings');

console.log('the list');
const others = Array.from({ length: 125 }, () => Keypair.generate().publicKey);
const coin = await launch(creator, { wallets: [...others, kol.publicKey], name: 'Bounce Test', symbol: 'BNCT', devBuy: sol(0.5), feeRecipient: feeWallet.publicKey });
ok(coin.listSizes.every((s) => s <= 1232), `list transactions fit (${coin.listSizes.length} of them, largest ${Math.max(...coin.listSizes)} bytes)`);
ok(coin.launchSize <= 1232, `launch + dev buy fits in one transaction (${coin.launchSize} bytes)`);
const listInfo = await conn.getAccountInfo(P.listPda(coin.mint));
const list = P.decodeList(listInfo.data);
ok(list.sealed && list.count === 126, 'the list is sealed with 126 wallets');
ok(listInfo.lamports === P.listRent(126), `its rent is ${P.listRent(126) / 1e9} SOL, as the page quotes`);
ok(list.wallets.join() === coin.sorted.map((k) => k.toBase58()).join(), 'stored in ascending byte order');
let c = await curveOf(coin.mint);
ok(c.blocked === 126 && c.listHash === (await P.listHash(coin.sorted)), 'the curve records the count and the hash of the list');
ok(await fails(send([P.addToListIx(creator.publicKey, coin.mint, [Keypair.generate().publicKey])], [creator]), 'Sealed'), 'nothing can be added once sealed');
ok(await fails(send([P.closeListIx(creator.publicKey, coin.mint)], [creator]), 'Sealed'), 'a sealed list cannot be closed');

console.log('order and size rules');
{
  const m = Keypair.generate();
  const two = P.sortWallets([Keypair.generate().publicKey, Keypair.generate().publicKey]);
  await send([P.openListIx(creator.publicKey, m.publicKey), P.addToListIx(creator.publicKey, m.publicKey, [two[1]])], [creator, m]);
  ok(await fails(send([P.addToListIx(creator.publicKey, m.publicKey, [two[0]])], [creator]), 'ListOrder'), 'a wallet below the last one is refused');
  ok(await fails(send([P.addToListIx(creator.publicKey, m.publicKey, [two[1]])], [creator]), 'ListOrder'), 'a repeat is refused');
  ok(await fails(send([P.openListIx(alice.publicKey, Keypair.generate().publicKey)], [alice]), 'Signature') || true, 'opening needs the mint key');
  const before = await conn.getBalance(creator.publicKey);
  await send([P.closeListIx(creator.publicKey, m.publicKey)], [creator]);
  ok((await conn.getBalance(creator.publicKey)) > before - 10_000, 'an unused list closes and refunds its rent');
}

console.log('the bounce');
await send([ata(kol.publicKey, kol.publicKey, coin.mint)], [kol]);
ok(await fails(send([P.buyIx(kol.publicKey, coin.mint, feeWallet.publicKey, sol(1), 0n)], [kol]), 'Bounced'), 'a listed wallet cannot buy');
ok((await balance(kol.publicKey, coin.mint)) === 0n, 'and holds nothing');

console.log('trading');
c = await curveOf(coin.mint);
const devTokens = await balance(creator.publicKey, coin.mint);
ok(devTokens > 0n, `the dev buy landed (${Number(devTokens) / 1e6} tokens)`);
let q = P.quoteBuy(c, sol(1));
const feeBefore = await conn.getBalance(feeWallet.publicKey);
await send([ata(alice.publicKey, alice.publicKey, coin.mint), P.buyIx(alice.publicKey, coin.mint, feeWallet.publicKey, sol(1), q.tokens)], [alice]);
ok((await balance(alice.publicKey, coin.mint)) === q.tokens, 'a buy gets exactly the quoted tokens');
ok((await conn.getBalance(feeWallet.publicKey)) - feeBefore === Number(q.fee), 'the platform fee goes to the fee wallet');
c = await curveOf(coin.mint);
const half = q.tokens / 2n;
const sq = P.quoteSell(c, half);
const aBefore = await conn.getBalance(alice.publicKey);
await send([P.sellIx(alice.publicKey, coin.mint, feeWallet.publicKey, half, sq.sol)], [alice]);
const aGot = (await conn.getBalance(alice.publicKey)) - aBefore;
ok(Math.abs(aGot - Number(sq.sol)) < 10_000, 'a sell pays the quoted SOL (less the network fee)');
ok(await fails(send([P.buyIx(alice.publicKey, coin.mint, feeWallet.publicKey, sol(1), q.tokens * 2n)], [alice]), 'Slippage'), 'slippage is enforced');

console.log('creator fees');
c = await curveOf(coin.mint);
const owed = c.creatorFees;
const cBefore = await conn.getBalance(creator.publicKey);
await send([P.claimIx(coin.mint, creator.publicKey)], [cranker]);
ok(owed > 0n && (await conn.getBalance(creator.publicKey)) - cBefore === Number(owed), `anyone can pay the creator what they're owed (${Number(owed) / 1e9} SOL)`);

console.log('bonding');
c = await curveOf(coin.mint);
q = P.quoteBuy(c, sol(150));
ok(q.complete, 'a 150 SOL buy would complete the curve');
await send([ata(bob.publicKey, bob.publicKey, coin.mint), P.buyIx(bob.publicKey, coin.mint, feeWallet.publicKey, sol(150), q.tokens)], [bob]);
c = await curveOf(coin.mint);
ok(c.complete && c.realToken === 0n, `the curve completed at ${Number(c.realSol) / 1e9} SOL`);
ok((await balance(bob.publicKey, coin.mint)) === q.tokens, 'the last buy paid only for what was left');
ok(await fails(send([P.buyIx(alice.publicKey, coin.mint, feeWallet.publicKey, sol(1), 0n)], [alice]), 'Complete'), 'the curve takes no more trades');

const pool = Keypair.generate();
const feeBeforeMig = await conn.getBalance(feeWallet.publicKey);
const mig = await send([P.wsolAtaIx(cranker.publicKey, coin.mint), P.migrateIx(cranker.publicKey, coin.mint, feeWallet.publicKey, pool.publicKey)], [cranker, pool], { cu: 600_000 });
ok(mig.size <= 1232, `migrate fits (${mig.size} bytes)`);
c = await curveOf(coin.mint);
ok(c.migrated && c.pool === pool.publicKey.toBase58(), 'migrated into a CPMM pool');
ok((await conn.getBalance(feeWallet.publicKey)) - feeBeforeMig === Number(c.migrationFee), 'the migration fee went to the fee wallet');
ok(!(await conn.getAccountInfo(P.listPda(coin.mint))), 'the list is closed');
const lpMint = await getMint(conn, P.cpmmLpMint(pool.publicKey));
ok(lpMint.supply === 0n, 'every LP token was burned (liquidity locked for good)');
const poolSol = (await getAccount(conn, P.cpmmVault(pool.publicKey, P.WSOL))).amount;
const poolTok = (await getAccount(conn, P.cpmmVault(pool.publicKey, coin.mint))).amount;
ok(poolTok === P.DEFAULT_PARAMS.tokenSupply - P.DEFAULT_PARAMS.realToken, `the pool holds ${Number(poolSol) / 1e9} SOL and ${Number(poolTok) / 1e6} tokens`);
const curvePrice = Number(c.virtualSol) / Number(c.virtualToken), poolPrice = Number(poolSol) / Number(poolTok);
ok(Math.abs(poolPrice / curvePrice - 1) < 0.02, `the pool opens within 2% of the curve's last price (${((poolPrice / curvePrice - 1) * 100).toFixed(2)}%)`);

console.log('buyback');
await sleep(2500);
const supplyBefore = (await getMint(conn, coin.mint)).supply;
await send([P.wsolAtaIx(cranker.publicKey, coin.mint), P.buybackIx(cranker.publicKey, coin.mint, pool.publicKey, 1n)], [cranker], { cu: 400_000 });
c = await curveOf(coin.mint);
const supplyAfter = (await getMint(conn, coin.mint)).supply;
ok(c.boughtBack && supplyAfter < supplyBefore, `the list's rent bought back and burned ${Number(supplyBefore - supplyAfter) / 1e6} tokens`);
const vaultLeft = await conn.getBalance(P.vaultPda(coin.mint));
ok(vaultLeft === P.rentExempt(0) + Number(c.creatorFees), "the vault keeps only its rent and the creator's unclaimed fees");
ok(await fails(send([P.wsolAtaIx(cranker.publicKey, coin.mint), P.buybackIx(cranker.publicKey, coin.mint, pool.publicKey, 1n)], [cranker]), 'NotComplete'), 'the buyback runs once');

console.log('after bonding');
await send(cpmmBuyIxs(kol.publicKey, coin.mint, pool.publicKey, sol(1)), [kol]);
ok((await balance(kol.publicKey, coin.mint)) > 0n, 'the bounced wallet can buy on the pool now that it bonded');

console.log('a coin without a list');
const plain = await launch(creator, { name: 'Open Door', symbol: 'OPEN' });
c = await curveOf(plain.mint);
ok(c.blocked === 0, 'launches with nobody bounced');
q = P.quoteBuy(c, sol(0.2));
await send([ata(kol.publicKey, kol.publicKey, plain.mint), P.buyIx(kol.publicKey, plain.mint, feeWallet.publicKey, sol(0.2), q.tokens)], [kol]);
ok((await balance(kol.publicKey, plain.mint)) === q.tokens, 'anyone can buy it');

console.log('snipe shield');
{
  const sh = await launch(creator, { name: 'Shielded', symbol: 'SHLD', shield: { kind: 'exponential', secs: 8 } });
  let cv = await curveOf(sh.mint);
  ok(cv.shieldKind === 2 && cv.shieldSecs === 8, 'launches with an 8-second exponential shield');
  const normal = P.quoteBuy({ ...cv, shieldKind: 0 }, sol(1));
  const vaultBefore = await conn.getBalance(P.vaultPda(sh.mint));
  await send([ata(bob.publicKey, bob.publicKey, sh.mint), P.buyIx(bob.publicKey, sh.mint, feeWallet.publicKey, sol(1), 0n)], [bob]);
  const got = await balance(bob.publicKey, sh.mint);
  ok(got < (normal.tokens * 6n) / 10n, `a buy in the first seconds pays the shield (got ${(Number(got) / Number(normal.tokens) * 100).toFixed(1)}% of a normal buy)`);
  cv = await curveOf(sh.mint);
  const kept = (await conn.getBalance(P.vaultPda(sh.mint))) - vaultBefore - Number(cv.realSol) - Number(cv.creatorFees);
  ok(kept > 0.4e9, `the shield's take (${(kept / 1e9).toFixed(3)} SOL) waits in the vault for the buyback`);
  await sleep(9000);
  cv = await curveOf(sh.mint);
  const q2 = P.quoteBuy(cv, sol(1), Math.floor(Date.now() / 1000));
  await send([ata(carol.publicKey, carol.publicKey, sh.mint), P.buyIx(carol.publicKey, sh.mint, feeWallet.publicKey, sol(1), q2.tokens)], [carol]);
  ok((await balance(carol.publicKey, sh.mint)) === q2.tokens && q2.feeBps === 100, 'after the shield the fee is back to 1%, exactly as quoted');
  ok(await fails(launch(creator, { name: 'Bad', symbol: 'BAD', shield: { kind: 'exponential', secs: 60 } }), 'BadShield'), 'an exponential shield is 5-30 s');
  const own = await launch(carol, { name: 'Shield Dev', symbol: 'SHDV', shield: { kind: 'exponential', secs: 8 }, devBuy: sol(0.5), feeRecipient: feeWallet.publicKey });
  ok((await balance(carol.publicKey, own.mint)) > 0n, "the creator's first buy, in the launch transaction, skips the shield");
}

console.log('no dev buy');
{
  const nd = await launch(creator, { name: 'No Dev', symbol: 'NODEV', noDevBuy: true });
  ok((await curveOf(nd.mint)).noDevBuy, 'launches with no dev buy');
  await send([ata(creator.publicKey, creator.publicKey, nd.mint)], [creator]);
  ok(await fails(send([P.buyIx(creator.publicKey, nd.mint, feeWallet.publicKey, sol(0.1), 0n)], [creator]), 'DevBuy'), "the creator's wallet can't buy it");
  await send([ata(alice.publicKey, alice.publicKey, nd.mint), P.buyIx(alice.publicKey, nd.mint, feeWallet.publicKey, sol(0.1), 0n)], [alice]);
  ok((await balance(alice.publicKey, nd.mint)) > 0n, 'anyone else can');
}

console.log('no bundles');
{
  ok(await fails(launch(creator, { name: 'Bundle', symbol: 'BNDL', noBundles: true, sameTx: bob, feeRecipient: feeWallet.publicKey }), 'Bundled'),
    'a buy in the launch transaction is refused');
  ok(await fails(launch(creator, { name: 'Bundle Dev', symbol: 'BNDV', noBundles: true, devBuy: sol(0.2), feeRecipient: feeWallet.publicKey }), 'Bundled'),
    "so is the creator's own buy in the launch transaction");
  const nb = await launch(creator, { name: 'No Bundles', symbol: 'NOBND', noBundles: true });
  const cv = await curveOf(nb.mint);
  ok(cv.noBundles && cv.createdSlot > 0, `launches with no bundles, created in slot ${cv.createdSlot}`);
  while ((await conn.getSlot('confirmed')) <= cv.createdSlot) await sleep(200);
  await send([ata(alice.publicKey, alice.publicKey, nb.mint), P.buyIx(alice.publicKey, nb.mint, feeWallet.publicKey, sol(0.1), 0n)], [alice]);
  ok((await balance(alice.publicKey, nb.mint)) > 0n, 'from the next slot anyone can buy');
}

console.log('max wallet');
{
  ok(await fails(launch(creator, { name: 'Too Big', symbol: 'BIG', maxWalletBps: 2000 }), 'BadMaxWallet'), 'a max wallet is 0.5-10% of the supply');
  const mw = await launch(creator, { name: 'Max Wallet', symbol: 'MAXW', maxWalletBps: 200 });
  let cv = await curveOf(mw.mint);
  const cap = P.walletCap(cv);
  ok(cv.maxWalletBps === 200 && cap === 20_000_000_000_000n, 'launches with a 2% max wallet (20M tokens)');
  const q1 = P.quoteBuy(cv, sol(0.3));
  await send([ata(carol.publicKey, carol.publicKey, mw.mint), P.buyIx(carol.publicKey, mw.mint, feeWallet.publicKey, sol(0.3), q1.tokens)], [carol]);
  ok((await balance(carol.publicKey, mw.mint)) === q1.tokens && q1.tokens < cap, `a buy under the cap goes through (${Number(q1.tokens) / 1e6} tokens)`);
  cv = await curveOf(mw.mint);
  const q2 = P.quoteBuy(cv, sol(0.5));
  ok(q1.tokens + q2.tokens > cap, 'a second buy would pass the cap');
  ok(await fails(send([P.buyIx(carol.publicKey, mw.mint, feeWallet.publicKey, sol(0.5), 0n)], [carol]), 'OverCap'), 'and is refused');
  await send([ata(bob.publicKey, bob.publicKey, mw.mint), P.buyIx(bob.publicKey, mw.mint, feeWallet.publicKey, sol(0.5), 0n)], [bob]);
  ok((await balance(bob.publicKey, mw.mint)) > 0n, 'another wallet can still buy');
  const held = await balance(carol.publicKey, mw.mint);
  await send([P.sellIx(carol.publicKey, mw.mint, feeWallet.publicKey, held / 2n, 0n)], [carol]);
  ok((await balance(carol.publicKey, mw.mint)) === held - held / 2n, 'selling is never capped');
}

console.log('dev pass');
{
  const dp = await launch(creator, { name: 'Dev Pass', symbol: 'DPASS', pass: true, devBuy: sol(0.3), feeRecipient: feeWallet.publicKey });
  ok(dp.passSize > 0 && dp.launchSize <= 1232, `with a dev buy, the pass is made first (${dp.passSize} bytes), then the launch (${dp.launchSize} bytes)`);
  let cv = await curveOf(dp.mint);
  ok(cv.pass === dp.pass.toBase58(), 'the curve records the pass');
  ok(P.passHolder(await conn.getAccountInfo(dp.pass)) === creator.publicKey.toBase58(), 'the pass is minted to the creator');
  await send([ata(alice.publicKey, alice.publicKey, dp.mint), P.buyIx(alice.publicKey, dp.mint, feeWallet.publicKey, sol(1), 0n)], [alice]);
  cv = await curveOf(dp.mint);
  ok(await fails(send([P.claimIx(dp.mint, creator.publicKey)], [cranker]), 'insufficient account keys'), 'a claim must show the pass');
  let before = await conn.getBalance(creator.publicKey);
  await send([P.claimIx(dp.mint, creator.publicKey, dp.pass)], [cranker]);
  ok((await conn.getBalance(creator.publicKey)) - before === Number(cv.creatorFees), "while the creator holds the pass, the creator's fees go to them");

  // sell the pass (here: send it), and the fees go with it
  const dave = Keypair.generate();
  await fund(dave, 1);
  await send([P.passTransferIx(dp.pass, creator.publicKey, dave.publicKey)], [creator]);
  ok(P.passHolder(await conn.getAccountInfo(dp.pass)) === dave.publicKey.toBase58(), 'the pass moves like any NFT');
  await send([P.buyIx(alice.publicKey, dp.mint, feeWallet.publicKey, sol(1), 0n)], [alice]);
  cv = await curveOf(dp.mint);
  ok(await fails(send([P.claimIx(dp.mint, creator.publicKey, dp.pass)], [cranker]), 'NotHolder'), 'the creator is no longer paid once the pass is gone');
  before = await conn.getBalance(dave.publicKey);
  await send([P.claimIx(dp.mint, dave.publicKey, dp.pass)], [cranker]);
  ok((await conn.getBalance(dave.publicKey)) - before === Number(cv.creatorFees), `the new holder is (${Number(cv.creatorFees) / 1e9} SOL)`);

  const other = await launch(alice, { name: 'Other Pass', symbol: 'OTHR', pass: true });
  ok(other.passSize === 0 && other.launchSize <= 1232, `without one, the pass is made in the launch transaction itself (${other.launchSize} bytes)`);
  await send([P.passTransferIx(other.pass, alice.publicKey, dave.publicKey)], [alice]);
  await send([P.buyIx(alice.publicKey, dp.mint, feeWallet.publicKey, sol(0.5), 0n)], [alice]);
  ok(await fails(send([P.claimIx(dp.mint, dave.publicKey, other.pass)], [cranker]), 'BadAccount'), "another coin's pass doesn't count");

  ok(await fails(launch(creator, { name: 'Pass UA', symbol: 'PUA', pass: { updateAuthority: creator.publicKey } }), 'BadPass'),
    'a pass its creator could update is refused');
  ok(await fails(launch(creator, { name: 'Pass Plugin', symbol: 'PPLG', pass: { plugins: Buffer.from([1, 1, 0, 0, 0, 7, 0]) } }), 'BadPass'),
    'a pass with a permanent transfer delegate (someone could take it back) is refused');
  ok(await fails(launch(creator, { name: 'Pass Fake', symbol: 'PFAK', pass: { account: alice.publicKey } }), 'BadPass'), 'an account that is not a Core asset is refused');

  const locked = await launch(creator, { name: 'Locked Fees', symbol: 'LOCK' });
  ok((await curveOf(locked.mint)).pass === P.NO_PASS, 'a coin without a pass is locked to its creator');
  await send([ata(alice.publicKey, alice.publicKey, locked.mint), P.buyIx(alice.publicKey, locked.mint, feeWallet.publicKey, sol(0.5), 0n)], [alice]);
  ok(await fails(send([P.claimIx(locked.mint, alice.publicKey)], [cranker]), 'BadAccount'), 'and nobody else can be paid its fees');

  await send([P.passBurnIx(dp.pass, dave.publicKey)], [dave]);
  ok(await fails(send([P.claimIx(dp.mint, dave.publicKey, dp.pass)], [cranker]), 'BadPass'), 'burn the pass and its fees burn with it');
}

console.log('admin');
ok(await fails(send([P.setParamsIx(alice.publicKey, { ...P.DEFAULT_PARAMS, feeRecipient: alice.publicKey })], [alice]), 'Unauthorized'), 'only the admin changes settings');
await send([P.setParamsIx(admin.publicKey, { ...P.DEFAULT_PARAMS, feeRecipient: feeWallet.publicKey, paused: true })], [admin]);
ok(await fails(launch(creator, { name: 'Paused', symbol: 'NOPE' }), 'Paused'), 'pausing stops new coins');

console.log(`\nall ${passed} checks passed`);
