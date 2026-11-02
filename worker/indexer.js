// The index: every transaction on the strict program, read from chain (the minute cron walks the program's
// signatures; a trade made here is read the moment it lands). Events become rows: coins, trades, bonds, buybacks,
// payouts. A failed buy whose error is one of the rules' (Bounced, DevBuy, Bundled, OverCap) becomes a stop: proof the
// rule turned a buyer away, kept against the coin and the rule.
import * as P from './program.js';
import { recordCoin, ruleCount } from './market.js';
import { connection, getTx, getTxs, txKeys } from './sol.js';
import { b58decode, errMsg, getState, setState } from './util.js';

const BUY = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const INITIAL_REAL = Number(P.DEFAULT_PARAMS.realToken);
const price = (vs, vt) => (Number(vs) / 1e9) / (Number(vt) / 1e6);

/** Read one signature now (after a launch or trade made here). */
export async function indexSignature(env, c, sig) {
  for (let i = 0; i < 6; i++) {
    const tx = await getTx(c.rpcUrl, sig);
    if (tx) return applyTx(env, c, sig, tx);
    await new Promise((r) => setTimeout(r, 700));
  }
  return { found: false };
}

/** The cron: every program signature since the last one read, oldest first. */
export async function runIndex(env, c, { max = 300 } = {}) {
  const conn = connection(c.rpcUrl);
  const last = await getState(env, 'idx:last');
  const sigs = [];
  let before;
  while (sigs.length < max) {
    const page = await conn.getSignaturesForAddress(P.PROGRAM_ID, { until: last || undefined, before, limit: 100 }, 'confirmed');
    sigs.push(...page);
    if (page.length < 100) break;
    before = page[page.length - 1].signature;
  }
  if (!sigs.length) return { read: 0 };
  sigs.reverse(); // oldest first
  let read = 0;
  for (let i = 0; i < sigs.length; i += 20) {
    const group = sigs.slice(i, i + 20);
    const txs = await getTxs(c.rpcUrl, group.map((s) => s.signature));
    for (let j = 0; j < group.length; j++) {
      if (txs[j]) {
        try { await applyTx(env, c, group[j].signature, txs[j]); } catch (e) { console.log('index', group[j].signature, errMsg(e)); }
      }
      read++;
    }
    await setState(env, 'idx:last', group[group.length - 1].signature);
  }
  return { read };
}

async function applyTx(env, c, sig, tx) {
  const ts = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  if (tx.meta?.err) {
    const rule = P.RULE_ERRORS[P.programError(tx.meta.err)];
    if (rule) await stopped(env, sig, tx, ts, rule);
    return { failed: true };
  }
  const events = P.decodeEvents(tx.meta?.logMessages);
  for (let i = 0; i < events.length; i++) await applyEvent(env, c, sig, i, events[i]);
  return { events: events.length };
}

async function stopped(env, sig, tx, ts, rule) {
  const keys = txKeys(tx);
  const program = P.PROGRAM_ID.toBase58();
  for (const ix of tx.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== program) continue;
    const d = Buffer.from(b58decode(ix.data || ''));
    if (d.length < 16 || !d.subarray(0, 8).equals(BUY)) continue;
    const mint = keys[ix.accounts[2]];
    const wallet = keys[ix.accounts[6]];
    const sol = Number(d.readBigUInt64LE(8)) / 1e9;
    if (mint && wallet) {
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO bounces (mint, wallet, rule, source, sig, sol, ts) VALUES (?, ?, ?, 'chain', ?, ?, ?)").bind(mint, wallet, rule, sig, sol, ts).run();
      if (ins.meta.changes) await env.DB.prepare('UPDATE coins SET stopped = stopped + 1 WHERE mint = ?').bind(mint).run();
    }
    return;
  }
}

