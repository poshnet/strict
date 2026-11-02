// The app's front page: what strict.fun is in two lines and three numbers, the board (sorted by market cap; each coin
// with the rules it picked as icons, its cap and how far it is to Raydium; a rule filter behind a button), and a rail
// with the program's buy checks running and the way to launch.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Engine } from '../components/Engine';
import { Explainer } from '../components/Explainer';
import { TokenCA } from '../components/TokenCA';
import { Avatar, Empty, I, RuleIcon } from '../components/ui';
import { api, type Coin, type RuleId } from '../lib/api';
import { useUsd } from '../lib/data';
import { ago, usd } from '../lib/format';
import { coinRules } from '../lib/rules';

const SORTS = [
  { id: 'mcap', label: 'Market cap' },
  { id: 'new', label: 'New' },
  { id: 'hot', label: 'Trading' },
  { id: 'bonding', label: 'Near bond' },
  { id: 'bonded', label: 'Bonded' },
  { id: 'strictest', label: 'Strictest' },
];
const RULE_IDS: RuleId[] = ['kols', 'snipers', 'dev', 'bundles', 'maxWallet', 'vamps'];
const RULE_NAME: Record<RuleId, string> = { kols: 'No KOLs', snipers: 'No snipers', dev: 'No dev buy', bundles: 'No bundles', maxWallet: 'Max wallet', vamps: 'No vamps' };

export default function Home() {
  const [params, setParams] = useSearchParams();
  const creator = params.get('creator') || undefined;
  const sort = params.get('sort') || 'mcap';
  return (
    <div className="dash">
      {!creator && <DashHead />}
      <div className="dash-grid">
        <Board creator={creator} sort={sort} setSort={(s) => setParams((p) => { p.set('sort', s); return p; })} />
        <aside className="dash-rail">
          <Engine compact />
          <LaunchCard />
        </aside>
      </div>
    </div>
  );
}

function DashHead() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 20_000 });
  const s = stats.data;
  const n = (v: number | undefined | null, d = 0) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
  // wide screens get the explainer in a window on the right, over the still light; phones get the light alone (the video
  // is on /rules for them)
  const [wide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1101px)').matches);
  return (
    <header className="dash-head">
      <div className="dh-bg" aria-hidden><img src="/assets/hero/edge.jpg" alt="" /></div>
      {wide && <Explainer className="dh-video" />}
      <div className="dh-words">
        <h1>Pick the rules.<br /><span className="h1-sub">The code enforces them.</span></h1>
        <p>Creators pick the rules at launch: no KOLs, no snipers, no dev buys, no bundles, a max wallet. They're locked on chain and checked by the program on every buy, until the coin bonds into Raydium with its LP burned.</p>
      </div>
      <dl className="kpis">
        <div><dt>Strict coins</dt><dd className="tnum">{n(s?.coins)}</dd></div>
        <div><dt>Buys stopped</dt><dd className="tnum red">{n(s?.stopped ?? s?.tries)}</dd></div>
        <div><dt>Rules a coin</dt><dd className="tnum">{s?.coins ? n(s.avgRules, 1) : '—'}</dd></div>
      </dl>
      <TokenCA where="home" />
    </header>
  );
}

