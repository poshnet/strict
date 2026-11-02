// Analytics: what happened on strict.fun in a range. The range scopes everything on the page: the headline volume, the
// tiles (each against the period before), the columns per hour or day, whose buys were stopped most and what traded most.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ColTable, Columns, type Col } from '../components/Columns';
import { Avatar, Fol, Spinner, Verified } from '../components/ui';
import { api, type Analytics as A, type Range } from '../lib/api';
import { useUsd } from '../lib/data';
import { ago, amount, usd } from '../lib/format';

const RANGES: { k: Range; label: string; prior: string }[] = [
  { k: '24h', label: '24h', prior: 'the 24h before' },
  { k: '7d', label: '7 days', prior: 'the week before' },
  { k: '30d', label: '30 days', prior: 'the 30 days before' },
  { k: 'all', label: 'All time', prior: '' },
];
const sol = (n: number) => `${amount(n, n >= 100 ? 1 : 2)} SOL`;
const int = (n: number) => Math.round(n).toLocaleString('en-US');

function Delta({ now, then, prior }: { now: number; then: number | undefined; prior: string }) {
  if (then == null) return null;
  if (!then) return now ? <span className="an-delta">New since {prior}</span> : <span className="an-delta">Same as {prior}</span>;
  const d = ((now - then) / then) * 100;
  return <span className="an-delta">{d > 0 ? '↑' : d < 0 ? '↓' : ''} {Math.abs(d).toFixed(Math.abs(d) >= 10 ? 0 : 1)}% vs {prior}</span>;
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="an-tile">
      <span className="an-label">{label}</span>
      <b className="an-value">{value}</b>
      {sub}
    </div>
  );
}

function Chart({ title, total, data, bucket, fmt, unit, tone, whole, empty }: { title: string; total: string; data: Col[]; bucket: number; fmt: (v: number) => string; unit: string; tone?: 'ink' | 'red'; whole?: boolean; empty?: string }) {
  const [table, setTable] = useState(false);
  return (
    <div className="card an-chart">
      <div className="an-chart-head">
        <div><h3>{title}</h3><span className="muted">{total}</span></div>
        <div className="seg"><button className={table ? '' : 'on'} onClick={() => setTable(false)}>Chart</button><button className={table ? 'on' : ''} onClick={() => setTable(true)}>Table</button></div>
      </div>
      {table ? <ColTable data={data} bucket={bucket} fmt={fmt} unit={unit} /> : <Columns data={data} bucket={bucket} fmt={fmt} unit={unit} tone={tone} whole={whole} empty={empty} />}
    </div>
  );
}

