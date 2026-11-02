// Trades. Before a coin bonds it trades on its curve, built here from the curve read fresh off chain (the quote is the
// program's own math, so the minimum out is exact up to the slippage). A buy one of the coin's rules would stop (a
// listed wallet, the creator on a no-dev-buy coin, the launch block on a no-bundles coin, a buy past the max wallet) gets
// a refusal naming the rule instead of a transaction; the chain would refuse it anyway. After bonding, trades go
// through Jupiter.
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { sessionWallet } from './auth.js';
import { personOf } from './kols.js';
import * as P from './program.js';
import { buildTx, connection, pk, tokenBalance } from './sol.js';
import { HttpError, isBase58Address, sleep } from './util.js';

export async function readCurve(conn, mint) {
  const info = await conn.getAccountInfo(P.curvePda(mint), 'confirmed');
  if (!info) throw new HttpError(404, "That coin isn't on strict.fun.");
  return P.decodeCurve(info.data);
}

/** Is `wallet` on `mint`'s sealed list? (the index, which mirrors the account) */
export async function isListed(env, mint, wallet) {
  return !!(await env.DB.prepare('SELECT 1 FROM coin_list WHERE mint = ? AND wallet = ?').bind(mint, wallet).first());
}

/** A refused buy from a signed-in wallet is a stop worth showing: it's provably theirs. */
async function noteStop(env, req, mint, wallet, sol, rule) {
  if ((await sessionWallet(env, req)) !== wallet) return;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO bounces (mint, wallet, rule, source, sol, ts) VALUES (?, ?, ?, 'site', ?, ?)").bind(mint, wallet, rule, sol, Date.now()),
    env.DB.prepare('UPDATE coins SET stopped = stopped + 1 WHERE mint = ?').bind(mint),
  ]);
}

/** a 403 naming the rule that stops this buy (the stop is noted for a signed-in wallet) */
async function refuse(env, req, { mint, wallet, sol, rule, message, extra = {} }) {
  await noteStop(env, req, mint, wallet, sol, rule).catch(() => {});
  throw new HttpError(403, message, { rule, ...extra });
}

const applySlip = (x, bps) => (BigInt(x) * BigInt(10_000 - bps)) / 10_000n;

/**
 * body: { wallet, mint, side: 'buy'|'sell', sol (buy), tokens (raw, sell) or pct (sell), slippageBps }
 * -> { tx, lastValidBlockHeight, quote } or a 403 { bounced } for a listed wallet's buy
 */
