// The coins as the pages read them: the board, one coin and its rules, what each rule stopped, its list, trades,
// candles and holders, the KOL directory's counts, the live feed, the totals, and SOL's price.
import { KOLS, PEOPLE, card, listKols, personById_, personOf } from './kols.js';
import * as P from './program.js';
import { cached } from './cache.js';
import { connection, pk } from './sol.js';
import { vampKey, xKey } from './vamp.js';

const kolSet = new Set(KOLS.map((k) => k.wallet));

/** how many of the six rules a coin picked */
export const ruleCount = ({ blocked, shieldKind, noDevBuy, noBundles, maxWalletBps, noVamps }) =>
  [blocked > 0, shieldKind > 0, noDevBuy, noBundles, maxWalletBps > 0, noVamps].filter(Boolean).length;

/** The coin's row and its list (each wallet a row), written once its launch lands. */
export async function recordCoin(env, { mint, creator, meta, wallets, signature, createdAt = Date.now() }) {
  const shieldKind = meta.shield ? P.SHIELD[meta.shield.kind] : 0;
  const rules = { blocked: wallets.length, shieldKind, noDevBuy: !!meta.noDevBuy, noBundles: !!meta.noBundles, maxWalletBps: meta.maxWalletBps || 0, noVamps: !!meta.noVamps };
  const k = listKols(wallets);
  const p = P.DEFAULT_PARAMS;
  const price = (Number(p.virtualSol) / 1e9) / (Number(p.virtualToken) / 1e6);
  await env.DB.prepare(`INSERT INTO coins (mint, creator, name, symbol, description, image, twitter, telegram, website, blocked, kols_blocked, kol_reach, top_kols,
      status, signature, created_at, virtual_sol, virtual_token, real_sol, real_token, price_sol, mcap_sol, ath_mcap_sol, updated_at,
      shield_kind, shield_secs, no_dev_buy, no_bundles, max_wallet_bps, no_vamps, rule_count, ticker_key, name_key, x_key, img_hash, pass)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, '0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mint) DO UPDATE SET name = excluded.name, symbol = excluded.symbol, description = excluded.description, image = excluded.image,
      twitter = excluded.twitter, telegram = excluded.telegram, website = excluded.website, blocked = excluded.blocked,
      kols_blocked = excluded.kols_blocked, kol_reach = excluded.kol_reach, top_kols = excluded.top_kols, signature = COALESCE(coins.signature, excluded.signature)`)
    .bind(mint, creator, meta.name, meta.symbol, meta.description || null, meta.image || null, meta.twitter || null, meta.telegram || null, meta.website || null,
      wallets.length, wallets.filter((w) => kolSet.has(w)).length, k.reach, JSON.stringify(k.people.slice(0, 8).map((x) => x.id)), signature || null, createdAt,
      String(p.virtualSol), String(p.virtualToken), String(p.realToken), price, price * 1e9, price * 1e9, Date.now(),
      shieldKind, meta.shield?.secs || 0, rules.noDevBuy ? 1 : 0, rules.noBundles ? 1 : 0, rules.maxWalletBps, rules.noVamps ? 1 : 0, ruleCount(rules),
      vampKey(meta.symbol), vampKey(meta.name), meta.twitter ? xKey(meta.twitter) : null, meta.imgHash || null, meta.passAsset || null).run();
  // 50 rows a statement (D1 binds at most 100 values)
  const stmts = P.chunk(wallets, 50).map((ch) => env.DB.prepare(`INSERT OR IGNORE INTO coin_list (mint, wallet) VALUES ${ch.map(() => '(?, ?)').join(',')}`).bind(...ch.flatMap((w) => [mint, w])));
  for (const batch of P.chunk(stmts, 40)) await env.DB.batch(batch);
}

