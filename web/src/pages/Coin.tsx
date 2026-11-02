// One coin, laid out like a trading page: the coin at a glance (its six rules as icons), the chart with its way to
// Raydium, the trade panel, its rules with what each has done and the check against the chain, then tabs: trades, the
// buys its rules stopped, holders, its KOL list, the code behind each rule, and its accounts.
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CodeBlock, CodeLine, type Block } from '../components/RuleCode';
import { CreatorFeesPanel } from '../components/DevPass';
import { ruleLine } from '../components/Engine';
import { useProgram } from '../components/Trust';
import source from '../lib/source.json';
import { SniperReplay } from '../components/SniperCurve';
import { TradePanel } from '../components/TradePanel';
import { Avatar, Copy, Empty, Fol, I, Progress, RuleIcon, Spinner, Verified } from '../components/ui';
import { api, type Coin, type Live, type RuleId, type Stops } from '../lib/api';
import { followers, useConfig, useUsd } from '../lib/data';
import { ago, amount, bpsPct, short, usd } from '../lib/format';
import { coinRules, isOn, rulesFor } from '../lib/rules';
import { verifyList, type Verdict } from '../lib/verify';
import { useWallet } from '../lib/wallet';

const Chart = lazy(() => import('../components/Chart'));
const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const RULE_NAME: Record<string, string> = { kols: 'No KOLs', dev: 'No dev buy', bundles: 'No bundles', maxWallet: 'Max wallet', snipers: 'No snipers', vamps: 'No vamps' };

