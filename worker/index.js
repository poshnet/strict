// The worker: the API (the board, coins and their rules, lists, what each rule stopped, the KOL directory, launches,
// trades, the anti-vamp check), the minute cron (the index, then the cranks) and share previews. The app itself is static (web/, built to web/dist) and served as assets.
import { RANGES, analytics } from './analytics.js';
import { sessionWallet, signIn, signInMessage } from './auth.js';
import { cached } from './cache.js';
import { cfg, publicConfig } from './config.js';
import { runCranks } from './crank.js';
import { indexSignature, liveCurve, runIndex } from './indexer.js';
import { KOLS_UPDATED } from './kols.js';
import { closeTx, prepare, submit, vampPanel } from './launch.js';
import {
  SORTS, candles, coinByMint, coinList, coinStops, directory, feed, holders, kolProfile, listCoins, sniperReplay, solUsd, stats, trades, walletCheck,
} from './market.js';
import { metadataJson, serveMedia, upload } from './media.js';
import { passJson, passStatus } from './pass.js';
import { soonGate } from './soon.js';
import { appPage } from './seo.js';
import { VersionedTransaction, connection, pk, sendAndConfirm, tokenBalance } from './sol.js';
import { simulateBounce } from './simulate.js';
import { buildTrade } from './trade.js';
import { HttpError, b64decode, countHit, errMsg, isBase58Address, json, setState } from './util.js';
import { ERRORS, RULE_ERRORS } from './program.js';

/** what a buyer is told when one of the coin's rules stops their buy */
const RULE_MESSAGES = {
  Bounced: "This wallet is on the coin's no-KOLs list. It can buy once the coin bonds.",
  DevBuy: "This coin has no dev buy: its creator's wallet can't buy it before it bonds.",
  Bundled: 'This coin has no bundles: nothing can buy in the block it was created in. Try again in a second.',
  OverCap: "This buy would take your wallet past the coin's max wallet.",
};
const ERROR_INDEX = Object.fromEntries(Object.keys(RULE_ERRORS).map((n) => [n, ERRORS.indexOf(n)]));

const routes = [];
const on = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
const limit = async (req, bucket, max, sec, who) => { if ((await countHit(req, bucket, max, sec, who)).limited) throw new HttpError(429, 'Too many requests. Slow down a little.'); };
const body = async (req) => { try { return await req.json(); } catch { throw new HttpError(400, 'Expected a JSON body.'); } };
const q = (req) => Object.fromEntries(new URL(req.url).searchParams);
const addr = (v, name = 'address') => { if (!isBase58Address(v)) throw new HttpError(400, `bad ${name}`); return v; };
const pub = (s) => ({ 'cache-control': `public, max-age=${s}` });

