// The cranks, sent by the ops wallet every minute. Each is a permissionless program instruction anyone could send; the
// ops wallet only pays the network fee (and opens the vault's wrapped-SOL account, which the buyback refunds):
//   migrate   a completed curve into its Raydium pool, LP burned (a fresh keypair signs as the pool)
//   buyback   once the pool is open: the list's rent and the unspent reserve buy the coin back and burn it
//   claim     creator fees, paid straight to the creator once a coin owes PAYOUT_MIN_SOL
import { getAccount } from '@solana/spl-token';
import { indexSignature } from './indexer.js';
import * as P from './program.js';
import { Keypair, buildTx, connection, opsSigner, sendAndConfirm } from './sol.js';
import { errMsg, getState, setState } from './util.js';

export async function runCranks(env, c) {
  if (!c.crank) return { off: true };
  const ops = opsSigner(env, c);
  if (!ops || !c.feeWallet) return { noOps: true };
  const conn = connection(c.rpcUrl);
  const done = { migrated: 0, boughtBack: 0, paid: 0 };

  const { results: due } = await env.DB.prepare("SELECT mint FROM coins WHERE status = 'complete' LIMIT 3").all();
  for (const { mint } of due) {
    try {
      const pool = Keypair.generate();
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = buildTx(ops.publicKey, [P.wsolAtaIx(ops.publicKey, mint), P.migrateIx(ops.publicKey, mint, c.feeWallet, pool.publicKey)], blockhash, { cu: 600_000, priority: c.priority });
      tx.sign([ops, pool]);
      const r = await sendAndConfirm(conn, tx, { lastValidBlockHeight });
      if (r.ok) { done.migrated++; await indexSignature(env, c, r.signature); }
      else await env.DB.prepare('UPDATE coins SET migrate_error = ? WHERE mint = ?').bind(r.err.slice(0, 300), mint).run();
    } catch (e) { await env.DB.prepare('UPDATE coins SET migrate_error = ? WHERE mint = ?').bind(errMsg(e), mint).run(); }
  }

  const { results: back } = await env.DB.prepare("SELECT mint, pool FROM coins WHERE status = 'migrated' AND bought_back = 0 AND migrated_at < ? LIMIT 3").bind(Date.now() - 5_000).all();
  for (const { mint, pool } of back) {
    try {
      // min out: 90% of the pool's own quote, so a sandwich can't take the buyback for nothing
      const [sol, tok, vault] = await Promise.all([
        getAccount(conn, P.cpmmVault(pool, P.WSOL)), getAccount(conn, P.cpmmVault(pool, mint)), conn.getBalance(P.vaultPda(mint)),
      ]);
      const cv = P.decodeCurve((await conn.getAccountInfo(P.curvePda(mint))).data);
      const spend = BigInt(Math.max(0, vault - P.rentExempt(0) - Number(cv.creatorFees)));
      const out = spend > 0n ? (tok.amount * spend * 9975n) / ((sol.amount + spend) * 10_000n) : 0n;
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = buildTx(ops.publicKey, [P.wsolAtaIx(ops.publicKey, mint), P.buybackIx(ops.publicKey, mint, pool, (out * 9n) / 10n)], blockhash, { cu: 400_000, priority: c.priority });
      tx.sign([ops]);
      const r = await sendAndConfirm(conn, tx, { lastValidBlockHeight });
      if (r.ok) { done.boughtBack++; await indexSignature(env, c, r.signature); }
    } catch (e) { console.log('buyback', mint, errMsg(e)); }
  }

  // creator payouts: every ten minutes, coins that traded since the last pass
  const lastPay = Number(await getState(env, 'pay:last')) || 0;
  if (Date.now() - lastPay > 10 * 60_000) {
    const { results: traded } = await env.DB.prepare("SELECT mint, creator FROM coins WHERE last_trade_at > ? ORDER BY last_trade_at DESC LIMIT 60").bind(lastPay - 60_000).all();
    for (let i = 0; i < traded.length; i += 20) {
      const group = traded.slice(i, i + 20);
      const infos = await conn.getMultipleAccountsInfo(group.map((g) => P.curvePda(g.mint)));
      for (let j = 0; j < group.length; j++) {
        if (!infos[j]) continue;
        const cv = P.decodeCurve(infos[j].data);
        if (Number(cv.creatorFees) < c.payoutMinLamports) continue;
        try {
          // locked to the creator: their wallet. A dev pass: whoever holds it right now (a burned pass pays nobody)
          const pass = P.passOf(cv);
          const to = pass ? P.passHolder(await conn.getAccountInfo(P.pk(pass), 'confirmed')) : cv.creator;
          if (!to) continue;
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
          const tx = buildTx(ops.publicKey, [P.claimIx(group[j].mint, to, pass)], blockhash, { cu: 30_000, priority: c.priority });
          tx.sign([ops]);
          const r = await sendAndConfirm(conn, tx, { lastValidBlockHeight });
          if (r.ok) { done.paid++; await indexSignature(env, c, r.signature); }
        } catch (e) { console.log('claim', group[j].mint, errMsg(e)); }
      }
    }
    await setState(env, 'pay:last', Date.now());
  }
  return done;
}