/** a coins row as the pages want it */
export function shape(r) {
  const top = (() => { try { return JSON.parse(r.top_kols || '[]'); } catch { return []; } })();
  return {
    mint: r.mint, creator: r.creator, name: r.name, symbol: r.symbol, description: r.description, image: r.image,
    twitter: r.twitter, telegram: r.telegram, website: r.website,
    blocked: r.blocked, kolsBlocked: r.kols_blocked, kolReach: r.kol_reach, listHash: r.list_hash,
    kols: top.map((id) => card(personById_(id))).filter(Boolean).map(({ id, name, handle, pfp, followers }) => ({ id, name, handle, pfp, followers })),
    status: r.status, createdAt: r.created_at, signature: r.signature,
    shield: r.shield_kind ? { kind: r.shield_kind === 1 ? 'linear' : 'exponential', secs: r.shield_secs } : null, noDevBuy: !!r.no_dev_buy,
    noBundles: !!r.no_bundles, maxWalletBps: r.max_wallet_bps || 0, noVamps: !!r.no_vamps,
    rules: { kols: r.blocked > 0, snipers: r.shield_kind > 0, dev: !!r.no_dev_buy, bundles: !!r.no_bundles, maxWalletBps: r.max_wallet_bps || 0, vamps: !!r.no_vamps },
    ruleCount: r.rule_count || 0, stopped: r.stopped || 0,
    pass: r.pass || null, // a dev pass holds the creator fees; null: locked to the creator
    priceSol: r.price_sol, mcapSol: r.mcap_sol, athMcapSol: r.ath_mcap_sol, progress: r.progress,
    volumeSol: r.volume_sol, trades: r.trades, lastTradeAt: r.last_trade_at,
    completedAt: r.completed_at, pool: r.pool, migratedAt: r.migrated_at,
    boughtBack: !!r.bought_back, buybackSol: r.buyback_sol, burnedTokens: r.burned_tokens, creatorPaidSol: r.creator_paid_sol,
    reserves: { virtualSol: r.virtual_sol, virtualToken: r.virtual_token, realSol: r.real_sol, realToken: r.real_token },
  };
}

export const SORTS = ['new', 'hot', 'mcap', 'bonding', 'bonded', 'strictest'];
const ORDER = {
  new: 'created_at DESC',
  hot: 'COALESCE(last_trade_at, created_at) DESC',
  mcap: 'mcap_sol DESC',
  bonding: 'progress DESC, last_trade_at DESC',
  bonded: 'migrated_at DESC',
  strictest: 'rule_count DESC, stopped DESC, COALESCE(last_trade_at, created_at) DESC',
};