export default function CoinPage() {
  const { mint = '' } = useParams();
  const loc = useLocation() as { state?: { launched?: boolean } };
  const w = useWallet();
  const { data: cfg } = useConfig();
  const q = useQuery({ queryKey: ['coin', mint], queryFn: () => api.coin(mint), refetchInterval: 4_000 });
  const stops = useQuery({ queryKey: ['stops', mint], queryFn: () => api.stops(mint), refetchInterval: 8_000, enabled: !!q.data, retry: false });
  const list = useQuery({ queryKey: ['list', mint], queryFn: () => api.list(mint), enabled: !!q.data?.coin.blocked });
  const listed = useMemo(() => !!w.address && !!list.data && (list.data.others.includes(w.address) || list.data.people.some((p) => p.wallets.includes(w.address!))), [w.address, list.data]);

  if (q.isLoading) return <div className="wrap page"><div className="cp"><div className="skeleton cp-head" style={{ height: 120 }} /><div className="skeleton cp-chart" style={{ height: 520 }} /><div className="skeleton cp-side" style={{ height: 420 }} /></div></div>;
  if (!q.data) return <div className="wrap"><Empty title="No coin here" action={<Link to="/" className="btn ghost">Back to the board</Link>}>That mint isn't on strict.fun.</Empty></div>;
  const { coin, live } = q.data;
  const n = coin.ruleCount ?? rulesFor(cfg).filter((r) => isOn(coinRules(coin), r.id)).length;
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`$${coin.symbol} just launched on @${cfg?.xHandle || 'strictfun'} with ${n} strict rule${n === 1 ? '' : 's'}, locked on chain.`)}&url=${encodeURIComponent(location.href)}`;

  return (
    <div className="wrap page cp-page">
      {loc.state?.launched && (
        <div className="notice green launched">
          <span>You're live. Your rules are locked and checked on every buy.</span>
          <a className="btn primary s" href={share} target="_blank" rel="noreferrer"><I.x_logo size={14} /> Share it</a>
        </div>
      )}
      <div className="cp">
        <div className="cp-head"><Header coin={coin} live={live} /></div>
        <div className="cp-chart"><ChartPanel coin={coin} live={live} /></div>
        <aside className="cp-side">
          <TradePanel coin={coin} live={live} listed={listed} />
          <RulesPanel coin={coin} live={live} stops={stops.data} />
          <StatsPanel coin={coin} live={live} />
          <CreatorFeesPanel coin={coin} />
          <ProgramCard />
          {coin.blocked > 0 && <CheckBox coin={coin} />}
        </aside>
        <div className="cp-tabs"><Tabs coin={coin} live={live} stops={stops.data} stopsLoading={stops.isLoading} /></div>
      </div>
    </div>
  );
}

const RULE_ORDER: RuleId[] = ['kols', 'snipers', 'dev', 'bundles', 'maxWallet', 'vamps'];
/** what the program answers a buy that breaks the rule with */
const RULE_ERR: Record<RuleId, string> = { kols: 'E::Bounced', snipers: 'fee 99%→1%', dev: 'E::DevBuy', bundles: 'E::Bundled', maxWallet: 'E::OverCap', vamps: 'site check' };
/** open the Code tab (from the header's proof band) */
const openCode = () => window.dispatchEvent(new CustomEvent('strict:coin-tab', { detail: 'code' }));

/** the coin at a glance: picture, name, its six rules as icons, the links, how old it is, and its market cap */
function Header({ coin, live }: { coin: Coin; live: Live | null }) {
  const toUsd = useUsd();
  const r = coinRules(coin);
  const bonded = coin.status === 'migrated' || !!live?.migrated;
  const mcap = live && live.priceSol > 0 ? live.priceSol * 1e9 : coin.mcapSol;
  const n = RULE_ORDER.filter((id) => isOn(r, id)).length;
  return (
    <section className="panel cp-h">
      <div className="cph-id">
        <Avatar src={coin.image} name={coin.symbol} size={64} square seed={coin.mint} />
        <div className="cph-names">
          <h1>{coin.name} <span className="cph-tk">${coin.symbol} · {ago(coin.createdAt)}</span></h1>
          <div className="cph-chips">
            <span className="cph-rules" title={`${n} of 6 rules on`}>
              {RULE_ORDER.filter((id) => isOn(r, id)).map((id) => <span key={id} className="ri on" title={RULE_NAME[id]}><RuleIcon id={id} box={0} size={13} /></span>)}
              <b>{n ? `${n} strict rule${n === 1 ? '' : 's'}` : 'No rules'}</b>
            </span>
            <Copy text={coin.mint} />
            <Link to={`/check?w=${coin.creator}`} className="copy"><Avatar seed={coin.creator} name="" size={16} />{short(coin.creator, 4)}</Link>
            {coin.pass && <span className="copy pass-chip" title="The creator fees go to whoever holds this coin's dev pass NFT"><I.users size={12} />Dev pass</span>}
            {coin.twitter && <a className="copy" href={coin.twitter} target="_blank" rel="noreferrer"><I.x_logo size={12} />X</a>}
            {coin.telegram && <a className="copy" href={coin.telegram} target="_blank" rel="noreferrer"><I.tg size={12} />Telegram</a>}
            {coin.website && <a className="copy" href={coin.website} target="_blank" rel="noreferrer"><I.globe size={12} />Site</a>}
            {bonded && coin.pool && <a className="copy" href={`https://raydium.io/swap/?inputMint=sol&outputMint=${coin.mint}`} target="_blank" rel="noreferrer">Raydium <I.ext size={11} /></a>}
          </div>
        </div>
      </div>
      <div className="cph-cap">
        <span className="eyebrow">Market cap</span>
        <b className="mono">{usd(toUsd(mcap))}</b>
        <span className="mono faint small">{amount(mcap, 1)} SOL · ATH {usd(toUsd(Math.max(coin.athMcapSol || 0, mcap)))}</span>
      </div>
      <ProofBand coin={coin} />
    </section>
  );
}

/**
 * The proof, in one bold line under the coin: the program enforcing its rules, the line of code that does the most
 * work for this coin, the tests, the audit, and the way into the full source.
 */
