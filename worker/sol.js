// Solana plumbing. Workers have no websockets for web3.js subscriptions, so confirmation is polling
// (getSignatureStatuses + block height expiry). The ops wallet (OPS_SECRET) only ever sends the program's
// permissionless cranks: migrate, buyback and creator payouts. It never holds anyone's money.
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SendTransactionError, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { b58decode, b58encode, errMsg, sleep } from './util.js';

export { PublicKey, Keypair, VersionedTransaction };

export const pk = (x) => (x instanceof PublicKey ? x : new PublicKey(x));

const conns = new Map();
export function connection(rpcUrl) {
  if (!conns.has(rpcUrl)) conns.set(rpcUrl, new Connection(rpcUrl, { commitment: 'confirmed', fetch: (i, o) => fetch(i, o) }));
  return conns.get(rpcUrl);
}

// Transactions are read with raw JSON-RPC: web3.js 1.x can't parse the newer v1 transaction format, and one v1
// transaction in a batch would fail the whole read. JSON encoding gives the logs, the inner instructions (data in
// base58) and the account keys as strings, which is all the indexers use.
async function rpc(rpcUrl, body, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`RPC ${r.status}`);
    return j;
  }
}
const TX_PARAMS = { maxSupportedTransactionVersion: 1, commitment: 'confirmed', encoding: 'json' };

/** one transaction, raw (null until it's visible) */
export async function getTx(rpcUrl, sig) {
  const j = await rpc(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, TX_PARAMS] });
  if (j.error) throw new Error(`getTransaction: ${j.error.message}`);
  return j.result || null;
}

/** many transactions in one batched call (one at a time where the RPC refuses batches), in order */
export async function getTxs(rpcUrl, sigs) {
  if (!sigs.length) return [];
  try {
    const j = await rpc(rpcUrl, sigs.map((s, i) => ({ jsonrpc: '2.0', id: i, method: 'getTransaction', params: [s, TX_PARAMS] })));
    if (!Array.isArray(j)) throw new Error('no batch');
    const by = new Map(j.map((x) => [x.id, x.result || null]));
    return sigs.map((_, i) => by.get(i) ?? null);
  } catch {
    const out = [];
    for (const s of sigs) out.push(await getTx(rpcUrl, s).catch(() => null));
    return out;
  }
}

/** a raw transaction's account keys in index order: its own, then those its lookup tables loaded */
export const txKeys = (tx) => [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])];

// A keypair from either a solana-keygen JSON array (64 numbers) or a base58 secret key.
export function keypairFrom(secret) {
  const s = String(secret || '').trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : b58decode(s);
  if (bytes.length !== 64) throw new Error('secret key must be 64 bytes');
  return Keypair.fromSecretKey(bytes);
}

/** The ops wallet's keypair, or null when OPS_SECRET isn't set. Refuses a secret that isn't OPS_WALLET's. */
export function opsSigner(env, c) {
  if (!env.OPS_SECRET || !c.opsWallet) return null;
  const kp = keypairFrom(env.OPS_SECRET);
  if (kp.publicKey.toBase58() !== c.opsWallet) throw new Error(`OPS_SECRET is for ${kp.publicKey.toBase58()}, not OPS_WALLET ${c.opsWallet}`);
  return kp;
}

/** A v0 transaction paid by `payer`, with a compute limit and priority fee in front. */
export function buildTx(payer, ixs, blockhash, { cu = 200_000, priority = 100_000 } = {}) {
  const msg = new TransactionMessage({
    payerKey: pk(payer),
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }), ...ixs],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

export const sigOf = (tx) => b58encode(tx.signatures[0]);
const landed = (st) => st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized');

/**
 * Sends a signed transaction and polls until it's confirmed, fails, or its blockhash expires, rebroadcasting every
 * couple of seconds. -> { signature, ok, err, timeout? }
 */
export async function sendAndConfirm(conn, tx, { lastValidBlockHeight, timeoutMs = 60_000, skipPreflight = false } = {}) {
  const raw = tx.serialize();
  const signature = sigOf(tx);
  const send = (skip) => conn.sendRawTransaction(raw, { skipPreflight: skip, maxRetries: 0, preflightCommitment: 'confirmed' });
  try { await send(skipPreflight); } catch (e) {
    if (e instanceof SendTransactionError) return { signature, ok: false, err: errMsg(e), logs: e.logs || e.transactionLogs || null };
  }
  const t0 = Date.now();
  let lastSend = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1200);
    const st = (await conn.getSignatureStatuses([signature])).value?.[0];
    if (st?.err) return { signature, ok: false, err: JSON.stringify(st.err), raw: st.err };
    if (landed(st)) return { signature, ok: true };
    if (lastValidBlockHeight && (await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) {
      const again = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value?.[0];
      if (landed(again)) return { signature, ok: true };
      return { signature, ok: false, err: again?.err ? JSON.stringify(again.err) : 'blockhash expired', timeout: !!again && !again.err };
    }
    if (Date.now() - lastSend > 2500) { lastSend = Date.now(); send(true).catch(() => {}); }
  }
  return { signature, ok: false, err: 'confirmation timeout', timeout: true };
}

/** A wallet's raw balance of one mint (all its accounts of it). */
export async function tokenBalance(conn, owner, mint) {
  const { value } = await conn.getParsedTokenAccountsByOwner(pk(owner), { mint: pk(mint) }, 'confirmed');
  return value.reduce((s, a) => s + BigInt(a.account.data.parsed?.info?.tokenAmount?.amount || 0), 0n);
}
