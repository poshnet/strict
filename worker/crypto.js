// Mint keys waiting for their launch (launches, mint_pool) are stored in D1 encrypted with AES-256-GCM under VAULT_KEY
// (base64, 32 bytes; a wrangler secret). Format: "v1:" + base64(iv[12] | ciphertext+tag).
import { b64decode, b64encode } from './util.js';

let cached = null;
async function key(env) {
  if (cached && cached.raw === env.VAULT_KEY) return cached.key;
  if (!env.VAULT_KEY) throw new Error('VAULT_KEY secret is not set');
  const raw = b64decode(env.VAULT_KEY);
  if (raw.length !== 32) throw new Error('VAULT_KEY must be 32 bytes, base64 encoded');
  const k = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cached = { raw: env.VAULT_KEY, key: k };
  return k;
}

export async function encryptSecret(env, bytes, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await key(env), bytes,
  ));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return 'v1:' + b64encode(out);
}

export async function decryptSecret(env, str, aad = '') {
  if (!str?.startsWith('v1:')) throw new Error('unknown vault secret format');
  const buf = b64decode(str.slice(3));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: new TextEncoder().encode(aad) }, await key(env), buf.slice(12),
  );
  return new Uint8Array(pt);
}