function ProofBand({ coin }: { coin: Coin }) {
  const r = coinRules(coin);
  const lead = RULE_ORDER.find((id) => isOn(r, id) && id !== 'vamps') || 'lock';
  const l = ruleLine(lead);
  return (
    <div className="cph-proof">
      <span className="cpp-who"><I.shield size={17} /><b>Enforced on chain</b></span>
      {l && (
        <button type="button" className="cpp-code" onClick={openCode} title="See all of this coin's code">
          <CodeLine n={l.n} line={l.code} js={l.js} />
        </button>
      )}
      <button type="button" className="cpp-read" onClick={openCode}>Read the code <I.arrow size={14} /></button>
    </div>
  );
}

/** the program behind the coin, read from chain: where it lives, whether it can still change, its tests and audit */
function ProgramCard() {
  const { data: cfg } = useConfig();
  const p = useProgram();
  const s = p.data;
  return (
    <section className="panel cp-prog">
      <div className="cpg-h"><b>The program</b>{cfg && <a className="mono faint small" href={`https://solscan.io/account/${cfg.programId}`} target="_blank" rel="noreferrer">{short(cfg.programId, 5)} <I.ext size={11} /></a>}</div>
      <ul>
        <li><span>Source</span><b className="green-t"><I.check size={12} />open</b></li>
        <li><span>Tests</span><b className="green-t"><I.check size={12} />{cfg?.testCount ?? 77} program · {cfg?.e2eCount ?? 57} end-to-end</b></li>
        <li><span>Upgrades</span>{!s ? <b className="faint">reading…</b> : !s.deployed ? <b className="amber-t">not deployed yet</b> : s.upgradeable ? <b className="amber-t">upgradeable until frozen</b> : <b className="green-t"><I.check size={12} />frozen</b>}</li>
        <li><span>Audit</span><b className="amber-t">[AUDITOR] · pending</b></li>
      </ul>
      <Link to="/proof" className="cpg-link">How to check all of this yourself →</Link>
    </section>
  );
}

/** the chart, and how far the coin is to bonding into its Raydium pool */
function ChartPanel({ coin, live }: { coin: Coin; live: Live | null }) {
  const { data: cfg } = useConfig();
  const [tf, setTf] = useState('5m');
  const [unit, setUnit] = useState<'mcap' | 'price'>('mcap');
  const [kind, setKind] = useState<'line' | 'candles'>('line');
  const candles = useQuery({ queryKey: ['candles', coin.mint, tf], queryFn: () => api.candles(coin.mint, tf), refetchInterval: 6_000 });
  const bonded = coin.status === 'migrated' || !!live?.migrated;
  const progress = bonded ? 100 : live?.progress ?? coin.progress;
  const solToBond = cfg && live ? Math.max(0, cfg.bondSol - Number(live.realSol) / 1e9) : null;
  const usdPerSol = cfg?.solUsd || 1;
  const supply = (cfg?.supply || 1e9);
  return (
    <section className="panel cp-c">
      <div className="cpc-top">
        <div className="seg s"><button className={unit === 'mcap' ? 'on' : ''} onClick={() => setUnit('mcap')}>Market cap</button><button className={unit === 'price' ? 'on' : ''} onClick={() => setUnit('price')}>Price</button></div>
        <div className="cpc-r">
          <div className="seg s">{TFS.map((x) => <button key={x} className={tf === x ? 'on' : ''} onClick={() => setTf(x)}>{x}</button>)}</div>
          <div className="seg s"><button className={kind === 'line' ? 'on' : ''} onClick={() => setKind('line')}>Line</button><button className={kind === 'candles' ? 'on' : ''} onClick={() => setKind('candles')}>Candles</button></div>
        </div>
      </div>
      <div className="cpc-chart">
        <Suspense fallback={<div className="chart-box" />}>
          <Chart key={`${tf}${unit}${kind}`} candles={candles.data || []} scale={unit === 'mcap' ? usdPerSol : usdPerSol / supply} kind={kind} />
        </Suspense>
        {!candles.isLoading && !(candles.data || []).length && <div className="chart-empty"><b>No trades yet</b><span className="small muted">The chart starts with the first buy.</span></div>}
      </div>
      <div className="cpc-bond">
        <div className="row-between small">
          <b>{bonded ? 'Bonded into a Raydium pool' : coin.status === 'complete' ? 'Bonding now: moving into its Raydium pool' : `${progress.toFixed(0)}% of the way to Raydium`}</b>
          <span className="mono muted">{bonded ? 'LP burned' : solToBond != null ? `${amount(solToBond, 2)} SOL to go` : ''}</span>
        </div>
        <Progress pct={progress} large />
        <p className="cpc-note">
          {bonded
            ? <>The curve filled and moved into a <b>Raydium</b> CPMM pool with every LP token burned, so its liquidity is locked for good. The rules are done; the KOL list's rent and the sniper fees bought back and burned {coin.burnedTokens ? <b>{amount(coin.burnedTokens)} ${coin.symbol}</b> : `$${coin.symbol}`}.</>
            : <>At about {cfg ? Math.round(cfg.bondSol) : 85} SOL the curve completes and anyone can move it into a <b>Raydium</b> CPMM pool: every LP token is burned, the KOL list closes, and its rent plus the sniper fees buy back and burn ${coin.symbol}. Until then, its rules hold.</>}
        </p>
      </div>
    </section>
  );
}

