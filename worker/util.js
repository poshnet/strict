// Small helpers shared by every module (no Solana imports here, so the router stays light).

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; if (extra) this.extra = extra; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Counts a request against a per-IP limit of `max` per `windowSec`, in fixed windows kept in Cloudflare's cache (a count
 * is per data center, which is close enough for abuse limits). `who` overrides the IP (a wallet, say).
 */
export async function countHit(req, bucket, max, windowSec, who) {
  const id = who || req.headers.get('cf-connecting-ip') || 'local';
  const win = Math.floor(Date.now() / (windowSec * 1000));
  const key = new Request(`https://rl.internal/strict/${bucket}/${id}/${win}`);
  const hit = await caches.default.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= max) return { limited: true };
  await caches.default.put(key, new Response(String(n + 1), { headers: { 'cache-control': `public, s-maxage=${windowSec}` } }));
  return { limited: false };
}

// ---------- base58 / base64 ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));

export function b58encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let s = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
  return s;
}

export function b58decode(str) {
  const bytes = [0];
  for (const c of str) {
    const v = B58_MAP[c];
    if (v === undefined) throw new Error('invalid base58');
    let carry = v;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const c of str) { if (c === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

export const b64encode = (bytes) => Buffer.from(bytes).toString('base64');
export const b64decode = (s) => new Uint8Array(Buffer.from(s, 'base64'));

export const isBase58Address = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

export function randomId(n = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => B58[b % 58]).join('');
}

export async function sha256hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// One line for logs and stored errors (web3.js send errors are multi-line and end in a how-to-debug paragraph).
export function errMsg(e) {
  const m = (e?.message || String(e)).replace(/\s*Catch the `SendTransactionError`[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  return m.length > 300 ? m.slice(0, 300) + '…' : m;
}

// D1's key/value table: cursors, the master wallet's balance, the cron's last runs.
export const getState = async (env, k) => (await env.DB.prepare('SELECT v FROM state WHERE k = ?').bind(k).first())?.v ?? null;
export const setState = (env, k, v) => env.DB.prepare('INSERT INTO state (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at')
  .bind(k, String(v), Date.now()).run();