// ---------- read ----------
on('GET', '/api/config', async (req, env) => json({ ...publicConfig(env), solUsd: await solUsd().catch(() => null), kolsUpdated: KOLS_UPDATED }, 200, pub(30)));
on('GET', '/api/stats', async (req, env) => json(await cached('stats', 10, () => stats(env)), 200, pub(10)));
on('GET', '/api/analytics', async (req, env) => {
  const range = RANGES.includes(q(req).range) ? q(req).range : '7d';
  return json(await cached(`analytics:${range}`, 30, () => analytics(env, range)), 200, pub(30));
});
on('GET', '/api/feed', async (req, env) => json({ events: await cached('feed', 5, () => feed(env)) }, 200, pub(5)));
on('GET', '/api/coins', async (req, env) => {
  const o = q(req);
  const sort = SORTS.includes(o.sort) ? o.sort : 'new';
  if (o.creator) addr(o.creator, 'creator');
  const key = `coins:${sort}:${o.q || ''}:${o.limit || ''}:${o.offset || ''}:${o.creator || ''}`;
  return json({ coins: await cached(key, 4, () => listCoins(env, { sort, q: o.q, limit: o.limit, offset: o.offset, creator: o.creator })) }, 200, pub(4));
});
on('GET', '/api/coin/:mint', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  const coin = await coinByMint(env, mint);
  if (!coin) throw new HttpError(404, "That coin isn't on strict.fun.");
  const live = await cached(`curve:${mint}`, 3, () => liveCurve(env, cfg(env), mint)).catch(() => null);
  return json({ coin, live });
});
on('GET', '/api/coin/:mint/pass', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  const s = await cached(`pass:${mint}`, 10, () => passStatus(env, cfg(env), mint));
  if (!s) throw new HttpError(404, "That coin isn't on strict.fun.");
  return json(s, 200, pub(10));
});
on('GET', '/api/coin/:mint/list', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  const o = q(req);
  return json(await cached(`list:${mint}:${o.q || ''}`, 30, () => coinList(env, mint, { q: o.q })), 200, pub(30));
});
on('GET', '/api/coin/:mint/trades', async (req, env, p) => json({ trades: await cached(`trades:${p.mint}`, 3, () => trades(env, addr(p.mint, 'mint'))) }, 200, pub(3)));
on('GET', '/api/coin/:mint/candles', async (req, env, p) => {
  const tf = ['1m', '5m', '15m', '1h', '4h', '1d'].includes(q(req).tf) ? q(req).tf : '1m';
  const mint = addr(p.mint, 'mint');
  return json({ candles: await cached(`candles:${mint}:${tf}`, 4, () => candles(env, mint, tf)) }, 200, pub(4));
});
on('GET', '/api/coin/:mint/holders', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  return json({ holders: await cached(`holders:${mint}`, 30, () => holders(env, cfg(env), mint)) }, 200, pub(30));
});
on('GET', '/api/coin/:mint/sniper', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  return json(await cached(`sniper:${mint}`, 3, () => sniperReplay(env, mint)), 200, pub(3));
});
// what each of the coin's rules has done: buys stopped (by rule), what snipers paid, who holds what
on('GET', '/api/coin/:mint/stops', async (req, env, p) => {
  const mint = addr(p.mint, 'mint');
  return json(await cached(`stops:${mint}`, 5, () => coinStops(env, cfg(env), mint)), 200, pub(5));
});
on('GET', '/api/kols', async (req, env) => json({ kols: await cached('directory', 60, () => directory(env)), updated: KOLS_UPDATED }, 200, pub(60)));
on('GET', '/api/kol/:id', async (req, env, p) => {
  const r = await cached(`kol:${p.id.toLowerCase()}`, 30, () => kolProfile(env, decodeURIComponent(p.id)));
  if (!r) throw new HttpError(404, "That KOL isn't in the directory.");
  return json(r, 200, pub(30));
});
on('GET', '/api/check/:wallet', async (req, env, p) => json(await cached(`check:${p.wallet}`, 15, () => walletCheck(env, addr(p.wallet, 'wallet'))), 200, pub(15)));
on('GET', '/api/balance/:wallet', async (req, env, p) => {
  const wallet = addr(p.wallet, 'wallet');
  await limit(req, 'balance', 90, 60);
  const mint = q(req).mint;
  const conn = connection(cfg(env).rpcUrl);
  const [sol, raw] = await Promise.all([conn.getBalance(pk(wallet), 'confirmed'), mint && isBase58Address(mint) ? tokenBalance(conn, wallet, mint).catch(() => 0n) : 0n]);
  return json({ sol: sol / 1e9, raw: String(raw) });
});

