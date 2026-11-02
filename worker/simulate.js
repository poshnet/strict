// "Watch a bounce": the same small buy of a coin, simulated on chain twice, once from a wallet on its list and once from
// one that isn't. A simulation runs the real program against real state and needs no signature, so anyone can ask for
// it; the program's own logs come back. The listed wallet's buy ends in `Bounced`; the other one goes through.
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { personOf } from './kols.js';
import * as P from './program.js';
import { buildTx, connection, pk } from './sol.js';
import { HttpError, isBase58Address } from './util.js';

const AMOUNT = 10_000_000n; // 0.01 SOL

async function run(conn, c, { mint, buyer, payer }) {
  const m = pk(mint), b = pk(buyer), fee = pk(payer);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(fee, getAssociatedTokenAddressSync(m, b), b, m),
    P.buyIx(b, m, c.feeWallet, AMOUNT, 0n),
  ];
  const { blockhash } = await connection(c.rpcUrl).getLatestBlockhash('confirmed');
  const tx = buildTx(fee, ixs, blockhash, { cu: 120_000, priority: 0 });
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  const v = r.value;
  // from where the strict program starts (the token-account setup before it is noise)
  const logs = v.logs || [];
  const from = logs.findIndex((l) => l.startsWith(`Program ${P.PROGRAM_ID.toBase58()} invoke`));
  return {
    wallet: buyer, ok: !v.err, error: P.programError(v.err) || (v.err ? JSON.stringify(v.err) : null),
    logs: from >= 0 ? logs.slice(from) : logs, units: v.unitsConsumed ?? null, slot: r.context?.slot ?? null,
  };
}

export async function simulateBounce(env, c, { mint, wallet }) {
  if (!isBase58Address(mint)) throw new HttpError(400, 'bad mint');
  if (!c.opsWallet || !c.feeWallet) throw new HttpError(503, 'Simulations open when the program is live.');
  const { results } = await env.DB.prepare('SELECT wallet FROM coin_list WHERE mint = ?').bind(mint).all();
  if (!results.length) throw new HttpError(400, "That coin has no list to test.");
  const listed = results.map((r) => r.wallet);
  let buyer = wallet && isBase58Address(wallet) && listed.includes(wallet) ? wallet : null;
  if (!buyer) {
    // the most followed KOL on the list, else the first wallet
    buyer = [...listed].sort((x, y) => (personOf(y)?.followers || 0) - (personOf(x)?.followers || 0))[0];
  }
  const conn = connection(c.rpcUrl);
  const [bounced, control] = await Promise.all([
    run(conn, c, { mint, buyer, payer: c.opsWallet }),
    run(conn, c, { mint, buyer: c.opsWallet, payer: c.opsWallet }),
  ]);
  const p = personOf(buyer);
  return { mint, sol: Number(AMOUNT) / 1e9, programId: P.PROGRAM_ID.toBase58(), bounced: { ...bounced, kol: p ? { name: p.name, handle: p.handle, pfp: p.pfp } : null }, control };
}
