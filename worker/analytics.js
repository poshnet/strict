// The analytics page's numbers for one range (24h, 7d, 30d, all): totals against the period before, a series bucketed
// by hour (24h) or day (week buckets once "all" passes 90 days), the KOLs bounced most and the coins traded most.
// Volume is what the curve took in or paid out (a buy after its fees, a sell before them), as coins.volume_sol counts it;
// the sniper curve's share of a fee is whatever it charged above the 1% base, as the coin page's replay counts it.
import { card, personOf } from './kols.js';

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const RANGES = ['24h', '7d', '30d', 'all'];

async function span(env, range, now) {
  if (range === '24h') return { bucket: HOUR, start: Math.floor(now / HOUR) * HOUR - 23 * HOUR, n: 24 };
  if (range !== 'all') {
    const days = range === '7d' ? 7 : 30;
    return { bucket: DAY, start: Math.floor(now / DAY) * DAY - (days - 1) * DAY, n: days };
  }
  const first = (await env.DB.prepare('SELECT MIN(created_at) t FROM coins').first())?.t || now;
  let start = Math.floor(first / DAY) * DAY;
  let n = Math.max(1, Math.ceil((now - start + 1) / DAY));
  if (n <= 90) return { bucket: DAY, start, n };
  start = Math.floor(first / (7 * DAY)) * 7 * DAY;
  return { bucket: 7 * DAY, start, n: Math.ceil((now - start + 1) / (7 * DAY)) };
}