function Board({ creator, sort, setSort }: { creator?: string; sort: string; setSort: (s: string) => void }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [must, setMust] = useState<RuleId[]>([]);
  const [filters, setFilters] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const coins = useQuery({ queryKey: ['coins', sort, dq, creator], queryFn: () => api.coins({ sort, q: dq, creator }), refetchInterval: 6_000 });
  const shown = useMemo(() => (coins.data || []).filter((c) => must.every((id) => { const r = coinRules(c); return id === 'maxWallet' ? r.maxWalletBps > 0 : !!r[id]; })), [coins.data, must]);
  const flip = (id: RuleId) => setMust((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  return (
    <section className="board-x" id="board" aria-label={creator ? 'Your coins' : 'Strict coins'}>
      <div className="bx-head">
        <h2 className="sr-only">{creator ? 'Your coins' : 'Live coins'}</h2>
        <div className="bx-tabs" role="tablist" aria-label="Sort">
          {SORTS.map((x) => <button key={x.id} role="tab" aria-selected={sort === x.id} className={sort === x.id ? 'on' : ''} onClick={() => setSort(x.id)}>{x.label}</button>)}
        </div>
        <button type="button" className={`bx-ftoggle${filters || must.length ? ' on' : ''}`} aria-expanded={filters} onClick={() => setFilters(!filters)}>
          Rules{must.length > 0 && <b>{must.length}</b>}<I.chev size={14} />
        </button>
        <label className="search bx-search"><I.search size={16} /><input placeholder="Search" aria-label="Search coins by name, ticker or mint" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {filters && <div className="bx-filters" role="group" aria-label="Only coins with">
        <span className="bx-f-l">Only coins with</span>
        {RULE_IDS.map((id) => (
          <button key={id} type="button" className={`fchip${must.includes(id) ? ' on' : ''}`} aria-pressed={must.includes(id)} onClick={() => flip(id)}>
            <RuleIcon id={id} box={0} size={13} />{RULE_NAME[id]}
          </button>
        ))}
        {must.length > 0 && <button type="button" className="fchip clear" onClick={() => setMust([])}>Clear</button>}
      </div>}
      <div className="rows" role="table" aria-label="Coins">
        <div className="row-h" role="row">
          <span role="columnheader">Coin</span><span role="columnheader">Rules</span><span role="columnheader" className="r">Market cap</span>
          <span role="columnheader">To Raydium</span>
        </div>
        {coins.isLoading ? Array.from({ length: 6 }, (_, i) => <div key={i} className="crow sk"><div className="skeleton" style={{ height: 44, width: '100%' }} /></div>)
          : shown.length ? shown.map((c) => <CoinRow key={c.mint} c={c} />)
          : (
            <Empty title={dq ? 'Nothing by that name' : must.length ? 'No coin has all of those rules yet' : sort === 'bonded' ? 'Nothing has bonded yet' : 'No coins yet'}
              action={!dq && <Link to="/launch" className="btn primary">Launch {must.length ? 'one with those rules' : 'the first one'}</Link>}>
              {dq ? 'Try a ticker, or paste a mint address.' : 'Launched coins show up here with the rules they picked.'}
            </Empty>
          )}
      </div>
    </section>
  );
}

function CoinRow({ c }: { c: Coin }) {
  const toUsd = useUsd();
  const r = coinRules(c);
  const bonded = c.status === 'migrated';
  const pct = bonded ? 100 : c.progress;
  const stopped = c.stopped ?? 0;
  const on = (id: RuleId) => (id === 'maxWallet' ? r.maxWalletBps > 0 : !!r[id]);
  const have = RULE_IDS.filter(on);
  return (
    <Link to={`/coin/${c.mint}`} className="crow" role="row">
      <span className="cr-coin" role="cell">
        <Avatar src={c.image} name={c.symbol} size={44} square seed={c.mint} />
        <span className="cr-names"><b>{c.name}</b><span>${c.symbol} · {ago(c.createdAt)}</span></span>
      </span>
      <span className="cr-rules" role="cell" aria-label={`${have.length} of 6 rules: ${have.map((id) => RULE_NAME[id]).join(', ') || 'none'}`}>
        {have.length ? <>
          <span className="cr-ics">{have.map((id) => <span key={id} className="ri on" title={`${RULE_NAME[id]}${id === 'maxWallet' ? ` ${r.maxWalletBps / 100}%` : ''}`}><RuleIcon id={id} box={0} size={14} /></span>)}</span>
          <span className="cr-n">{have.length} rule{have.length === 1 ? '' : 's'}</span>
        </> : <span className="cr-n faint">No rules</span>}
        {stopped > 0 && <span className="cr-stopped">{stopped} stopped</span>}
      </span>
      <span className="cr-cap tnum r" role="cell">{usd(toUsd(c.mcapSol))}</span>
      <span className="cr-bond" role="cell"><span className={`bar${bonded ? ' done' : ''}`}><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span><span className="tnum">{bonded ? 'Bonded' : `${pct.toFixed(0)}%`}</span></span>
    </Link>
  );
}

function LaunchCard() {
  return (
    <section className="rail-card launch-card">
      <b>Launch a coin with rules</b>
      <p>Pick your rules. They lock the moment it goes live.</p>
      <Link to="/launch" className="btn primary block l">Start a launch <I.arrow size={16} /></Link>
      <Link to="/rules#how" className="rail-how"><I.info size={14} />How is this possible?<span aria-hidden>→</span></Link>
    </section>
  );
}
