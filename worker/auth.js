// Wallet sign-in: one signed message, no transaction, no gas. It's optional: it makes a refused buy count as a bounce
// (a signed-in wallet asking for a buy it's barred from is provably that wallet), and nothing else needs it.
import { HttpError, b58decode, b58encode, isBase58Address, sha256hex } from './util.js';

const SESSION_DAYS = 30;
const enc = new TextEncoder();

export function signInMessage(wallet, host) {
  return `${host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to strict.fun. This costs nothing and sends no transaction.\n\nIssued At: ${new Date().toISOString()}`;
}

export async function signIn(env, body, host) {
  const { wallet, message } = body || {};
  if (!isBase58Address(wallet) || typeof message !== 'string') throw new HttpError(400, 'wallet and message are required');
  const lines = message.split('\n');
  if (lines[0] !== `${host} wants you to sign in with your Solana account:` || lines[1] !== wallet) throw new HttpError(400, 'That message is not a sign-in for this site.');
  const issued = Date.parse((/Issued At: (.+)$/m.exec(message) || [])[1] || '');
  if (!(Date.now() - issued < 10 * 60_000 && issued - Date.now() < 60_000)) throw new HttpError(400, 'That sign-in expired. Try again.');
  let sig;
  try { sig = b58decode(String(body.signature)); } catch { throw new HttpError(400, 'bad signature'); }
  const key = await crypto.subtle.importKey('raw', b58decode(wallet), { name: 'Ed25519' }, false, ['verify']);
  if (sig.length !== 64 || !(await crypto.subtle.verify('Ed25519', key, sig, enc.encode(message)))) throw new HttpError(401, 'The signature does not match that wallet.');
  const token = b58encode(crypto.getRandomValues(new Uint8Array(32)));
  const t = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, wallet, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256hex(enc.encode(token)), wallet, t, t + SESSION_DAYS * 86_400_000).run();
  return { token, wallet };
}

export async function sessionWallet(env, req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT wallet, expires_at FROM sessions WHERE token = ?').bind(await sha256hex(enc.encode(m[1]))).first();
  return row && row.expires_at > Date.now() ? row.wallet : null;
}