export async function listCoins(env, { sort = 'new', q, limit = 48, offset = 0, creator } = {}) {
  const where = [];
  const args = [];
  if (sort === 'bonding') where.push("status = 'live'");
  if (sort === 'bonded') where.push("status = 'migrated'");
  if (creator) { where.push('creator = ?'); args.push(creator); }
  if (q) {
    const s = String(q).trim().replace(/^\$/, '');
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) { where.push('mint = ?'); args.push(s); }
    else { where.push('(name LIKE ? OR symbol LIKE ?)'); args.push(`%${s}%`, `${s.toUpperCase()}%`); }
  }
  const sql = `SELECT * FROM coins ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${ORDER[sort] || ORDER.new} LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...args, Math.min(100, Number(limit) || 48), Math.max(0, Number(offset) || 0)).all();
  return results.map(shape);
}

export async function coinByMint(env, mint) {
  const r = await env.DB.prepare('SELECT * FROM coins WHERE mint = ?').bind(mint).first();
  return r ? shape(r) : null;
}

/** A coin's list: the KOLs on it (each person once, most followed first) and the other wallets, with a search. */
export async function coinList(env, mint, { q } = {}) {
  const { results } = await env.DB.prepare('SELECT wallet FROM coin_list WHERE mint = ?').bind(mint).all();
  const wallets = results.map((r) => r.wallet);
  const k = listKols(wallets);
  let people = k.people.map(card);
  const others = wallets.filter((w) => !kolSet.has(w));
  if (q) {
    const s = String(q).toLowerCase();
    people = people.filter((p) => p.name.toLowerCase().includes(s) || (p.handle || '').toLowerCase().includes(s) || p.wallets.some((w) => w.toLowerCase().startsWith(s)));
  }
  return { count: wallets.length, kolWallets: k.wallets, reach: k.reach, people, others: others.slice(0, 2000), othersCount: others.length };
}

export async function trades(env, mint, limit = 60) {
  const { results } = await env.DB.prepare('SELECT sig, wallet, is_buy, sol, tokens, price_sol, mcap_sol, ts FROM trades WHERE mint = ? ORDER BY ts DESC, ix DESC LIMIT ?')
    .bind(mint, limit).all();
  return results.map((t) => {
    const p = personOf(t.wallet);
    return { sig: t.sig, wallet: t.wallet, side: t.is_buy ? 'buy' : 'sell', sol: t.sol / 1e9, tokens: t.tokens / 1e6, priceSol: t.price_sol, mcapSol: t.mcap_sol, ts: t.ts,
      kol: p ? { name: p.name, handle: p.handle, pfp: p.pfp } : null };
  });
}

const RULES = ['kols', 'dev', 'bundles', 'maxWallet'];

/**
 * What a coin's rules have done: buys stopped (by rule, and the latest of them), copies refused by no vamps, what buys
 * paid the sniper curve above the normal fee, and what the creator and the biggest wallet hold.
 */
export async function coinStops(env, c, mint) {
  const coin = await env.DB.prepare('SELECT creator, shield_kind, shield_secs, launched_at, created_at, pool FROM coins WHERE mint = ?').bind(mint).first();
  if (!coin) return null;
  const [byRule, recent, vamps, sniper] = await env.DB.batch([
    env.DB.prepare('SELECT rule, COUNT(*) n FROM bounces WHERE mint = ? GROUP BY rule').bind(mint),
    env.DB.prepare('SELECT wallet, rule, sol, sig, source, ts FROM bounces WHERE mint = ? ORDER BY ts DESC LIMIT 30').bind(mint),
    env.DB.prepare('SELECT COUNT(*) n FROM vamp_stops WHERE mint = ?').bind(mint),
    // buys while the sniper curve was up: what each paid above the normal 1%
    env.DB.prepare(`SELECT COUNT(*) n, COALESCE(SUM(MAX(0, fee_total - (sol + fee_total) / 100)), 0) extra FROM trades
      WHERE mint = ? AND is_buy = 1 AND wallet != ? AND ts <= ?`).bind(mint, coin.creator, ((coin.launched_at || Math.floor(coin.created_at / 1000)) + (coin.shield_secs || 0)) * 1000),
  ]);
  const counts = Object.fromEntries([...RULES, 'vamps'].map((r) => [r, 0]));
  for (const r of byRule.results) if (r.rule in counts) counts[r.rule] = r.n;
  counts.vamps = vamps.results[0].n;
  let creatorHoldsPct = null, topHolderPct = null;
  try {
    const h = await cached(`holders:${mint}`, 30, () => holders(env, c, mint));
    const people = h.filter((x) => x.label !== 'curve' && x.label !== 'pool');
    creatorHoldsPct = h.find((x) => x.owner === coin.creator)?.pct || 0;
    topHolderPct = people[0]?.pct || 0;
  } catch { /* the RPC is down: leave them blank */ }
  const s = sniper.results[0];
  return {
    counts, creatorHoldsPct, topHolderPct,
    sniperBuys: coin.shield_kind ? s.n : 0, sniperSol: coin.shield_kind ? s.extra / 1e9 : 0,
    events: recent.results.map((e) => {
      const p = personOf(e.wallet);
      return { ts: e.ts, wallet: e.wallet, rule: e.rule, sol: e.sol, sig: e.sig, source: e.source, kol: p ? { name: p.name, handle: p.handle, pfp: p.pfp } : null };
    }),
  };
}

/**
 * The sniper curve replay: the coin's curve (99% at launch, down to 1%) and every trade made while it was up, with the
 * fee each one paid. A buy's SOL in the event is what reached the curve, so its fee share is fee / (sol + fee).
 */
export async function sniperReplay(env, mint) {
  const coin = await env.DB.prepare('SELECT shield_kind, shield_secs, launched_at, created_at, creator FROM coins WHERE mint = ?').bind(mint).first();
  if (!coin || !coin.shield_kind) return { shield: null };
  const start = (coin.launched_at || Math.floor(coin.created_at / 1000)) * 1000;
  const { results } = await env.DB.prepare('SELECT sig, wallet, is_buy, sol, fee_total, ts FROM trades WHERE mint = ? AND ts <= ? ORDER BY ts ASC, ix ASC LIMIT 200')
    .bind(mint, start + (coin.shield_secs + 2) * 1000).all();
  let taxed = 0;
  const trades = results.map((t) => {
    const gross = t.is_buy ? t.sol + t.fee_total : t.sol;
    const feePct = gross > 0 ? (t.fee_total / gross) * 100 : 0;
    const shieldSol = Math.max(0, t.fee_total - gross * 0.01) / 1e9;
    taxed += shieldSol;
    const p = personOf(t.wallet);
    return { sig: t.sig, wallet: t.wallet, side: t.is_buy ? 'buy' : 'sell', at: Math.max(0, (t.ts - start) / 1000), sol: gross / 1e9, feePct, shieldSol,
      creator: t.wallet === coin.creator, kol: p ? { name: p.name, pfp: p.pfp } : null };
  });
  return { shield: { kind: coin.shield_kind === 1 ? 'linear' : 'exponential', secs: coin.shield_secs }, launchedAt: start, trades, taxedSol: taxed };
}

const TF = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
/** market-cap candles (SOL) from the coin's trades, starting at its launch price */
export async function candles(env, mint, tf = '5m') {
  const step = TF[tf] || 300;
  const coin = await env.DB.prepare('SELECT created_at FROM coins WHERE mint = ?').bind(mint).first();
  if (!coin) return [];
  const { results } = await env.DB.prepare('SELECT mcap_sol, sol, ts FROM trades WHERE mint = ? ORDER BY ts ASC, ix ASC LIMIT 20000').bind(mint).all();
  const start = (Number(P.DEFAULT_PARAMS.virtualSol) / 1e9) / (Number(P.DEFAULT_PARAMS.virtualToken) / 1e6) * 1e9;
  const out = [];
  let last = start;
  for (const t of results) {
    const time = Math.floor(t.ts / 1000 / step) * step;
    let c = out[out.length - 1];
    if (!c || c.time !== time) { c = { time, open: last, high: last, low: last, close: last, volume: 0 }; out.push(c); }
    c.high = Math.max(c.high, t.mcap_sol);
    c.low = Math.min(c.low, t.mcap_sol);
    c.close = t.mcap_sol;
    c.volume += t.sol / 1e9;
    last = t.mcap_sol;
  }
  if (!out.length) out.push({ time: Math.floor(coin.created_at / 1000 / step) * step, open: start, high: start, low: start, close: start, volume: 0 });
  return out;
}

/** the top holders, the curve's vault and the pool marked as such */
export async function holders(env, c, mint) {
  const conn = connection(c.rpcUrl);
  const { value } = await conn.getTokenLargestAccounts(pk(mint), 'confirmed');
  const infos = await conn.getMultipleParsedAccounts(value.slice(0, 20).map((v) => v.address), { commitment: 'confirmed' });
  const vault = P.vaultPda(mint).toBase58();
  const coin = await env.DB.prepare('SELECT pool, creator FROM coins WHERE mint = ?').bind(mint).first();
  const poolAuth = P.cpmmAuthority().toBase58();
  const supply = Number(P.DEFAULT_PARAMS.tokenSupply) / 1e6;
  return value.slice(0, 20).map((v, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner || null;
    const amount = Number(v.uiAmount || 0);
    const p = owner ? personOf(owner) : null;
    return {
      owner, amount, pct: (amount / supply) * 100,
      label: owner === vault ? 'curve' : owner === poolAuth && coin?.pool ? 'pool' : owner === coin?.creator ? 'creator' : null,
      kol: p ? { name: p.name, handle: p.handle, pfp: p.pfp } : null,
    };
  }).filter((h) => h.amount > 0);
}

/** For the directory: how many coins list each KOL wallet, and how many of those haven't bonded yet. */
export async function kolCounts(env) {
  return cached('kolcounts', 60, async () => {
    const { results } = await env.DB.prepare(`SELECT l.wallet, COUNT(*) n, SUM(CASE WHEN c.status = 'live' THEN 1 ELSE 0 END) live
      FROM coin_list l JOIN coins c ON c.mint = l.mint GROUP BY l.wallet`).all();
    const out = {};
    for (const r of results) if (kolSet.has(r.wallet)) out[r.wallet] = { n: r.n, live: r.live };
    const { results: b } = await env.DB.prepare('SELECT wallet, COUNT(*) n FROM bounces GROUP BY wallet').all();
    for (const r of b) if (kolSet.has(r.wallet)) (out[r.wallet] ||= { n: 0, live: 0 }).tries = r.n;
    return out;
  });
}

/** the directory: every KOL (by handle) with their bounce counts */
export async function directory(env) {
  const counts = await kolCounts(env);
  return PEOPLE.map((p) => {
    const sum = (k) => p.wallets.reduce((s, w) => Math.max(s, counts[w]?.[k] || 0), 0);
    const tries = p.wallets.reduce((s, w) => s + (counts[w]?.tries || 0), 0);
    return { ...card(p), bouncedBy: sum('n'), bouncingNow: sum('live'), tries };
  });
}

export async function kolProfile(env, id) {
  const p = personById_(id);
  if (!p) return null;
  const qs = p.wallets.map(() => '?').join(',');
  const [{ results: coins }, { results: tries }] = await Promise.all([
    env.DB.prepare(`SELECT c.* FROM coin_list l JOIN coins c ON c.mint = l.mint WHERE l.wallet IN (${qs}) GROUP BY c.mint ORDER BY c.created_at DESC LIMIT 60`).bind(...p.wallets).all(),
    env.DB.prepare(`SELECT b.*, c.name, c.symbol, c.image FROM bounces b LEFT JOIN coins c ON c.mint = b.mint WHERE b.wallet IN (${qs}) ORDER BY b.ts DESC LIMIT 30`).bind(...p.wallets).all(),
  ]);
  return { kol: card(p), coins: coins.map(shape), tries: tries.map((t) => ({ mint: t.mint, name: t.name, symbol: t.symbol, image: t.image, rule: t.rule, source: t.source, sig: t.sig, sol: t.sol, ts: t.ts, wallet: t.wallet })) };
}

/** Which coins bounce this wallet right now (and which did, before they bonded). */
export async function walletCheck(env, wallet) {
  const { results } = await env.DB.prepare('SELECT c.* FROM coin_list l JOIN coins c ON c.mint = l.mint WHERE l.wallet = ? ORDER BY c.created_at DESC LIMIT 100').bind(wallet).all();
  const p = personOf(wallet);
  return { wallet, kol: p ? card(p) : null, coins: results.map(shape) };
}

export async function stats(env) {
  const [a, b, d] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) coins, SUM(CASE WHEN status = 'migrated' THEN 1 ELSE 0 END) bonded, COALESCE(SUM(kols_blocked), 0) kol_bounces,
      COALESCE(SUM(blocked), 0) bounces, COALESCE(SUM(volume_sol), 0) volume, COALESCE(SUM(burned_tokens), 0) burned, COALESCE(AVG(rule_count), 0) avg_rules FROM coins`),
    env.DB.prepare('SELECT COUNT(*) n FROM bounces'),
    env.DB.prepare('SELECT COUNT(DISTINCT wallet) n FROM coin_list'),
  ]);
  const s = a.results[0];
  return { coins: s.coins, bonded: s.bonded || 0, kolBounces: s.kol_bounces, listed: s.bounces, wallets: d.results[0].n, volumeSol: s.volume, tries: b.results[0].n,
    stopped: b.results[0].n, avgRules: s.avg_rules, kols: PEOPLE.length };
}