function Meter({ label, n, of }: { label: string; n: number; of: number }) {
  const p = of ? (n / of) * 100 : 0;
  return (
    <div className="an-meter">
      <div><span>{label}</span><b className="mono">{of ? `${Math.round(p)}%` : '—'}</b></div>
      <i><em style={{ width: `${p}%` }} /></i>
      <span className="dim">{of ? `${int(n)} of ${int(of)} coins` : 'No launches in this range'}</span>
    </div>
  );
}

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const range = (RANGES.find((r) => r.k === params.get('range'))?.k || '7d') as Range;
  const r = RANGES.find((x) => x.k === range)!;
  const { data, isFetching } = useQuery({ queryKey: ['analytics', range], queryFn: () => api.analytics(range), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const toUsd = useUsd();
  const a = data as A | undefined;
  const t = a?.totals, p = a?.prev;
  const col = (k: 'volume' | 'launches' | 'bounces') => (a?.series || []).map((s) => ({ t: s.t, v: s[k] }));

  return (
    <div className="wrap page">
      <header className="page-head">
        <div>
          <h1>Analytics</h1>
          <p>What traded on strict.fun, what bonded, and which buys the rules stopped. Every number comes from the program's own events, read off chain.</p>
        </div>
      </header>
      <div className="an-filters">
        <div className="seg">{RANGES.map((x) => <button key={x.k} className={x.k === range ? 'on' : ''} onClick={() => setParams(x.k === '7d' ? {} : { range: x.k }, { replace: true })}>{x.label}</button>)}</div>
        <span className="dim an-live"><i />Refreshes every 30s</span>
      </div>

      {!a ? <div className="page-load"><Spinner size={20} /></div> : (
        <div className={`an${isFetching && data?.range !== range ? ' stale' : ''}`}>
          <section className="an-top">
            <div className="card an-hero">
              <span className="an-label">Volume</span>
              <b className="an-big">{sol(t!.volume)}</b>
              <span className="muted">{usd(toUsd(t!.volume))} · {int(t!.trades)} trade{t!.trades === 1 ? '' : 's'} by {int(t!.traders)} trader{t!.traders === 1 ? '' : 's'}</span>
              {p && <Delta now={t!.volume} then={p.volume} prior={r.prior} />}
            </div>
            <div className="card an-tiles">
              <Tile label="Coins launched" value={int(t!.launched)} sub={p && <Delta now={t!.launched} then={p.launched} prior={r.prior} />} />
              <Tile label="Bonded" value={int(t!.bonded)} sub={p ? <Delta now={t!.bonded} then={p.bonded} prior={r.prior} /> : <span className="an-delta">moved to Raydium</span>} />
              <Tile label="Buys stopped" value={<span className={t!.bounces ? 'red' : ''}>{int(t!.bounces)}</span>} sub={<span className="an-delta">from {int(t!.bouncedWallets)} wallet{t!.bouncedWallets === 1 ? '' : 's'}</span>} />
              <Tile label="SOL kept out" value={sol(t!.bouncedSol)} sub={<span className="an-delta">what stopped buys tried to spend</span>} />
              <Tile label="Bought back" value={sol(t!.buybackSol)} sub={<span className="an-delta">and burned, at bonding</span>} />
              <Tile label="Sniper curve took" value={sol(t!.shieldSol)} sub={<span className="an-delta">above the 1% fee, to buybacks</span>} />
            </div>
          </section>

          <Chart title="Volume" total={`${sol(t!.volume)} ${range === 'all' ? 'all time' : `in ${r.label}`}`} data={col('volume')} bucket={a.bucket} fmt={sol} unit="SOL" empty="No trades in this range." />
          <div className="an-2">
            <Chart title="Launches" total={`${int(t!.launched)} coin${t!.launched === 1 ? '' : 's'}`} data={col('launches')} bucket={a.bucket} fmt={(v) => `${int(v)} coin${v === 1 ? '' : 's'}`} unit="Coins" whole empty="No launches in this range." />
            <Chart title="Buys stopped" total={`${int(t!.bounces)} stopped`} data={col('bounces')} bucket={a.bucket} fmt={(v) => `${int(v)} stopped`} unit="Stopped" tone="red" whole empty="No buys stopped." />
          </div>

          <div className="an-2">
            <div className="card table-card">
              <div className="an-table-head"><h3>Stopped most</h3><span className="muted">KOLs whose wallets tried to buy anyway</span></div>
              {a.kols.length ? (
                <table className="table">
                  <thead><tr><th>KOL</th><th className="r">Tries</th><th className="r">Tried to spend</th><th className="r hide-s">Last</th></tr></thead>
                  <tbody>
                    {a.kols.map((k) => (
                      <tr key={k.id}>
                        <td><Link to={`/kol/${k.id}`} className="who-cell"><Avatar src={k.pfp} name={k.name} size={28} /><span><b>{k.name}{k.verified && <Verified />}</b><span className="dim">{k.followers ? <Fol n={k.followers} /> : k.handle ? `@${k.handle}` : ''}</span></span></Link></td>
                        <td className="r mono red">{int(k.tries)}</td>
                        <td className="r mono">{sol(k.sol)}</td>
                        <td className="r dim hide-s">{ago(k.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="an-none">No KOL has tried to buy past a list in this range.</p>}
              {a.strangers > 0 && <p className="an-foot dim">Plus {int(a.strangers)} wallet{a.strangers === 1 ? '' : 's'} outside the KOL directory, kept out by a creator's own list.</p>}
            </div>
            <div className="card table-card">
              <div className="an-table-head"><h3>Traded most</h3><span className="muted">By volume in this range</span></div>
              {a.coins.length ? (
                <table className="table">
                  <thead><tr><th>Coin</th><th className="r">Volume</th><th className="r hide-s">Traders</th><th className="r">On list</th></tr></thead>
                  <tbody>
                    {a.coins.map((c) => (
                      <tr key={c.mint}>
                        <td><Link to={`/coin/${c.mint}`} className="who-cell"><Avatar src={c.image} name={c.symbol} size={28} square /><span><b>{c.name}</b><span className="dim">${c.symbol} · {c.status === 'migrated' ? 'bonded' : `${Math.floor(c.progress)}% to bond`}</span></span></Link></td>
                        <td className="r mono">{sol(c.volume)}</td>
                        <td className="r mono hide-s">{int(c.traders)}</td>
                        <td className={`r mono ${c.blocked ? 'red' : 'dim'}`}>{c.blocked ? int(c.blocked) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="an-none">No trades in this range.</p>}
            </div>
          </div>

          <div className="card an-options">
            <div className="an-table-head"><h3>How creators launch</h3><span className="muted">Coins launched in this range</span></div>
            <div className="an-meters">
              <Meter label="Sniper curve on" n={t!.shieldCoins} of={t!.launched} />
              <Meter label="No dev buy" n={t!.noDevBuyCoins} of={t!.launched} />
              <div className="an-meter">
                <div><span>KOLs banned per coin</span><b className="mono">{t!.launched ? Math.round(t!.avgKols) : '—'}</b></div>
                <span className="dim">on average, from the ban list</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