/** the coin's six rules, compact: on or off, what each has done, and the check against the chain */
function RulesPanel({ coin, live, stops }: { coin: Coin; live: Live | null; stops?: Stops }) {
  const { data: cfg } = useConfig();
  const r = coinRules(coin);
  const list = rulesFor(cfg, r.maxWalletBps || undefined);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  const on = list.filter((x) => isOn(r, x.id)).length;
  async function verify() {
    if (!cfg || !live) return;
    setChecking(true); setErr('');
    try {
      const all = coin.blocked ? await api.list(coin.mint) : { people: [], others: [] as string[] };
      const wallets = [...all.people.flatMap((p) => p.wallets), ...all.others];
      setVerdict(await verifyList({ programId: cfg.programId, mint: coin.mint, curve: live.accounts.curve, wallets, rpc: cfg.publicRpc }));
    } catch (e) { setErr((e as Error).message); } finally { setChecking(false); }
  }
  return (
    <section className="panel cp-rules">
      <div className="cpr-h"><span className="cpr-t"><I.lock size={14} /><b>The rules</b></span><span className="cpr-on"><b>{on}</b>/6 on · locked at launch</span></div>
      <ul>
        {list.map((x) => {
          const yes = isOn(r, x.id);
          const st = yes || x.id === 'maxWallet' ? statFor(x.id, coin, stops) : null;
          return (
            <li key={x.id} className={yes ? '' : 'off'}>
              <RuleIcon id={x.id} box={28} size={14} off={!yes} />
              <span className="cpr-n"><b>{x.id === 'maxWallet' ? (yes ? `Max wallet ${bpsPct(r.maxWalletBps)}` : 'Max wallet') : x.title}</b><span className={yes ? (x.onChain ? 'err' : 'site') : ''}>{yes ? RULE_ERR[x.id] : 'off'}</span></span>
              {st ? <span className="cpr-v"><b className={`mono${st.red ? ' red' : ''}`}>{st.v}</b><span>{st.l}</span></span> : <span className="cpr-v faint">—</span>}
            </li>
          );
        })}
      </ul>
      <div className="cpr-f">
        {verdict ? (verdict.ok
          ? <span className="verified-ok"><I.check size={14} /> Matches the chain{verdict.program && (verdict.program.upgradeable ? ' · program upgradeable' : ' · program final')}</span>
          : <span className="red small">The list doesn't match the chain ({verdict.count} vs {verdict.blocked}).</span>)
          : <button className="btn verify s block" onClick={verify} disabled={checking || !live}>{checking ? <Spinner size={14} /> : <I.check size={14} />} Verify against chain</button>}
        {err && <p className="err-text small">{err}</p>}
      </div>
    </section>
  );
}

function StatsPanel({ coin, live }: { coin: Coin; live: Live | null }) {
  const toUsd = useUsd();
  const price = live?.priceSol ?? coin.priceSol;
  return (
    <section className="panel">
      <dl className="cp-stats">
        <div><dt>Price</dt><dd className="mono">{usd(toUsd(price), { compact: false })}</dd></div>
        <div><dt>In SOL</dt><dd className="mono">{amount(price)}</dd></div>
        <div><dt>Volume</dt><dd className="mono">{usd(toUsd(coin.volumeSol))}</dd></div>
        <div><dt>Trades</dt><dd className="mono">{coin.trades.toLocaleString()}</dd></div>
        <div><dt>Buys stopped</dt><dd className={`mono${coin.stopped ? ' red' : ''}`}>{(coin.stopped || 0).toLocaleString()}</dd></div>
        <div><dt>Creator paid</dt><dd className="mono">{amount(coin.creatorPaidSol || 0, 3)} SOL</dd></div>
      </dl>
    </section>
  );
}

/** under the chart: trades, what the rules stopped, holders, the list, the code, and the coin's accounts */
function Tabs({ coin, live, stops, stopsLoading }: { coin: Coin; live: Live | null; stops?: Stops; stopsLoading: boolean }) {
  const [tab, setTab] = useState<'trades' | 'stops' | 'holders' | 'list' | 'code' | 'about'>('trades');
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const go = (e: Event) => { setTab((e as CustomEvent).detail); setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
    window.addEventListener('strict:coin-tab', go);
    return () => window.removeEventListener('strict:coin-tab', go);
  }, []);
  const nStops = stops?.events.length || 0;
  return (
    <section className="panel cp-t" ref={box}>
      <div className="tabs-x" role="tablist">
        <button role="tab" aria-selected={tab === 'trades'} className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>Trades</button>
        <button role="tab" aria-selected={tab === 'stops'} className={tab === 'stops' ? 'on' : ''} onClick={() => setTab('stops')}>Rules at work{nStops ? <span className="count red">{nStops}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'holders'} className={tab === 'holders' ? 'on' : ''} onClick={() => setTab('holders')}>Holders</button>
        {coin.blocked > 0 && <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>KOL list<span className="count">{coin.blocked.toLocaleString()}</span></button>}
        <button role="tab" aria-selected={tab === 'code'} className={`code-tab${tab === 'code' ? ' on' : ''}`} onClick={() => setTab('code')}><I.code size={14} />Code</button>
        <button role="tab" aria-selected={tab === 'about'} className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>About</button>
      </div>
      {tab === 'trades' && <Activity coin={coin} kind="trades" />}
      {tab === 'holders' && <Activity coin={coin} kind="holders" />}
      {tab === 'stops' && <>{coin.shield && <SniperReplay coin={coin} createdAt={live?.createdAt} />}<RulesAtWork stops={stops} loading={stopsLoading} /></>}
      {tab === 'list' && <ListCard coin={coin} />}
      {tab === 'code' && <CodeTab coin={coin} />}
      {tab === 'about' && <About coin={coin} live={live} />}
    </section>
  );
}

