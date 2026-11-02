// Builds the KOL list the launch page offers to bounce: every wallet kolscan (pump.fun's KOL tracker) names, with the
// KOL's X followers and their picture.
//
//   node scripts/kols.mjs                 refresh from kolscan.io, X (via fxtwitter) and kolscan's picture CDN
//   node scripts/kols.mjs --offline       rebuild data/kols.json from data/kolscan.json and the cached X lookups
//
// Writes data/kols.json (read by the worker and the seed) and web/public/kols/<wallet>.jpg (96 px, made with macOS sips).
// One KOL can trade from several wallets; each wallet is its own row, grouped by X handle on the page.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const RAW = join(ROOT, 'data/kolscan.json');
const XCACHE = join(ROOT, 'data/x-cache.json');
const OUT = join(ROOT, 'data/kols.json');
const PICS = join(ROOT, 'web/public/kols');
const offline = process.argv.includes('--offline');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kolscan() {
  const html = await (await fetch('https://kolscan.io/leaderboard', { headers: { 'user-agent': UA } })).text();
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs)].map((m) => JSON.parse(`"${m[1]}"`));
  const txt = chunks.join('');
  const seen = new Map();
  for (const m of txt.matchAll(/\{"wallet_address":"[^"]+","name":.*?"transactions":\[[^\]]*\]\}/g)) {
    try {
      const d = JSON.parse(m[0]);
      delete d.transactions;
      seen.set(d.wallet_address, d);
    } catch { /* a fragment */ }
  }
  if (seen.size < 100) throw new Error(`kolscan gave only ${seen.size} wallets; its page may have changed`);
  return [...seen.values()];
}

const handleOf = (url) => (/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(url || '') || [])[1] || null;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

async function xUser(handle) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://api.fxtwitter.com/${handle}`, { headers: { 'user-agent': UA } });
      if (r.status === 404) return { missing: true };
      if (r.status === 429) { await sleep(4000 * (t + 1)); continue; }
      const d = await r.json();
      if (!d.user) return { missing: true };
      const u = d.user;
      return { name: u.name, handle: u.screen_name, followers: u.followers ?? 0, avatar: u.avatar_url || null, verified: !!u.verification?.verified };
    } catch { await sleep(1500); }
  }
  return null;
}

async function picture(row, x) {
  const out = join(PICS, `${row.wallet_address}.jpg`);
  if (existsSync(out)) return true;
  const sources = [`https://cdn.kolscan.io/profiles/${row.wallet_address}.png`];
  if (x?.avatar) sources.push(x.avatar.replace('_normal.', '_400x400.'));
  for (const src of sources) {
    try {
      const r = await fetch(src, { headers: { 'user-agent': UA } });
      if (!r.ok || !/image\//.test(r.headers.get('content-type') || '')) continue;
      const tmp = join(tmpdir(), `kol-${row.wallet_address}`);
      writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-z', '96', '96', tmp, '--out', out], { stdio: 'ignore' });
      return true;
    } catch { /* next source */ }
  }
  return false;
}

mkdirSync(PICS, { recursive: true });
const raw = offline ? JSON.parse(readFileSync(RAW, 'utf8')) : await kolscan();
if (!offline) writeFileSync(RAW, JSON.stringify(raw, null, 1));
const cache = existsSync(XCACHE) ? JSON.parse(readFileSync(XCACHE, 'utf8')) : {};
const handles = [...new Set(raw.map((r) => handleOf(r.twitter)).filter(Boolean).map((h) => h.toLowerCase()))];
console.log(`${raw.length} wallets, ${handles.length} X handles`);

if (!offline) {
  const todo = handles.filter((h) => !cache[h]);
  let done = 0;
  await pool(todo, 4, async (h) => {
    const u = await xUser(h);
    if (u) cache[h] = { ...u, at: Date.now() };
    if (++done % 50 === 0) { console.log(`  X ${done}/${todo.length}`); writeFileSync(XCACHE, JSON.stringify(cache)); }
    await sleep(250);
  });
  writeFileSync(XCACHE, JSON.stringify(cache));
}

let pics = 0;
await pool(raw, 6, async (r) => {
  const h = handleOf(r.twitter)?.toLowerCase();
  if (offline ? existsSync(join(PICS, `${r.wallet_address}.jpg`)) : await picture(r, h && cache[h])) pics++;
});

const kols = raw.map((r) => {
  const h = handleOf(r.twitter);
  const x = h && cache[h.toLowerCase()];
  const ok = x && !x.missing;
  return {
    wallet: r.wallet_address,
    name: (r.name || '').trim() || (ok && x.name) || h || r.wallet_address.slice(0, 4),
    handle: ok ? x.handle : h,
    followers: ok ? x.followers : 0,
    verified: ok ? x.verified : false,
    telegram: r.telegram || null,
    pfp: existsSync(join(PICS, `${r.wallet_address}.jpg`)) ? `/kols/${r.wallet_address}.jpg` : null,
  };
}).sort((a, b) => b.followers - a.followers || a.name.localeCompare(b.name));

writeFileSync(OUT, JSON.stringify({ source: 'kolscan.io', updated: new Date().toISOString(), kols }, null, 1));
const big = kols.filter((k) => k.followers >= 10_000).length;
console.log(`wrote ${kols.length} KOL wallets (${big} with 10k+ followers, ${pics} pictures) to data/kols.json`);
