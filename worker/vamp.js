// No vamps (a rule a creator can pick): while a coin that picked it is live, nobody can launch a coin with its ticker,
// its name, its X account or its picture. Ported from betterlaunch.fun.
//   ticker / name: folded to a key (case, spaces, punctuation, accents, repeated letters, and lookalikes: 0 for o,
//     Cyrillic а for a, rn for m...), so $P3PE, $pepe and $PEEPE are all $PEPE. A key that is a protected one plus a
//     classic vamp prefix or suffix (baby, inu, ai, 2, v2...) counts as taken too, and names are checked against tickers.
//     A few big coins' tickers are reserved for everyone, so nobody launches a fake $SOL here.
//   X: one protected coin per account (or community).
//   picture: a 64-bit difference hash of the picture, worked out from its pixels (the launch form uploads a 512 x 512
//     PNG; media.js hashes it), compared with every protected coin's: a recolour, crop or re-save is still the same picture.
// This is a check this site runs when a coin is created, not a program rule: the pages say so.
import { cached } from './cache.js';
import { HttpError } from './util.js';

const LOOK = {
  0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '!': 'i', '|': 'i', '@': 'a', '$': 's', l: 'i',
  // Cyrillic and Greek letters that pass for Latin ones
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', ӏ: 'i',
  α: 'a', β: 'b', γ: 'y', ε: 'e', η: 'n', ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w', ϲ: 'c',
};
const PREFIXES = ['the', 'baby', 'mini', 'real', 'og'];
const SUFFIXES = ['inu', 'ai', 'coin', 'token', 'z', 'classic', 'og', 'vz', 'cto']; // z and vz: a 2 and a v2, folded
const RESERVED = ['sol', 'btc', 'eth', 'usdc', 'usdt', 'bonk', 'wif', 'pepe', 'trump', 'jup', 'pump', 'strict', 'strictfun', 'nokol', 'popcat',
  'fartcoin', 'mew', 'pengu', 'spx', 'jito', 'ray', 'wsol', 'melania'];

/** A ticker or name folded to its anti-vamp key. */
export function vampKey(s) {
  const raw = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/^\$+/, '');
  let x = [...raw].map((ch) => LOOK[ch] ?? ch).join('').replace(/rn/g, 'm').replace(/vv/g, 'w');
  x = x.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
  return x || raw.replace(/\s+/g, ''); // a ticker with no Latin letters (中文, emoji) is kept as written
}

// The key itself plus what it is with a vamp prefix or suffix taken off.
function stems(key) {
  const out = new Set([key]);
  for (const p of PREFIXES) if (key.startsWith(p) && key.length - p.length >= 3) out.add(key.slice(p.length));
  for (const s of [...out]) for (const suf of SUFFIXES) if (s.endsWith(suf) && s.length - suf.length >= 3) out.add(s.slice(0, -suf.length));
  return [...out];
}

/** An X link or handle as the account it belongs to: "froglord", or "community:123" for an X community. */
export function xKey(link) {
  const s = String(link || '').trim();
  if (!s) return null;
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(s)) return s.replace(/^@/, '').toLowerCase();
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/(^|\.)(x|twitter)\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'i' && parts[1] === 'communities' && parts[2]) return `community:${parts[2]}`;
    return parts[0] ? parts[0].toLowerCase() : null;
  } catch { return null; }
}

// protected coins: live ones that picked no vamps (a coin that bonded is still protected; its pool is live)
const PROTECTED = 'no_vamps = 1';
const hashes = (env) => cached('vamp:hashes', 20, async () => (await env.DB.prepare(
  `SELECT mint, symbol, img_hash FROM coins WHERE ${PROTECTED} AND img_hash IS NOT NULL`,
).all()).results.filter((h) => !plain(h.img_hash)));

const hamming = (a, b) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
};
const SAME_PICTURE = 6; // bits of 64 that may differ
// a flat picture or a smooth left-to-right fade has no edges to fingerprint: every such picture hashes the same, so
// it can't tell one coin from another and is never compared
const plain = (h) => h === '0000000000000000' || h === 'ffffffffffffffff';

/**
 * Checks each part of a launch. -> { ticker, name, x, picture }: each { ok, reason } (picture/x null when not given).
 */