/** the source behind each rule this coin picked, one at a time */
function CodeTab({ coin }: { coin: Coin }) {
  const { data: cfg } = useConfig();
  const r = coinRules(coin);
  const ids = RULE_ORDER.filter((id) => isOn(r, id));
  const [pick, setPick] = useState<RuleId | 'lock'>(ids[0] || 'lock');
  const blocks = (source as Record<string, Block[]>)[pick];
  return (
    <div className="cp-code">
      <div className="seg s">
        {ids.map((id) => <button key={id} className={pick === id ? 'on' : ''} onClick={() => setPick(id)}>{RULE_NAME[id]}</button>)}
        <button className={pick === 'lock' ? 'on' : ''} onClick={() => setPick('lock')}>The lock</button>
      </div>
      <div className="cp-code-in">{blocks.map((b, i) => <CodeBlock key={`${pick}${i}`} block={b} sourceUrl={cfg?.sourceUrl} />)}</div>
      {!ids.length && <p className="muted small">This coin picked no rules. The lock still applies to every coin.</p>}
    </div>
  );
}

function About({ coin, live }: { coin: Coin; live: Live | null }) {
  const { data: cfg } = useConfig();
  const sol = (a: string) => `https://solscan.io/account/${a}`;
  const Row = ({ k, children }: { k: string; children: ReactNode }) => <div className="kv"><span className="k">{k}</span><span className="v">{children}</span></div>;
  return (
    <div className="cp-about">
      {coin.description && <p className="cpa-desc">{coin.description}</p>}
      <div className="kvs">
        <Row k="Contract"><Copy text={coin.mint} /></Row>
        <Row k="Creator"><a className="mono" href={sol(coin.creator)} target="_blank" rel="noreferrer">{short(coin.creator, 6)}</a></Row>
        <Row k="Launched">{new Date(coin.createdAt).toLocaleString()}</Row>
        {coin.signature && <Row k="Launch transaction"><a className="mono" href={`https://solscan.io/tx/${coin.signature}`} target="_blank" rel="noreferrer">{short(coin.signature, 6)}</a></Row>}
        {live && <Row k="Bonding curve"><a className="mono" href={sol(live.accounts.curve)} target="_blank" rel="noreferrer">{short(live.accounts.curve, 6)}</a></Row>}
        {live && coin.blocked > 0 && <Row k="Sealed list"><a className="mono" href={sol(live.accounts.list)} target="_blank" rel="noreferrer">{short(live.accounts.list, 6)}</a></Row>}
        {coin.listHash && <Row k="List fingerprint"><span className="mono">{coin.listHash.slice(0, 10)}…{coin.listHash.slice(-6)}</span></Row>}
        <Row k="Creator fees">{coin.pass ? <>to the holder of the dev pass <a className="mono" href={sol(coin.pass)} target="_blank" rel="noreferrer">{short(coin.pass, 6)}</a></> : 'locked to the creator'}</Row>
        {coin.pool && <Row k="Raydium pool"><a className="mono" href={sol(coin.pool)} target="_blank" rel="noreferrer">{short(coin.pool, 6)}</a></Row>}
        {cfg && <Row k="Program"><a className="mono" href={sol(cfg.programId)} target="_blank" rel="noreferrer">{short(cfg.programId, 6)}</a></Row>}
      </div>
      <p className="cpa-note">${coin.symbol} trades on strict.fun's own bonding curve until it bonds, then in a <b>Raydium</b> CPMM pool with its LP burned. The strict program holds the curve's funds and checks every buy against the coin's rules; strict.fun only builds the transactions you sign.</p>
    </div>
  );
}

