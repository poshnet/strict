// Coin pictures (R2, at /media/coin/<sha256>.<ext>) and each coin's metadata JSON (/m/<mint>.json), the uri its
// Metaplex metadata points at. A picture is stored by its hash, so the same file uploaded twice is one object. A PNG
// (the launch form sends one, 512 x 512) also gets its anti-vamp fingerprint worked out here from its pixels.
import { HttpError, errMsg, json, sha256hex } from './util.js';
import { dHash, decodePng } from './vamp.js';

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX = 4 * 1024 * 1024;

export async function upload(env, c, req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  const ext = TYPES[type];
  if (!ext) throw new HttpError(415, 'Use a PNG, JPG, WEBP or GIF.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'That file is empty.');
  if (buf.length > MAX) throw new HttpError(413, 'Pictures can be up to 4 MB.');
  const key = `coin/${(await sha256hex(buf)).slice(0, 40)}.${ext}`;
  if (!(await env.MEDIA.head(key))) await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' } });
  let hash = null;
  if (ext === 'png') {
    try { hash = dHash(await decodePng(buf)); } catch (e) { console.log('dhash', errMsg(e)); }
    await env.DB.prepare('INSERT OR REPLACE INTO media (key, img_hash, created_at) VALUES (?, ?, ?)').bind(key, hash, Date.now()).run();
  }
  return { url: `${c.siteUrl}/media/${key}`, path: `/media/${key}`, hash };
}

export async function serveMedia(env, key) {
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' } });
}

/** the coin's off-chain metadata: what wallets and explorers show */
export async function metadataJson(env, c, mint) {
  const row = await env.DB.prepare('SELECT name, symbol, description, image, twitter, telegram, website FROM coins WHERE mint = ?').bind(mint).first()
    || await env.DB.prepare('SELECT meta FROM launches WHERE mint = ?').bind(mint).first().then((r) => (r ? JSON.parse(r.meta) : null));
  if (!row) return json({ error: 'unknown mint' }, 404);
  const out = { name: row.name, symbol: row.symbol, description: row.description || '', image: row.image, showName: true, createdOn: c.siteUrl };
  for (const k of ['twitter', 'telegram', 'website']) if (row[k]) out[k] = row[k];
  return json(out, 200, { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
}