async function applyEvent(env, c, sig, i, e) {
  const now = Date.now();
  if (e.name === 'CreateEvent') {
    const have = await env.DB.prepare('SELECT 1 FROM coins WHERE mint = ?').bind(e.mint).first();
    if (!have) await adopt(env, c, e, sig);
    // the chain's word on the rules wins over what the launch asked for
    const row = await env.DB.prepare('SELECT no_vamps FROM coins WHERE mint = ?').bind(e.mint).first();
    const count = ruleCount({ blocked: e.blocked, shieldKind: e.shieldKind, noDevBuy: e.noDevBuy, noBundles: e.noBundles, maxWalletBps: e.maxWalletBps, noVamps: !!row?.no_vamps });
    await env.DB.prepare(`UPDATE coins SET list_hash = ?, blocked = ?, shield_kind = ?, shield_secs = ?, no_dev_buy = ?, no_bundles = ?, max_wallet_bps = ?,
        created_slot = ?, rule_count = ?, launched_at = ?, pass = ? WHERE mint = ?`)
      .bind(e.blocked ? e.listHash : null, e.blocked, e.shieldKind || 0, e.shieldSecs || 0, e.noDevBuy ? 1 : 0, e.noBundles ? 1 : 0, e.maxWalletBps || 0,
        e.createdSlot, count, e.timestamp, P.passOf(e), e.mint).run();
    return;
  }
  if (e.name === 'TradeEvent') {
    const p = price(e.virtualSol, e.virtualToken);
    const mcap = p * 1e9;
    const at = e.timestamp * 1000;
    const feeTotal = Number(e.fee) + Number(e.creatorFee) + Number(e.shieldFee || 0n);
    const ins = await env.DB.prepare(`INSERT OR IGNORE INTO trades (sig, ix, mint, wallet, is_buy, sol, tokens, price_sol, mcap_sol, ts, fee_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(sig, i, e.mint, e.user, e.isBuy ? 1 : 0, Number(e.sol), Number(e.tokens), p, mcap, at, feeTotal).run();
    if (!ins.meta.changes) return;
    const progress = Math.min(100, ((INITIAL_REAL - Number(e.realToken)) / INITIAL_REAL) * 100);
    await env.DB.batch([
      env.DB.prepare('UPDATE coins SET volume_sol = volume_sol + ?, trades = trades + 1, ath_mcap_sol = MAX(COALESCE(ath_mcap_sol, 0), ?), updated_at = ? WHERE mint = ?')
        .bind(Number(e.sol) / 1e9, mcap, now, e.mint),
      env.DB.prepare(`UPDATE coins SET virtual_sol = ?, virtual_token = ?, real_sol = ?, real_token = ?, price_sol = ?, mcap_sol = ?, progress = ?, last_trade_at = ?
        WHERE mint = ? AND (last_trade_at IS NULL OR last_trade_at <= ?)`)
        .bind(String(e.virtualSol), String(e.virtualToken), String(e.realSol), String(e.realToken), p, mcap, progress, at, e.mint, at),
    ]);
    return;
  }
  if (e.name === 'CompleteEvent') {
    await env.DB.prepare("UPDATE coins SET status = CASE WHEN status = 'live' THEN 'complete' ELSE status END, completed_at = ?, progress = 100 WHERE mint = ?").bind(e.timestamp * 1000, e.mint).run();
    return;
  }
  if (e.name === 'MigrateEvent') {
    await env.DB.prepare("UPDATE coins SET status = 'migrated', pool = ?, migrated_at = ?, migrate_error = NULL WHERE mint = ?").bind(e.pool, e.timestamp * 1000, e.mint).run();
    return;
  }
  if (e.name === 'BuybackEvent') {
    await env.DB.prepare('UPDATE coins SET bought_back = 1, buyback_sol = ?, burned_tokens = ? WHERE mint = ?').bind(Number(e.sol) / 1e9, Number(e.burned) / 1e6, e.mint).run();
    return;
  }
  if (e.name === 'ClaimEvent') {
    // who was paid: the creator, or whoever held the coin's dev pass then
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO claims (sig, mint, wallet, sol, ts) VALUES (?, ?, ?, ?, ?)').bind(sig, e.mint, e.creator, Number(e.amount) / 1e9, e.timestamp * 1000).run();
    if (ins.meta.changes) await env.DB.prepare('UPDATE coins SET creator_paid_sol = creator_paid_sol + ? WHERE mint = ?').bind(Number(e.amount) / 1e9, e.mint).run();
  }
}

// ---------------------------------------------------------------- a coin made straight on the program

/** Metaplex metadata: name, symbol, uri (fixed-width strings, NUL padded). */
function decodeMetadata(data) {
  const b = Buffer.from(data);
  let o = 1 + 32 + 32;
  const str = () => { const n = b.readUInt32LE(o); o += 4; const s = b.subarray(o, o + n).toString('utf8').replace(/\0/g, '').trim(); o += n; return s; };
  return { name: str(), symbol: str(), uri: str() };
}

async function adopt(env, c, e, sig) {
  const conn = connection(c.rpcUrl);
  const [metaInfo, listInfo] = await conn.getMultipleAccountsInfo([P.metadataPda(e.mint), P.listPda(e.mint)]);
  const md = metaInfo ? decodeMetadata(metaInfo.data) : { name: e.mint.slice(0, 6), symbol: '???', uri: '' };
  let off = {};
  if (/^https:\/\//.test(md.uri)) {
    off = await fetch(md.uri, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  const wallets = listInfo ? P.decodeList(listInfo.data).wallets : [];
  const http = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u.slice(0, 300) : null);
  await recordCoin(env, {
    mint: e.mint, creator: e.creator, signature: sig, createdAt: e.timestamp * 1000, wallets,
    meta: {
      name: md.name.slice(0, 32) || 'Unnamed', symbol: md.symbol.slice(0, 10).toUpperCase() || '???', description: String(off.description || '').slice(0, 600),
      image: http(off.image), twitter: http(off.twitter), telegram: http(off.telegram), website: http(off.website),
    },
  });
}

/** A coin's live curve, straight from chain, folded into its row (the coin page reads this every few seconds). */
export async function liveCurve(env, c, mint) {
  const info = await connection(c.rpcUrl).getAccountInfo(P.curvePda(mint), 'confirmed');
  if (!info) return null;
  const cv = P.decodeCurve(info.data);
  return {
    virtualSol: String(cv.virtualSol), virtualToken: String(cv.virtualToken), realSol: String(cv.realSol), realToken: String(cv.realToken),
    priceSol: price(cv.virtualSol, cv.virtualToken), progress: P.progress(cv), complete: cv.complete, migrated: cv.migrated, boughtBack: cv.boughtBack,
    pool: cv.migrated ? cv.pool : null, creatorFees: Number(cv.creatorFees) / 1e9, blocked: cv.blocked, listHash: cv.listHash,
    feeBps: cv.feeBps, creatorFeeBps: cv.creatorFeeBps, createdAt: cv.createdAt, creator: cv.creator,
    shieldKind: cv.shieldKind, shieldSecs: cv.shieldSecs, noDevBuy: cv.noDevBuy, feeNowBps: Number(P.feeNow(cv)),
    noBundles: cv.noBundles, maxWalletBps: cv.maxWalletBps, createdSlot: cv.createdSlot,
    accounts: { curve: P.curvePda(mint).toBase58(), list: P.listPda(mint).toBase58(), vault: P.vaultPda(mint).toBase58() },
  };
}
