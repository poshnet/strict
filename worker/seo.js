// Share previews: every app route gets the same index.html, with the coin's own title, description and picture on
// /coin/:mint (or just /:mint) and the KOL's on /kol/:id, so a link posted on X or Telegram unfurls as what it points at.
import { cfg } from './config.js';
import { personById_ } from './kols.js';
import { coinByMint } from './market.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const n = (x) => Number(x || 0).toLocaleString('en-US');

async function preview(env, url) {
  const c = cfg(env);
  let m = /^\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(url.pathname);
  if (m) {
    const coin = await coinByMint(env, m[1]);
    if (!coin) return null;
    const r = coin.rules;
    const picked = [r.kols && 'no KOLs', r.snipers && 'no snipers', r.dev && 'no dev buy', r.bundles && 'no bundles',
      r.maxWalletBps && `max wallet ${r.maxWalletBps / 100}%`, r.vamps && 'no vamps'].filter(Boolean);
    const rules = picked.length ? `Plays by ${picked.length} strict rule${picked.length === 1 ? '' : 's'}: ${picked.join(', ')}.` : 'No rules picked.';
    const stops = coin.stopped ? ` ${n(coin.stopped)} buy${coin.stopped === 1 ? '' : 's'} stopped so far.` : '';
    return { title: `${coin.name} ($${coin.symbol}) · ${c.siteName}`, desc: `${rules}${stops} ${coin.description || ''}`.trim().slice(0, 280), img: coin.image, card: 'summary' };
  }
  m = /^\/kol\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const p = personById_(decodeURIComponent(m[1]));
    if (!p) return null;
    return { title: `${p.name}${p.handle ? ` (@${p.handle})` : ''} · ${c.siteName}`, desc: `${n(p.followers)} followers. See which strict coins keep ${p.name}'s wallets out until they bond.`, img: p.pfp ? `${url.origin}${p.pfp}` : null, card: 'summary' };
  }
  return null;
}

export async function appPage(req, env, url) {
  const p = await preview(env, url);
  if (!p) return null;
  const res = await env.ASSETS.fetch(new Request(new URL('/', url), req));
  let html = await res.text();
  const img = p.img || `${url.origin}/og.jpg`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(p.desc)}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(p.title)}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(p.desc)}"`)
    .replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(img)}"`)
    .replace(/(<meta name="twitter:card" content=")[^"]*"/, `$1${p.card}`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
}
