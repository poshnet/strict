// Edge cache (Workers Cache API) with an in-isolate memo in front, so hot reads hit coinpair or D1 at most once per TTL
// per data center. Concurrent misses in one isolate share a single call, but never wait on one for long: a call that
// stalls (a hung upstream, a slow database) is passed over after STALL_MS, and with a last good value in hand a slow
// refresh only gets a moment before that value is served. Otherwise one stuck call holds every later request.
const memo = new Map();
// Workers on one workers.dev subdomain share an edge cache: every key carries this worker's name
const NS = 'strict';

const STALL_MS = 6_000;
const GIVE_UP_MS = 25_000; // with nothing to fall back on, a request errors rather than hangs

const after = (ms, fn) => new Promise((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, ms));

export async function cached(key, ttlSec, fn) {
  const now = Date.now();
  const m = memo.get(key);
  if (m && m.exp > now) return m.val;
  let pending = m?.pending && now - m.started < STALL_MS ? m.pending : null;
  if (!pending) {
    const cache = globalThis.caches?.default;
    const req = new Request(`https://cache.internal/${NS}/${encodeURIComponent(key)}`);
    pending = (async () => {
      if (cache) {
        const hit = await cache.match(req);
        if (hit) return hit.json();
      }
      const val = await fn();
      if (cache) {
        await cache.put(req, new Response(JSON.stringify(val), { headers: { 'content-type': 'application/json', 'cache-control': `public, s-maxage=${ttlSec}` } })).catch(() => {});
      }
      return val;
    })();
    const mine = pending;
    memo.set(key, { val: m?.val, exp: 0, pending, started: now });
    pending.then(
      (val) => { if (memo.get(key)?.pending === mine) memo.set(key, { val, exp: Date.now() + Math.min(ttlSec, 30) * 1000 }); },
      () => { if (memo.get(key)?.pending === mine) memo.set(key, { val: m?.val, exp: 0 }); },
    );
  }
  // the last good value beats an error, and beats waiting
  if (m?.val !== undefined) return Promise.race([pending.catch(() => m.val), after(1_500, () => m.val)]);
  return Promise.race([pending, after(GIVE_UP_MS, () => { throw new Error(`${key} timed out`); })]);
}

export async function uncache(key) {
  memo.delete(key);
  await globalThis.caches?.default?.delete(new Request(`https://cache.internal/${NS}/${encodeURIComponent(key)}`)).catch(() => {});
}