/** what each rule did for this coin, from /stops */
function statFor(id: RuleId, coin: Coin, s: Stops | undefined): { v: string; l: string; red?: boolean } | null {
  if (!s) return null;
  const c = s.counts;
  switch (id) {
    case 'kols': return { v: String(c.kols), l: 'KOL-list buys stopped', red: c.kols > 0 };
    case 'snipers': return { v: `${amount(s.sniperSol, 2)} SOL`, l: `paid by ${s.sniperBuys} sniper${s.sniperBuys === 1 ? '' : 's'}` };
    case 'dev': return s.creatorHoldsPct != null ? { v: `${s.creatorHoldsPct.toFixed(s.creatorHoldsPct < 1 ? 1 : 0)}%`, l: 'held by the creator' } : { v: String(c.dev), l: 'creator buys stopped', red: c.dev > 0 };
    case 'bundles': return { v: String(c.bundles), l: 'launch-block buys stopped', red: c.bundles > 0 };
    case 'maxWallet': return coin.maxWalletBps > 0 ? { v: String(c.maxWallet), l: 'buys over the cap stopped', red: c.maxWallet > 0 } : s.topHolderPct != null ? { v: `${s.topHolderPct.toFixed(1)}%`, l: 'biggest holder' } : null;
    case 'vamps': return { v: String(c.vamps), l: 'copycats refused', red: c.vamps > 0 };
  }
}