export async function buildTrade(env, c, req, body) {
  const wallet = String(body?.wallet || ''), mint = String(body?.mint || '');
  if (!isBase58Address(wallet) || !isBase58Address(mint)) throw new HttpError(400, 'Connect a wallet first.');
  const side = body.side === 'sell' ? 'sell' : 'buy';
  const slip = Math.max(10, Math.min(5000, Math.round(Number(body.slippageBps ?? c.slippageBps))));
  const conn = connection(c.rpcUrl);
  const curve = await readCurve(conn, mint);
  if (curve.complete) return jupTrade(env, c, { wallet, mint, side, body, slip, conn });

  const user = pk(wallet), m = pk(mint);
  const ixs = [];
  let quote;
  if (side === 'buy') {
    const lamports = BigInt(Math.round(Number(body.sol) * 1e9));
    if (!(lamports > 0n)) throw new HttpError(400, 'Enter an amount of SOL.');
    const sol = Number(lamports) / 1e9;
    if (curve.noDevBuy && wallet === curve.creator) {
      await refuse(env, req, { mint, wallet, sol, rule: 'dev', message: "This coin has no dev buy: its creator's wallet can't buy it before it bonds." });
    }
    if (curve.noBundles && (await conn.getSlot('confirmed')) <= curve.createdSlot) {
      await refuse(env, req, { mint, wallet, sol, rule: 'bundles', message: 'This coin has no bundles: nothing can buy in the block it was created in. Try again in a second.' });
    }
    if (curve.blocked > 0 && (await isListed(env, mint, wallet))) {
      const p = personOf(wallet);
      await refuse(env, req, { mint, wallet, sol, rule: 'kols', message: "This wallet is on the coin's no-KOLs list. It can buy once the coin bonds.",
        extra: { bounced: true, kol: p ? { name: p.name, handle: p.handle } : null } });
    }
    // a second of headroom: the shield only falls, so a quote from a second ago never overcharges
    const q = P.quoteBuy(curve, lamports, Math.floor(Date.now() / 1000) - 1, wallet);
    // while the sniper curve is above 1% the fee moves too fast (and chain time drifts from ours) to guard tightly: the
    // minimum out is what the worst case, 99%, would give. The buy still pays only the fee at the second it lands.
    const curving = q.feeBps > curve.feeBps + curve.creatorFeeBps;
    const worst = curving ? P.quoteBuy({ ...curve, shieldKind: 1, shieldSecs: 300, createdAt: Math.floor(Date.now() / 1000) }, lamports).tokens : null;
    const minOut = worst != null ? worst : applySlip(q.tokens, slip);
    const cap = P.walletCap(curve);
    if (cap != null) {
      const held = await tokenBalance(conn, wallet, mint).catch(() => 0n);
      if (held + q.tokens > cap) {
        const room = cap > held ? Number(cap - held) / 1e6 : 0;
        await refuse(env, req, { mint, wallet, sol, rule: 'maxWallet',
          message: `This coin's max wallet is ${curve.maxWalletBps / 100}% of the supply. ${room > 0 ? `This wallet can buy about ${Math.floor(room).toLocaleString('en-US')} more tokens.` : 'This wallet is at the cap.'}`,
          extra: { capTokens: Number(cap) / 1e6, heldTokens: Number(held) / 1e6 } });
      }
    }
    quote = { side, solIn: Number(q.spent) / 1e9, tokens: String(q.tokens), minOut: String(minOut), fee: Number(q.fee + q.creatorFee + q.shieldFee) / 1e9,
      feeBps: q.feeBps, completes: q.complete, curving };
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(user, getAssociatedTokenAddressSync(m, user), user, m));
    ixs.push(P.buyIx(user, m, c.feeWallet, lamports, minOut));
  } else {
    let tokens;
    if (body.pct != null) {
      const held = await tokenBalance(conn, wallet, mint);
      tokens = (held * BigInt(Math.max(1, Math.min(100, Math.round(Number(body.pct)))))) / 100n;
    } else tokens = BigInt(String(body.tokens || '0').replace(/\D/g, '') || '0');
    if (!(tokens > 0n)) throw new HttpError(400, 'Nothing to sell.');
    const q = P.quoteSell(curve, tokens, Math.floor(Date.now() / 1000) - 1);
    if (q.sol <= 0n) throw new HttpError(400, 'Too small to sell.');
    const curving = q.feeBps > curve.feeBps + curve.creatorFeeBps;
    const minOut = curving ? P.quoteSell({ ...curve, shieldKind: 1, shieldSecs: 300, createdAt: Math.floor(Date.now() / 1000) }, tokens).sol : applySlip(q.sol, slip);
    quote = { side, tokens: String(tokens), sol: Number(q.sol) / 1e9, minOut: String(minOut), fee: Number(q.fee + q.creatorFee + q.shieldFee) / 1e9, feeBps: q.feeBps, curving };
    ixs.push(P.sellIx(user, m, c.feeWallet, tokens, minOut));
  }
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = buildTx(user, ixs, blockhash, { cu: 90_000, priority: c.priority });
  return { tx: Buffer.from(tx.serialize()).toString('base64'), lastValidBlockHeight, quote, venue: 'curve' };
}

// ---------------------------------------------------------------- after bonding: Jupiter

async function jup(c, path, init = {}, retry = true) {
  const r = await fetch(`${c.jupBase}${path}`, { ...init, headers: { accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 429 && retry) { await sleep(1200); return jup(c, path, init, false); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(502, `Jupiter couldn't route that trade (${r.status}).`);
  return j;
}

async function jupTrade(env, c, { wallet, mint, side, body, slip, conn }) {
  let amount;
  if (side === 'buy') amount = BigInt(Math.round(Number(body.sol) * 1e9));
  else if (body.pct != null) amount = ((await tokenBalance(conn, wallet, mint)) * BigInt(Math.max(1, Math.min(100, Math.round(Number(body.pct)))))) / 100n;
  else amount = BigInt(String(body.tokens || '0').replace(/\D/g, '') || '0');
  if (!(amount > 0n)) throw new HttpError(400, side === 'buy' ? 'Enter an amount of SOL.' : 'Nothing to sell.');
  const [inputMint, outputMint] = side === 'buy' ? [P.WSOL.toBase58(), mint] : [mint, P.WSOL.toBase58()];
  const q = await jup(c, `/swap/v1/quote?${new URLSearchParams({ inputMint, outputMint, amount: String(amount), slippageBps: String(slip), restrictIntermediateTokens: 'true' })}`);
  if (!q?.outAmount) throw new HttpError(502, 'No route for that trade yet. The pool may be seconds old: try again.');
  const r = await jup(c, '/swap/v1/swap', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: wallet, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: 'high' } } }),
  });
  if (!r?.swapTransaction) throw new HttpError(502, 'Jupiter built no transaction.');
  const quote = side === 'buy'
    ? { side, solIn: Number(amount) / 1e9, tokens: q.outAmount, minOut: q.otherAmountThreshold }
    : { side, tokens: String(amount), sol: Number(q.outAmount) / 1e9, minOut: q.otherAmountThreshold };
  return { tx: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight, quote, venue: 'jupiter' };
}
