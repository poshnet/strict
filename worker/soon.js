// Coming soon. While COMING_SOON is "1" every page on the site (and the workers.dev address) is one "soon" page, the API
// answers 503, and the app's own files (/assets/*, the coin pictures, metadata) are withheld, so nothing leaks before
// launch. The team gets through with a preview link: /?preview=<PREVIEW_KEY> sets a cookie for 30 days, after which the
// whole site works as normal in that browser. The admin API keeps working (it has its own key), and so does the cron.
import { cfg } from './config.js';
import { json } from './util.js';

const COOKIE = 'strict_preview';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cookieOf = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === name)?.[1] || null;

/** a Response if this request gets the "soon" treatment, else null (the site handles it as usual) */
export function soonGate(req, env, url) {
  if (String(env.COMING_SOON || '') !== '1') return null;
  const key = String(env.PREVIEW_KEY || '');
  // the preview link: remember this browser, then drop the key from the address bar
  if (key && url.searchParams.get('preview') === key) {
    url.searchParams.delete('preview');
    return new Response(null, { status: 302, headers: {
      location: url.pathname + (url.search || ''),
      'set-cookie': `${COOKIE}=${key}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`,
      'cache-control': 'no-store',
    } });
  }
  if (key && cookieOf(req, COOKIE) === key) return null;
  const p = url.pathname;
  if (p.startsWith('/api/admin/')) return null;                       // has its own key
  if (p.startsWith('/assets/hero/') || p === '/robots.txt') return null; // what the soon page itself uses
  if (p.startsWith('/api/')) return json({ error: 'strict.fun opens soon.' }, 503, { 'cache-control': 'no-store' });
  if (p.startsWith('/assets/') || p.startsWith('/media/') || p.startsWith('/m/') || p.startsWith('/p/') || p.startsWith('/kols/')) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(page(env, url), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
}

function page(env, url) {
  const c = cfg(env);
  const x = `https://x.com/${c.xHandle}`;
  const title = 'strict.fun · Coming soon';
  const desc = 'Pick the rules. The code enforces them. A Solana launchpad where every coin has rules, locked at launch and checked on every buy. Strict can be fun.';
  const rules = ['No KOLs', 'No snipers', 'No dev buy', 'No bundles', 'Max wallet', 'No vamps'];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${url.origin}/og.jpg"><meta property="og:url" content="${url.origin}/">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(c.xHandle)}">
<meta name="theme-color" content="#0A0A0B"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" as="image" href="/assets/hero/explainer.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Geist+Mono:wght@600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box} html,body{margin:0;min-height:100%} html{overflow-x:hidden}
  body{background:#0A0A0B;color:#F4F3EF;font-family:Sora,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  .light{position:fixed;z-index:0;top:-10vh;right:-5vw;width:70vw;height:80vh;pointer-events:none;opacity:.5;
    -webkit-mask-image:linear-gradient(90deg,transparent 20%,#000 70%),linear-gradient(180deg,#000 50%,transparent);-webkit-mask-composite:source-in;
    mask-image:linear-gradient(90deg,transparent 20%,#000 70%),linear-gradient(180deg,#000 50%,transparent);mask-composite:intersect}
  .light img{width:100%;height:100%;object-fit:cover;object-position:75% 50%}
  .wrap{position:relative;z-index:1;max-width:1360px;margin:0 auto;padding:26px 44px 0}
  header{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:800;letter-spacing:-.04em;color:#F4F3EF;text-decoration:none}
  .mark{font-family:'Geist Mono',monospace;font-weight:600;letter-spacing:-.08em;font-size:26px}.mark b{color:#FF8A1F;font-weight:600}
  .d{color:#6E6C66}
  .follow{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-radius:12px;border:1px solid #2E2E33;color:#F4F3EF;text-decoration:none;font-size:15px;font-weight:700}
  .follow:hover{border-color:#FF8A1F;color:#FFB46E}
  .hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.08fr);grid-template-areas:'intro win' 'more win';column-gap:56px;align-items:center;padding:64px 0 72px;min-height:calc(100vh - 170px)}
  .intro{grid-area:intro;align-self:end}.more{grid-area:more;align-self:start}.win{grid-area:win}
  .soon{display:inline-flex;align-items:center;gap:10px;height:38px;padding:0 16px;border-radius:999px;background:#1E140A;border:1px solid #3D2814;color:#FFB46E;font-size:14.5px;font-weight:700}
  .soon i{width:9px;height:9px;border-radius:50%;background:#FF8A1F;box-shadow:0 0 12px #FF8A1F;animation:p 1.4s ease-in-out infinite}
  @keyframes p{50%{opacity:.3;transform:scale(.8)}}
  h1{margin:22px 0 0;font-size:clamp(58px,8.6vw,128px);font-weight:800;letter-spacing:-.06em;line-height:.9}
  h1 em{font-style:normal;color:#FF8A1F}
  .tag{margin:22px 0 0;font-size:clamp(22px,2.4vw,32px);font-weight:800;letter-spacing:-.035em;line-height:1.15}
  .tag span{color:#8E8B84}
  .lede{margin:18px 0 0;font-size:clamp(16px,1.5vw,19px);line-height:1.55;color:#B9B7B0;max-width:540px}
  .rules{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
  .rules span{height:36px;display:inline-flex;align-items:center;padding:0 14px;border-radius:10px;border:1px solid #26262A;background:rgba(19,19,21,.85);font-size:14.5px;font-weight:600;color:#D2D0C9}
  .cta{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:30px}
  .btn{display:inline-flex;align-items:center;justify-content:center;text-align:center;gap:10px;min-height:56px;padding:0 26px;border-radius:14px;font-size:17px;font-weight:800;text-decoration:none;background:#FF8A1F;color:#0A0A0B}
  .btn:hover{background:#FF9D45}
  .fun{font-size:18px;font-weight:800;letter-spacing:-.02em;color:#FF8A1F}
  /* the explainer, in a window */
  .win{position:relative;border-radius:22px;overflow:hidden;background:#141416;border:1px solid #2A2A2F;box-shadow:0 50px 120px -40px rgba(255,138,31,.35),0 30px 80px rgba(0,0,0,.6)}
  .bar{display:flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-bottom:1px solid #222226;background:#111113}
  .bar i{width:11px;height:11px;border-radius:50%;background:#2E2E33}.bar i:first-child{background:#FF8A1F}
  .bar span{margin-left:10px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:#8E8B84}
  .bar b{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#FFB46E}
  .bar b::before{content:'';width:7px;height:7px;border-radius:50%;background:#FF5C6A;box-shadow:0 0 8px #FF5C6A;animation:p 1.4s ease-in-out infinite}
  .win video,.win img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#0A0A0B}
  footer{position:relative;z-index:1;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;max-width:1360px;margin:0 auto;padding:40px 44px 34px;font-size:14px;color:#7A7872}
  footer a{color:#B9B7B0;text-decoration:none}
  @media (prefers-reduced-motion:reduce){.soon i{animation:none}}
  @media (max-width:980px){.hero{grid-template-columns:minmax(0,1fr);grid-template-areas:'intro' 'win' 'more';row-gap:30px;padding:36px 0 44px}}
  @media (max-width:760px){.wrap{padding:20px 18px 0}.follow span{display:none}.btn{width:100%}.cta{gap:12px}.light{width:120vw;opacity:.3}footer{padding:30px 18px 28px}}
</style></head>
<body>
<div class="light" aria-hidden="true"><img src="/assets/hero/edge.jpg" alt=""></div>
<div class="wrap">
  <header>
    <a class="brand" href="/" aria-label="strict.fun"><span class="mark"><b>{</b>s<b>}</b></span><span>strict<span class="d">.fun</span></span></a>
    <a class="follow" href="${x}" target="_blank" rel="noopener">X <span>@${esc(c.xHandle)}</span></a>
  </header>
  <section class="hero">
    <div class="intro">
      <span class="soon"><i></i>Launching soon on Solana</span>
      <h1>Coming<br><em>soon.</em></h1>
      <p class="tag">Pick the rules.<br><span>The code enforces them.</span></p>
    </div>
    <div class="more">
      <p class="lede">Every coin launches with rules its creator picks, locked on chain and checked on every buy until it bonds.</p>
      <div class="rules">${rules.map((r) => `<span>${r}</span>`).join('')}</div>
      <div class="cta"><a class="btn" href="${x}" target="_blank" rel="noopener">Follow @${esc(c.xHandle)} for the launch</a><span class="fun">Strict can be fun.</span></div>
    </div>
    <div class="win">
      <div class="bar"><i></i><i></i><i></i><span>strict.fun</span><b>Preview</b></div>
      <video src="/assets/hero/explainer.mp4" poster="/assets/hero/explainer.jpg" autoplay muted loop playsinline preload="auto" aria-label="What strict.fun does: four launches dying four ways, then the rules at work"></video>
    </div>
  </section>
</div>
<footer><span>strict.fun</span><span>${c.sourceUrl ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">Source</a> · ` : ''}<a href="${x}" target="_blank" rel="noopener">X @${esc(c.xHandle)}</a></span></footer>
</body></html>`;
}