// ---------- write ----------
// the launch form's live anti-vamp panel: each part as it's typed
on('POST', '/api/vamp-check', async (req, env) => {
  const b = await body(req);
  await limit(req, 'vamp', 120, 60);
  return json(await vampPanel(env, cfg(env), b || {}));
});
on('POST', '/api/upload', async (req, env) => {
  await limit(req, 'upload', 20, 600);
  return json(await upload(env, cfg(env), req));
});
on('POST', '/api/launch/prepare', async (req, env) => {
  const b = await body(req);
  await limit(req, 'prepare', 12, 600, isBase58Address(b?.creator) ? b.creator : undefined);
  return json(await prepare(env, cfg(env), b));
});
// streams one JSON line a step ({ step: 'list', done, of } ... { step: 'live', mint }), then the result
on('POST', '/api/launch/:id/submit', async (req, env, p, ctx) => {
  const b = await body(req);
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const line = (o) => w.write(new TextEncoder().encode(`${JSON.stringify(o)}\n`)).catch(() => {});
  const work = (async () => {
    try {
      const r = await submit(env, cfg(env), p.id, b?.txs, line);
      await line({ step: r.error ? 'error' : 'done', ...r });
    } catch (e) {
      await line({ step: 'error', error: e instanceof HttpError ? e.message : errMsg(e), resumable: true, id: p.id });
    } finally { await w.close().catch(() => {}); }
  })();
  ctx.waitUntil(work);
  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
});
on('POST', '/api/launch/:id/close', async (req, env, p) => {
  const b = await body(req);
  return json(await closeTx(env, cfg(env), p.id, addr(b?.creator, 'creator')));
});
on('POST', '/api/trade', async (req, env) => {
  const b = await body(req);
  await limit(req, 'trade', 60, 60, isBase58Address(b?.wallet) ? b.wallet : undefined);
  return json(await buildTrade(env, cfg(env), req, b));
});
// a transaction the wallet signed but didn't send: send it, wait for it, read it into the index
on('POST', '/api/send', async (req, env, p, ctx) => {
  const b = await body(req);
  await limit(req, 'send', 60, 60);
  let tx;
  try { tx = VersionedTransaction.deserialize(b64decode(String(b?.tx || ''))); } catch { throw new HttpError(400, 'bad transaction'); }
  const c = cfg(env);
  const r = await sendAndConfirm(connection(c.rpcUrl), tx, { lastValidBlockHeight: Number(b.lastValidBlockHeight) || undefined });
  if (r.ok) ctx.waitUntil(indexSignature(env, c, r.signature).catch(() => {}));
  if (!r.ok) {
    const code = (n) => 6000 + ERROR_INDEX[n];
    const name = Object.keys(RULE_ERRORS).find((n) => r.err?.includes(`Error Code: ${n}`) || r.err?.includes(`"Custom":${code(n)}`) || r.err?.includes(`0x${code(n).toString(16)}`));
    if (name) throw new HttpError(403, RULE_MESSAGES[name], { rule: RULE_ERRORS[name] });
    throw new HttpError(400, `The transaction failed: ${r.err}`);
  }
  return json({ signature: r.signature });
});
// "watch a bounce": the same small buy simulated from a listed wallet and from one that isn't (simulate.js)
on('POST', '/api/simulate', async (req, env) => {
  const b = await body(req);
  await limit(req, 'simulate', 20, 60);
  return json(await cached(`sim:${b?.mint}:${b?.wallet || ''}`, 20, () => simulateBounce(env, cfg(env), b || {})));
});
on('POST', '/api/ingest', async (req, env) => {
  const b = await body(req);
  await limit(req, 'ingest', 60, 60);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(String(b?.sig || ''))) throw new HttpError(400, 'bad signature');
  return json(await indexSignature(env, cfg(env), b.sig));
});
on('GET', '/api/auth/message', (req, env) => json({ message: signInMessage(addr(q(req).wallet, 'wallet'), new URL(req.url).host) }));
on('POST', '/api/auth/verify', async (req, env) => json(await signIn(env, await body(req), new URL(req.url).host)));
on('GET', '/api/auth/me', async (req, env) => json({ wallet: await sessionWallet(env, req) }));

// ---------- admin ----------
on('POST', '/api/admin/run', async (req, env) => {
  if (!env.ADMIN_KEY || req.headers.get('x-admin-key') !== env.ADMIN_KEY) throw new HttpError(401, 'nope');
  const task = q(req).task || 'all';
  const c = cfg(env);
  const out = {};
  if (task === 'index' || task === 'all') out.index = await runIndex(env, c);
  if (task === 'crank' || task === 'all') out.crank = await runCranks(env, c);
  return json(out);
});

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const soon = soonGate(req, env, url); // COMING_SOON: one page for everyone without the preview cookie
  if (soon) return soon;
  if (url.pathname.startsWith('/media/') && req.method === 'GET') return serveMedia(env, url.pathname.slice(7));
  const meta = /^\/m\/([1-9A-HJ-NP-Za-km-z]{32,44})\.json$/.exec(url.pathname);
  if (meta) return metadataJson(env, cfg(env), meta[1]);
  const passMeta = /^\/p\/([1-9A-HJ-NP-Za-km-z]{32,44})\.json$/.exec(url.pathname);
  if (passMeta) return passJson(env, cfg(env), passMeta[1]);
  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (m) return r.handler(req, env, m.groups || {}, ctx);
    }
    throw new HttpError(404, 'No such endpoint.');
  }
  return (await appPage(req, env, url)) || env.ASSETS.fetch(req);
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      console.log('error', req.method, req.url, errMsg(e));
      return json({ error: 'Something went wrong on our side. Try again.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    const c = cfg(env);
    ctx.waitUntil((async () => {
      try { await runIndex(env, c); } catch (e) { console.log('index', errMsg(e)); }
      try { await runCranks(env, c); } catch (e) { console.log('crank', errMsg(e)); }
      await setState(env, 'cron:last', Date.now());
    })());
  },
};