function RulesAtWork({ stops, loading }: { stops?: Stops; loading: boolean }) {
  const events = stops?.events || [];
  return (
    <div className="feed-card">
      {loading ? <div className="pad center"><Spinner /></div> : events.length ? events.map((e, i) => (
        <div className="fc-row" key={(e.sig || '') + e.ts + i}>
          <span className="fc-t mono">{ago(e.ts)} ago</span>
          <span className="fc-who">{e.kol ? <><Avatar src={e.kol.pfp} name={e.kol.name} size={20} /><b>{e.kol.name}</b></> : <span className="mono">{short(e.wallet, 4)}</span>}</span>
          <span className="fc-what">{e.sol ? `Tried to buy ${amount(e.sol, 3)} SOL. ` : 'Tried to buy. '}{e.rule === 'kols' ? 'Stopped: this wallet is on the KOL list.' : e.rule === 'dev' ? 'Stopped: the creator can\'t buy until it bonds.' : e.rule === 'bundles' ? 'Stopped: nothing buys in the launch block.' : 'Stopped: over the max wallet.'}
            {e.sig && e.source === 'chain' && <> <a href={`https://solscan.io/tx/${e.sig}`} target="_blank" rel="noreferrer" className="faint">tx <I.ext size={11} /></a></>}</span>
          <span className="pill-s stop">{RULE_NAME[e.rule]}</span>
        </div>
      )) : <p className="muted small pad">No buys stopped yet. When a rule stops one, it shows up here.</p>}
    </div>
  );
}

function ListCard({ coin }: { coin: Coin }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['list', coin.mint], queryFn: () => api.list(coin.mint), enabled: coin.blocked > 0 });
  const bonded = coin.status === 'migrated';
  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = list.data?.people || [];
    return s ? all.filter((p) => p.name.toLowerCase().includes(s) || (p.handle || '').toLowerCase().includes(s)) : all;
  }, [q, list.data]);
  return (
    <div className="list-card">
      <div className="lc-head">
        <div>
          <h2>{bonded ? 'The KOL list, retired at bonding' : 'The KOL list'}</h2>
          <p className="muted small">{coin.blocked.toLocaleString()} wallets {bonded ? 'were' : 'are'} kept out{bonded ? ' until it bonded' : ' until it bonds'}. {list.data ? <>{list.data.people.length} KOLs reaching {followers(list.data.reach)} followers{list.data.othersCount ? `, plus ${list.data.othersCount.toLocaleString()} other wallets` : ''}.</> : 'Loading the list…'}</p>
        </div>
        <label className="search"><I.search size={15} /><input placeholder="Find someone" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {people.length > 0 && (
        <div className="list-wall">
          {people.slice(0, 120).map((p) => (
            <Link key={p.id} to={`/kol/${p.id}`} className="list-kol">
              <Avatar src={p.pfp} name={p.name} size={34} />
              <span><b>{p.name}{p.verified && <> <Verified /></>}</b><span><Fol n={p.followers} /></span></span>
            </Link>
          ))}
        </div>
      )}
      {people.length > 120 && <p className="faint small pad-x">And {people.length - 120} more KOLs. Search to find anyone.</p>}
    </div>
  );
}