/** the live log: launches, buys the rules stopped, bonds and big buys, newest first */
export async function feed(env) {
  const [launches, tries, bonds, buys] = await env.DB.batch([
    env.DB.prepare('SELECT mint, name, symbol, image, blocked, kols_blocked, top_kols, rule_count, created_at ts FROM coins ORDER BY created_at DESC LIMIT 12'),
    env.DB.prepare('SELECT b.mint, b.wallet, b.rule, b.source, b.sol, b.ts, c.name, c.symbol, c.image FROM bounces b LEFT JOIN coins c ON c.mint = b.mint ORDER BY b.ts DESC LIMIT 20'),
    env.DB.prepare("SELECT mint, name, symbol, image, migrated_at ts FROM coins WHERE status = 'migrated' ORDER BY migrated_at DESC LIMIT 8"),
    env.DB.prepare('SELECT t.mint, t.wallet, t.sol, t.ts, c.name, c.symbol, c.image FROM trades t JOIN coins c ON c.mint = t.mint WHERE t.is_buy = 1 AND t.sol >= 1000000000 ORDER BY t.ts DESC LIMIT 12'),
  ]);
  const who = (w) => { const p = personOf(w); return p ? { name: p.name, handle: p.handle, pfp: p.pfp } : null; };
  const coin = (r) => ({ mint: r.mint, name: r.name, symbol: r.symbol, image: r.image });
  const out = [
    ...launches.results.map((r) => ({ kind: 'launch', ts: r.ts, coin: coin(r), blocked: r.blocked, kols: r.kols_blocked, ruleCount: r.rule_count })),
    ...tries.results.map((r) => ({ kind: 'bounce', ts: r.ts, coin: coin(r), wallet: r.wallet, kol: who(r.wallet), sol: r.sol, source: r.source, rule: r.rule })),
    ...bonds.results.map((r) => ({ kind: 'bond', ts: r.ts, coin: coin(r) })),
    ...buys.results.map((r) => ({ kind: 'buy', ts: r.ts, coin: coin(r), wallet: r.wallet, kol: who(r.wallet), sol: r.sol / 1e9 })),
  ];
  return out.sort((x, y) => y.ts - x.ts).slice(0, 40);
}

/** SOL in USD: Jupiter's price, else Coinbase's */
export async function solUsd() {
  return cached('solusd', 60, async () => {
    try {
      const r = await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      const v = j?.So11111111111111111111111111111111111111112?.usdPrice;
      if (v > 0) return v;
    } catch { /* next */ }
    const r = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: AbortSignal.timeout(5000) });
    return Number((await r.json())?.data?.amount) || null;
  });
}