export async function analytics(env, range = '7d') {
  const now = Date.now();
  const { bucket, start, n } = await span(env, range, now);
  const prev = range === 'all' ? start : start - n * bucket; // 'all' has no period before it
  const shield = 'MAX(0, fee_total - (CASE WHEN is_buy = 1 THEN sol + fee_total ELSE sol END) / 100)';
  const [tr, trB, co, coB, bo, bb, boB, kols, coins] = await env.DB.batch([
    env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN ts >= ?1 THEN sol END), 0) vol, COUNT(CASE WHEN ts >= ?1 THEN 1 END) n,
      COUNT(DISTINCT CASE WHEN ts >= ?1 THEN wallet END) traders, COALESCE(SUM(CASE WHEN ts >= ?1 THEN ${shield} END), 0) shield,
      COALESCE(SUM(CASE WHEN ts < ?1 THEN sol END), 0) pvol, COUNT(CASE WHEN ts < ?1 THEN 1 END) pn, COUNT(DISTINCT CASE WHEN ts < ?1 THEN wallet END) ptraders
      FROM trades WHERE ts >= ?2`).bind(start, prev),
    env.DB.prepare('SELECT CAST(ts / CAST(?1 AS INTEGER) AS INTEGER) * CAST(?1 AS INTEGER) t, SUM(sol) vol, COUNT(*) n FROM trades WHERE ts >= ?2 GROUP BY t').bind(bucket, start),
    env.DB.prepare(`SELECT COUNT(CASE WHEN created_at >= ?1 THEN 1 END) n, COUNT(CASE WHEN created_at < ?1 THEN 1 END) pn,
      COUNT(CASE WHEN created_at >= ?1 AND shield_kind > 0 THEN 1 END) shield, COUNT(CASE WHEN created_at >= ?1 AND no_dev_buy = 1 THEN 1 END) nodev,
      AVG(CASE WHEN created_at >= ?1 THEN kols_blocked END) kols FROM coins WHERE created_at >= ?2`).bind(start, prev),
    env.DB.prepare('SELECT CAST(created_at / CAST(?1 AS INTEGER) AS INTEGER) * CAST(?1 AS INTEGER) t, COUNT(*) n FROM coins WHERE created_at >= ?2 GROUP BY t').bind(bucket, start),
    env.DB.prepare(`SELECT COUNT(CASE WHEN migrated_at >= ?1 THEN 1 END) n, COUNT(CASE WHEN migrated_at < ?1 THEN 1 END) pn,
      COALESCE(SUM(CASE WHEN migrated_at >= ?1 THEN buyback_sol END), 0) buyback FROM coins WHERE migrated_at >= ?2`).bind(start, prev),
    env.DB.prepare(`SELECT COUNT(CASE WHEN ts >= ?1 THEN 1 END) n, COALESCE(SUM(CASE WHEN ts >= ?1 THEN sol END), 0) sol,
      COUNT(DISTINCT CASE WHEN ts >= ?1 THEN wallet END) wallets, COUNT(CASE WHEN ts < ?1 THEN 1 END) pn FROM bounces WHERE ts >= ?2`).bind(start, prev),
    env.DB.prepare('SELECT CAST(ts / CAST(?1 AS INTEGER) AS INTEGER) * CAST(?1 AS INTEGER) t, COUNT(*) n, COALESCE(SUM(sol), 0) sol FROM bounces WHERE ts >= ?2 GROUP BY t').bind(bucket, start),
    env.DB.prepare(`SELECT wallet, COUNT(*) n, COALESCE(SUM(sol), 0) sol, COUNT(DISTINCT mint) coins, MAX(ts) last FROM bounces WHERE ts >= ?1
      GROUP BY wallet ORDER BY n DESC, sol DESC LIMIT 200`).bind(start),
    env.DB.prepare(`SELECT t.mint, SUM(t.sol) vol, COUNT(*) n, COUNT(DISTINCT t.wallet) traders, c.name, c.symbol, c.image, c.status, c.blocked,
      c.kols_blocked, c.progress FROM trades t JOIN coins c ON c.mint = t.mint WHERE t.ts >= ?1 GROUP BY t.mint ORDER BY vol DESC LIMIT 8`).bind(start),
  ]);

  const series = Array.from({ length: n }, (_, i) => ({ t: start + i * bucket, volume: 0, trades: 0, launches: 0, bounces: 0, bouncedSol: 0 }));
  const at = (t) => series[Math.floor((t - start) / bucket)];
  for (const r of trB.results) { const s = at(r.t); if (s) { s.volume += r.vol / 1e9; s.trades += r.n; } }
  for (const r of coB.results) { const s = at(r.t); if (s) s.launches += r.n; }
  for (const r of boB.results) { const s = at(r.t); if (s) { s.bounces += r.n; s.bouncedSol += r.sol; } }

  // a KOL can try from several wallets: add them up per person; wallets nobody knows are counted, not named
  const people = new Map();
  let strangers = 0;
  for (const r of kols.results) {
    const p = personOf(r.wallet);
    if (!p) { strangers++; continue; }
    const k = people.get(p.id) || { ...card(p), tries: 0, sol: 0, coins: 0, last: 0 };
    k.tries += r.n; k.sol += r.sol; k.coins = Math.max(k.coins, r.coins); k.last = Math.max(k.last, r.last);
    people.set(p.id, k);
  }

  const t = tr.results[0], c = co.results[0], b = bo.results[0], x = bb.results[0];
  return {
    range, bucket, start, now, series,
    totals: {
      volume: t.vol / 1e9, trades: t.n, traders: t.traders, launched: c.n, bonded: b.n, bounces: x.n, bouncedSol: x.sol,
      bouncedWallets: x.wallets, buybackSol: b.buyback, shieldSol: t.shield / 1e9, shieldCoins: c.shield, noDevBuyCoins: c.nodev, avgKols: c.kols || 0,
    },
    prev: range === 'all' ? null : { volume: t.pvol / 1e9, trades: t.pn, traders: t.ptraders, launched: c.pn, bonded: b.pn, bounces: x.pn },
    kols: [...people.values()].sort((a, z) => z.tries - a.tries || z.sol - a.sol).slice(0, 8),
    strangers,
    coins: coins.results.map((r) => ({
      mint: r.mint, name: r.name, symbol: r.symbol, image: r.image, status: r.status, blocked: r.blocked, kols: r.kols_blocked,
      progress: r.progress, volume: r.vol / 1e9, trades: r.n, traders: r.traders,
    })),
  };
}