function Activity({ coin, kind }: { coin: Coin; kind: 'trades' | 'holders' }) {
  const tab = kind;
  const trades = useQuery({ queryKey: ['trades', coin.mint], queryFn: () => api.trades(coin.mint), refetchInterval: 5_000, enabled: tab === 'trades' });
  const holders = useQuery({ queryKey: ['holders', coin.mint], queryFn: () => api.holders(coin.mint), refetchInterval: 30_000, enabled: tab === 'holders' });
  const toUsd = useUsd();
  return (
    <div className="cp-table">
      <div className="scroll-x">
        {tab === 'trades' ? (
          <table className="table">
            <thead><tr><th>Who</th><th>Side</th><th className="r">SOL</th><th className="r">${coin.symbol}</th><th className="r">mcap</th><th className="r">When</th></tr></thead>
            <tbody>
              {(trades.data || []).map((t) => (
                <tr key={t.sig + t.ts + t.side}>
                  <td><span className="who-cell">{t.kol ? <><Avatar src={t.kol.pfp} name={t.kol.name} size={24} /><b>{t.kol.name}</b></> : <a className="mono" href={`https://solscan.io/account/${t.wallet}`} target="_blank" rel="noreferrer">{short(t.wallet, 4)}</a>}</span></td>
                  <td className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                  <td className="r mono">{amount(t.sol, 3)}</td>
                  <td className="r mono">{amount(t.tokens)}</td>
                  <td className="r mono">{usd(toUsd(t.mcapSol))}</td>
                  <td className="r"><a className="muted" href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer">{ago(t.ts)}</a></td>
                </tr>
              ))}
              {trades.data && !trades.data.length && <tr><td colSpan={6} className="muted center pad">No trades yet.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead><tr><th>#</th><th>Holder</th><th className="r">Share</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {(holders.data || []).map((h, i) => (
                <tr key={h.owner || i}>
                  <td className="faint">{i + 1}</td>
                  <td><span className="who-cell">
                    {h.label === 'curve' ? <span className="chip">Bonding curve</span> : h.label === 'pool' ? <span className="chip green">Raydium pool</span> : h.kol ? <><Avatar src={h.kol.pfp} name={h.kol.name} size={24} /><b>{h.kol.name}</b></> : <a className="mono" href={`https://solscan.io/account/${h.owner}`} target="_blank" rel="noreferrer">{short(h.owner, 4)}</a>}
                    {h.label === 'creator' && <span className="chip accent">creator</span>}
                  </span></td>
                  <td className="r mono">{h.pct.toFixed(2)}%</td>
                  <td className="r mono">{amount(h.amount)}</td>
                </tr>
              ))}
              {holders.isLoading && <tr><td colSpan={4} className="center pad"><Spinner /></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CheckBox({ coin }: { coin: Coin }) {
  const [v, setV] = useState('');
  const list = useQuery({ queryKey: ['list', coin.mint], queryFn: () => api.list(coin.mint), enabled: coin.blocked > 0 });
  const s = v.trim();
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  const hit = valid && list.data ? (list.data.others.includes(s) || list.data.people.find((p) => p.wallets.includes(s)) || null) : null;
  return (
    <div className="panel pad">
      <b>Is a wallet on this list?</b>
      <label className="search" style={{ width: '100%', marginTop: 12 }}><I.search size={15} /><input placeholder="Paste a wallet" value={v} onChange={(e) => setV(e.target.value)} /></label>
      {valid && list.data && (
        <div className="row-gap" style={{ marginTop: 14, alignItems: 'center' }}>
          {hit ? <><span className="pill-s stop">On the list</span><span className="muted small">{typeof hit === 'object' ? `${hit.name}'s wallet` : 'This wallet'} can't buy until it bonds.</span></>
            : <><span className="pill-s on">Not on it</span><span className="muted small">This wallet can buy.</span></>}
        </div>
      )}
    </div>
  );
}