export async function vampCheck(env, c, { symbol, name, twitter, imgHash }) {
  const out = { ticker: { ok: true, reason: null }, name: { ok: true, reason: null }, x: null, picture: null };
  const tk = symbol ? vampKey(symbol) : null;
  const nk = name ? vampKey(name) : null;
  const taken = async (key) => {
    const s = stems(key);
    const marks = s.map(() => '?').join(',');
    return env.DB.prepare(`SELECT mint, symbol FROM coins WHERE ${PROTECTED} AND (ticker_key IN (${marks}) OR name_key IN (${marks})) LIMIT 1`)
      .bind(...s, ...s).first();
  };
  const reserved = new Set(RESERVED);
  if (tk) {
    const hit = await taken(tk);
    if (hit) out.ticker = { ok: false, reason: `too close to $${hit.symbol}`, mint: hit.mint };
    else if (reserved.has(tk)) out.ticker = { ok: false, reason: 'reserved: a big coin uses it' };
  }
  if (nk) {
    const hit = await taken(nk);
    if (hit) out.name = { ok: false, reason: `too close to $${hit.symbol}`, mint: hit.mint };
  }
  if (twitter) {
    const k = xKey(twitter);
    if (!k) out.x = { ok: false, reason: "that isn't an X account link" };
    else {
      const hit = await env.DB.prepare(`SELECT mint, symbol FROM coins WHERE ${PROTECTED} AND x_key = ? LIMIT 1`).bind(k).first();
      out.x = hit ? { ok: false, reason: `already used by $${hit.symbol}`, mint: hit.mint } : { ok: true, reason: null };
    }
  }
  if (imgHash) {
    if (!/^[0-9a-f]{16}$/.test(imgHash)) out.picture = { ok: false, reason: "couldn't read the picture" };
    else if (plain(imgHash)) out.picture = { ok: true, reason: 'too plain to fingerprint' };
    else {
      const hit = (await hashes(env)).find((h) => hamming(h.img_hash, imgHash) <= SAME_PICTURE);
      out.picture = hit ? { ok: false, reason: `that's $${hit.symbol}'s picture`, mint: hit.mint } : { ok: true, reason: null };
    }
  }
  return out;
}

export const vampFailures = (r) => Object.entries(r).filter(([, v]) => v && !v.ok).map(([k, v]) => `${k === 'x' ? 'X account' : k}: ${v.reason}`);

// ---------- the picture ----------
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An 8-bit RGB(A), non-interlaced PNG (what a canvas makes) -> its pixels. */
export async function decodePng(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 33 || SIG.some((b, i) => buf[i] !== b)) throw new HttpError(400, 'The picture must come from the launch form (a PNG).');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, size = 0;
  const idat = [];
  while (o + 8 <= buf.length) {
    const len = dv.getUint32(o);
    const t = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    if (t === 'IHDR') { w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); depth = buf[o + 16]; type = buf[o + 17]; interlace = buf[o + 20]; }
    else if (t === 'IDAT') { idat.push(buf.subarray(o + 8, o + 8 + len)); size += len; }
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2) || interlace !== 0 || w < 32 || h < 32 || w > 1024 || h > 1024) {
    throw new HttpError(400, 'The picture must come from the launch form (an 8-bit PNG up to 1024 px).');
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of idat) { all.set(part, at); at += part.length; }
  const raw = await inflate(all);
  const bpp = type === 6 ? 4 : 3;
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) throw new HttpError(400, "The picture couldn't be read.");
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new HttpError(400, "The picture couldn't be read.");
      cur[x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

/**
 * The 64-bit difference hash: the picture (on white) in grey, shrunk to 9 x 8 by averaging, each bit whether a cell is
 * brighter than its right neighbour. The launch form runs the same code on the same pixels (web/src/lib/image.ts).
 */
export function dHash({ w, h, bpp, px }) {
  const cells = [];
  for (let cy = 0; cy < 8; cy++) {
    const y0 = Math.floor((cy * h) / 8), y1 = Math.floor(((cy + 1) * h) / 8);
    for (let cx = 0; cx < 9; cx++) {
      const x0 = Math.floor((cx * w) / 9), x1 = Math.floor(((cx + 1) * w) / 9);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * bpp;
          const a = bpp === 4 ? px[i + 3] / 255 : 1;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          sum += lum * a + 255 * (1 - a);
        }
      }
      cells.push(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  let bits = 0n;
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) bits = (bits << 1n) | (cells[cy * 9 + cx] > cells[cy * 9 + cx + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}
