// Launch a coin: name it, pick its rules, launch. The KOL list is written on chain in a few transactions, then the
// launch seals it and writes the coin's rules; the wallet approves them all at once. The rules lock the moment it's live.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FeesPick, type FeesTo } from '../components/DevPass';
import { RuleCode } from '../components/RuleCode';
import { SniperDemo } from '../components/SniperCurve';
import { Avatar, Checked, Fol, I, Modal, Spinner, Verified } from '../components/ui';
import { api, ApiError, type Check, type DirKol, type Prepared, type RuleId } from '../lib/api';
import { isAddress } from '../lib/b58';
import { type Shield } from '../lib/curve';
import { followers, listRentSol, useConfig, useKols, useUsd } from '../lib/data';
import { amount, bpsPct, usd } from '../lib/format';
import { preparePicture } from '../lib/image';
import { DEFAULT_MAX_WALLET_BPS, DEFAULT_PICKS, MAX_WALLET_CHOICES, pickCount, picksFromQuery, rulesFor, type Picks } from '../lib/rules';
import { useToast } from '../lib/toast';
import { useWallet, walletError } from '../lib/wallet';

const CREATE_SOL = 0.0224; // mint, metadata (and Metaplex's fee), the curve, its vault: see launchCost in worker/launch.js
const PASS_SOL = 0.0021; // a dev pass's rent (a Core asset, ~160 bytes)
const PRESETS = [
  { id: 'reach', label: '10k+ followers' },
  { id: 'top25', label: 'Top 25' },
  { id: 'top100', label: 'Top 100' },
  { id: 'verified', label: 'Verified on X' },
  { id: 'all', label: 'Everyone' },
] as const;
const LENGTHS = { exponential: [5, 8, 15, 30], linear: [30, 60, 120, 300] } as const;
const secsLabel = (s: number) => (s >= 60 ? `${s / 60}m` : `${s}s`);

type Img = { url: string; path: string; hash: string | null; preview: string };

export default function Launch() {
  const { data: cfg } = useConfig();
  const { data: dir } = useKols();
  const people = dir?.kols || [];
  const w = useWallet();
  const toast = useToast();
  const nav = useNavigate();
  const toUsd = useUsd();
  const [params] = useSearchParams();

  // ---- the coin
  const [image, setImage] = useState<Img | null>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [links, setLinks] = useState({ twitter: '', telegram: '', website: '' });
  const [showLinks, setShowLinks] = useState(false);
  const [devBuy, setDevBuy] = useState('');
  const [feesTo, setFeesTo] = useState<FeesTo>('creator');
  const [advanced, setAdvanced] = useState(false);

  // ---- the rules (from the home page's picks, else the defaults)
  const fromUrl = useMemo(() => picksFromQuery(params), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [picks, setPicks] = useState<Picks>(fromUrl?.picks || DEFAULT_PICKS);
  const [mw, setMw] = useState(fromUrl?.maxWalletBps || DEFAULT_MAX_WALLET_BPS);
  const [shieldKind, setShieldKind] = useState<'exponential' | 'linear'>('linear');
  const [shieldSecs, setShieldSecs] = useState(60);
  const seededRules = useRef(!!fromUrl);
  useEffect(() => {
    if (seededRules.current || !cfg?.rulesDefault) return;
    seededRules.current = true;
    const d = cfg.rulesDefault;
    setPicks({ kols: d.kols, snipers: d.snipers, dev: d.dev, bundles: d.bundles, maxWallet: d.maxWalletBps > 0, vamps: d.vamps });
    if (d.maxWalletBps > 0) setMw(d.maxWalletBps);
    if (cfg.shieldDefault) { setShieldKind(cfg.shieldDefault.kind); setShieldSecs(cfg.shieldDefault.secs); }
  }, [cfg]);
  const set = (id: RuleId, v: boolean) => setPicks((p) => ({ ...p, [id]: v }));

  // ---- the KOL list
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<string>('all');
  const [own, setOwn] = useState<string[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !people.length) return;
    seeded.current = true;
    setPicked(new Set(people.map((p) => p.id)));
  }, [people]);
  const wallets = useMemo(() => {
    if (!picks.kols) return [];
    const s = new Set<string>();
    for (const p of people) if (picked.has(p.id)) p.wallets.forEach((x) => s.add(x));
    own.forEach((x) => s.add(x));
    if (w.address) s.delete(w.address);
    return [...s];
  }, [picks.kols, people, picked, own, w.address]);
  const applyPreset = (id: string) => {
    setPreset(id);
    const min = cfg?.kolMinFollowers ?? 10_000;
    const sel = id === 'reach' ? people.filter((p) => p.followers >= min)
      : id === 'top25' ? people.slice(0, 25) : id === 'top100' ? people.slice(0, 100)
      : id === 'verified' ? people.filter((p) => p.verified) : people;
    setPicked(new Set(sel.map((p) => p.id)));
  };

  // ---- the copycat check: as the coin is typed, against every coin that picked no vamps
  const [vk, setVk] = useState({ symbol: '', name: '', twitter: '', imageHash: '' as string | null });
  useEffect(() => {
    const t = setTimeout(() => setVk({ symbol: symbol.trim(), name: name.trim(), twitter: links.twitter.trim(), imageHash: image?.hash || null }), 400);
    return () => clearTimeout(t);
  }, [symbol, name, links.twitter, image?.hash]);
  const vampQ = useQuery({
    queryKey: ['vamp', vk], queryFn: () => api.vampCheck({ symbol: vk.symbol || undefined, name: vk.name || undefined, twitter: vk.twitter || undefined, imageHash: vk.imageHash }),
    enabled: !!(vk.symbol || vk.name || vk.twitter || vk.imageHash), retry: false, staleTime: 10_000,
  });
  const vamp = vampQ.data;
  const vampFails = vamp ? [vamp.ticker, vamp.name, vamp.x, vamp.picture].filter((x) => x && !x.ok).length : 0;

  const list = rulesFor(cfg, mw);
  const max = cfg?.listMax || 1000;
  const rent = listRentSol(cfg, wallets.length);
  const devBlocked = picks.dev ? 'Off: you picked no dev buy' : picks.bundles ? "Off: no bundles means nothing buys in the launch block, your first buy included. Buy after it's live." : '';
  const dev = devBlocked ? 0 : Math.max(0, Number(devBuy) || 0);
  const shield: Shield = picks.snipers ? { kind: shieldKind, secs: shieldSecs } : null;
  const withPass = feesTo === 'pass';
  const txs = 1 + (wallets.length ? Math.ceil(wallets.length / 28) : 0) + (withPass && dev > 0 ? 1 : 0);
  const total = CREATE_SOL + rent + dev + 0.0002 * txs + (withPass ? PASS_SOL : 0);
  const n = pickCount(picks);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try {
      const pic = await preparePicture(f);
      const r = await api.upload(pic.blob);
      setImage({ url: r.url, path: r.path, hash: r.hash || pic.hash, preview: pic.preview });
    } catch (e) { toast({ kind: 'bad', text: (e as Error).message }); } finally { setUploading(false); }
  }

  const tickerOk = /^[A-Za-z0-9]{1,10}$/.test(symbol.replace(/^\$/, ''));
  const ready = !!image && !!name.trim() && tickerOk && wallets.length <= max && !vampFails;
  const missing = !image ? 'Add a picture' : !name.trim() ? 'Name your coin' : !tickerOk ? 'Pick a ticker' : wallets.length > max ? 'Shorten the list' : vampFails ? 'Fix the copycat check' : '';
  const [flow, setFlow] = useState<null | { stage: 'build' | 'sign' | 'list' | 'pass' | 'launch' | 'live' | 'error'; done?: number; of?: number; error?: string; prep?: Prepared; mint?: string }>(null);

  async function launch(resume?: string) {
    const creator = await w.ensure();
    if (!creator) return;
    setFlow({ stage: 'build' });
    try {
      const body = resume ? { creator, resume } : {
        creator, name: name.trim(), symbol: symbol.replace(/^\$/, '').toUpperCase(), description, image: image?.url, ...links, devBuySol: dev,
        wallets, shield, noDevBuy: picks.dev, noBundles: picks.bundles, maxWalletBps: picks.maxWallet ? mw : 0, noVamps: picks.vamps, imageHash: image?.hash || null,
        pass: feesTo === 'pass',
      };
      const prep = await api.prepare(body);
      setFlow({ stage: 'sign', prep, of: prep.txs.filter((t) => t.kind === 'list').length });
      const signed = await w.signAll(prep.txs.map((t) => t.tx));
      const listTxs = prep.txs.filter((t) => t.kind === 'list').length;
      setFlow({ stage: listTxs ? 'list' : 'launch', prep, done: 0, of: listTxs });
      const end = await api.submit(prep.id, signed, (s) => {
        if (s.step === 'list') setFlow({ stage: 'list', prep, done: s.done, of: s.of });
        if (s.step === 'pass') setFlow({ stage: 'pass', prep, done: listTxs, of: listTxs });
        if (s.step === 'launch') setFlow({ stage: 'launch', prep, done: listTxs, of: listTxs });
      });
      if (!end || end.step === 'error' || end.error) throw Object.assign(new Error(end?.error || 'The launch stopped.'), { prep });
      setFlow({ stage: 'live', prep, mint: end.mint });
      setTimeout(() => nav(`/coin/${end.mint}`, { state: { launched: true } }), 1600);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as any)?.prep ? (e as Error).message : walletError(e);
      setFlow((f) => ({ stage: 'error', error: msg, prep: (e as any).prep || f?.prep }));
    }
  }

  async function closeList(id: string) {
    try {
      const r = await api.closeList(id, w.address!);
      await w.signAndSend(r.tx, r.lastValidBlockHeight);
      toast({ kind: 'good', text: `List closed. ${amount(r.refund / 1e9, 4)} SOL is back in your wallet.` });
      setFlow(null);
    } catch (e) { toast({ kind: 'bad', text: e instanceof ApiError ? e.message : walletError(e) }); }
  }

  return (
    <div className="wrap page">
      <header className="page-head">
        <div>
          <h1>Launch a coin</h1>
          <p>Name it, pick its rules, launch. The rules lock the moment it goes live.</p>
        </div>
      </header>

      <div className="launch-grid">
        <div className="launch-main">
          <section className="card step">
            <h2 className="step-h"><span>1</span> Your coin</h2>
            <label className={`drop${uploading ? ' busy' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
              <span className="drop-art">{image ? <img src={image.preview} alt="" /> : uploading ? <Spinner /> : <I.image size={26} />}</span>
              <span className="drop-t"><b>{image ? 'Picture added' : 'Add a picture'}</b><span>PNG, JPG, WEBP or GIF. It's cropped square at 512 px.</span></span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <div className="form-row">
              <label className="field"><span className="field-l">Name <span className="hint">{name.length}/32</span></span><input className="input" maxLength={32} placeholder="Gavel" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span className="field-l">Ticker <span className="hint">{symbol.length}/10</span></span>
                <span className="input-wrap"><span className="prefix">$</span><input className="input" maxLength={10} placeholder="GAVEL" value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} /></span>
              </label>
            </div>
            <label className="field"><span className="field-l">Description <span className="hint">optional</span></span><textarea className="input" maxLength={600} placeholder="What's the coin about?" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            {showLinks ? (
              <div className="form-row three">
                <label className="field"><span className="field-l">X</span><input className="input" placeholder="x.com/…" value={links.twitter} onChange={(e) => setLinks({ ...links, twitter: e.target.value })} /></label>
                <label className="field"><span className="field-l">Telegram</span><input className="input" placeholder="t.me/…" value={links.telegram} onChange={(e) => setLinks({ ...links, telegram: e.target.value })} /></label>
                <label className="field"><span className="field-l">Website</span><input className="input" placeholder="https://…" value={links.website} onChange={(e) => setLinks({ ...links, website: e.target.value })} /></label>
              </div>
            ) : <button className="more-toggle" onClick={() => setShowLinks(true)}><I.plus size={15} /> Add socials</button>}
            <CopycatCheck vamp={vamp} loading={vampQ.isFetching} touched={!!(vk.symbol || vk.name || vk.twitter || vk.imageHash)} />
          </section>

          <section className="card step">
            <div className="step-head">
              <h2 className="step-h"><span>2</span> Your rules</h2>
              <span className="muted">Pick any. You can't change them after launch.</span>
            </div>
            <div className="rule-checks">
              {list.map((r) => (
                <RuleCheck key={r.id} id={r.id} title={r.title} plain={r.plain} onChain={r.onChain} on={picks[r.id]} onToggle={(v) => set(r.id, v)}>
                  {r.id === 'kols' && (
                    <KolList people={people} picked={picked} setPicked={(s) => { setPicked(s); setPreset(''); }} preset={preset} applyPreset={applyPreset}
                      own={own} setOwn={setOwn} wallets={wallets.length} rent={rent} max={max} creator={w.address} />
                  )}
                  {r.id === 'snipers' && (
                    <div className="rule-extra">
                      <div className="extra-row">
                        <div className="seg s">
                          <button className={shieldKind === 'linear' ? 'on' : ''} onClick={() => { setShieldKind('linear'); setShieldSecs(60); }}>Linear</button>
                          <button className={shieldKind === 'exponential' ? 'on' : ''} onClick={() => { setShieldKind('exponential'); setShieldSecs(8); }}>Fast</button>
                        </div>
                        <div className="seg s">{LENGTHS[shieldKind].map((s) => <button key={s} className={shieldSecs === s ? 'on' : ''} onClick={() => setShieldSecs(s)}>{secsLabel(s)}</button>)}</div>
                      </div>
                      <SniperDemo shield={{ kind: shieldKind, secs: shieldSecs }} />
                      <span className="faint small">{shieldKind === 'exponential' ? `Fast: 99% in the launch second, then down by the same factor every second to 1% at ${shieldSecs}s. Bots trade in the first second or two; people can't.` : `Linear: a straight line from 99% to 1% over ${secsLabel(shieldSecs)}. Gentler, longer.`}</span>
                    </div>
                  )}
                  {r.id === 'maxWallet' && (
                    <div className="rule-extra">
                      <div className="seg s" role="radiogroup" aria-label="Max wallet">{MAX_WALLET_CHOICES.map((b) => <button key={b} role="radio" aria-checked={mw === b} className={mw === b ? 'on' : ''} onClick={() => setMw(b)}>{bpsPct(b)}</button>)}</div>
                      <span className="faint small">That's {(((cfg?.supply || 1e9) * mw) / 10_000 / 1e6).toLocaleString()}M tokens per wallet until it bonds.</span>
                    </div>
                  )}
                  {r.id === 'vamps' && <div className="rule-extra"><span className="faint small">While your coin is live, a new coin with its ticker, name, X account or picture can't launch here.</span></div>}
                </RuleCheck>
              ))}
            </div>
          </section>

          <section className="card step">
            <h2 className="step-h"><span>3</span> Your first buy <span className="hint">optional</span></h2>
            <label className="field">
              <span className="field-l">{devBlocked || 'Bought in the launch transaction, before anyone else'}</span>
              <span className="input-wrap"><input className="input" inputMode="decimal" placeholder="0" disabled={!!devBlocked} value={devBlocked ? '' : devBuy} onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ''))} /><span className="suffix">SOL</span></span>
            </label>
          </section>

          <section className={`card step adv${advanced ? ' open' : ''}`}>
            <button type="button" className="adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
              <h2 className="step-h"><span>4</span> Advanced <span className="hint">creator fees: {withPass ? 'dev pass NFT' : 'locked to your wallet'}</span></h2>
              <I.chev size={16} />
            </button>
            {advanced && <FeesPick value={feesTo} onChange={setFeesTo} symbol={symbol} image={image?.preview || null} devBuy={dev > 0} />}
          </section>
        </div>

        <aside className="launch-side">
          <span className="side-label">What buyers will see</span>
          <div className="buyer-card">
            <div className="bc-head">
              {image ? <Avatar src={image.preview} name={symbol} size={56} square /> : <span className="bc-empty"><I.image size={22} /></span>}
              <span className="bc-names"><b>{name || 'Your coin'}</b><span>${symbol || 'TICKER'} · plays by {n} strict rule{n === 1 ? '' : 's'}</span></span>
            </div>
            <div className="bc-rules">
              {list.map((r) => (
                <div key={r.id} className={`bc-rule${picks[r.id] ? '' : ' off'}`}>
                  <span className="bc-mark">{picks[r.id] ? '✓' : '–'}</span>
                  <span className="bc-t"><b>{r.title}</b><span>{r.short}</span></span>
                  <span className="bc-state">{picks[r.id] ? 'On' : 'Not picked'}</span>
                </div>
              ))}
            </div>
            <div className="bc-fees"><span>Creator fees</span><b>{withPass ? 'To the dev pass holder (NFT)' : 'Locked to the creator'}</b></div>
            <div className="bc-foot">
              <span><I.lock size={14} /> Locked at launch</span>
              <span className="green-t"><I.check size={14} /> Verified on chain</span>
            </div>
          </div>
          <span className="faint small">This card shows on your coin page, on the board and on the image people share on X.</span>

          <div className="card summary">
            <div className="line"><span>Creating the coin</span><b className="mono">{CREATE_SOL.toFixed(4)} SOL</b></div>
            {wallets.length > 0 && <div className="line"><span>Storing the list ({wallets.length.toLocaleString()} wallets)</span><b className="mono">{rent.toFixed(4)} SOL</b></div>}
            {withPass && <div className="line"><span>Minting the dev pass</span><b className="mono">{PASS_SOL.toFixed(4)} SOL</b></div>}
            {dev > 0 && <div className="line"><span>Your first buy</span><b className="mono">{amount(dev, 4)} SOL</b></div>}
            <div className="line"><span>Network fees ({txs} transaction{txs === 1 ? '' : 's'})</span><b className="mono">~{(0.0002 * txs).toFixed(4)} SOL</b></div>
            <div className="line total"><span>Total</span><b className="mono">{total.toFixed(4)} SOL <span className="muted">{usd(toUsd(total))}</span></b></div>
            {cfg && !cfg.launches && <div className="notice">Launches open as soon as the program is live on mainnet. Build your coin now: everything else on the site works.</div>}
            {w.address ? (
              <button className="btn primary l block" disabled={!ready || (!!flow && flow.stage !== 'error')} onClick={() => launch()}>Launch ${symbol || 'coin'} with {n} rule{n === 1 ? '' : 's'}</button>
            ) : <button className="btn primary l block" onClick={w.openPicker}>Connect a wallet</button>}
            {missing && <span className="muted small center">{missing} to continue.</span>}
            <span className="faint small">Your rules are written on chain before the coin goes live, then locked. 1% trading fee before bonding, {cfg ? cfg.creatorFeeBps / 100 : 0.3}% of it to you. No presale, no team tokens: all 1B on the curve and the pool.</span>
          </div>
        </aside>
      </div>

      {flow && <LaunchFlow flow={flow} symbol={symbol} onClose={() => setFlow(null)} onRetry={() => launch(flow.prep?.id)} onCloseList={flow.prep ? () => closeList(flow.prep!.id) : undefined} />}
    </div>
  );
}

/** one rule in the checklist: a box to tick, the rule in words, its settings once on, its code */
function RuleCheck({ id, title, plain, onChain, on, onToggle, children }: { id: RuleId; title: string; plain: string; onChain: boolean; on: boolean; onToggle: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className={`rule-check${on ? ' on' : ''}`}>
      <button type="button" className="rc-main" aria-pressed={on} onClick={() => onToggle(!on)}>
        <span className="box">{on && <I.check size={14} />}</span>
        <span className="rc-text"><b>{title}</b><span>{plain}</span></span>
      </button>
      <div className="rc-meta"><Checked onChain={onChain} /><RuleCode rule={id} /></div>
      {on && children}
    </div>
  );
}

function CopycatCheck({ vamp, loading, touched }: { vamp?: { ticker: Check; name: Check; x: Check | null; picture: Check | null }; loading: boolean; touched: boolean }) {
  const row = (label: string, c: Check | null | undefined, idle: string) => (
    <div className="cc-row">
      <span className={`cc-dot ${!c ? 'idle' : c.ok ? 'ok' : 'bad'}`}>{c ? (c.ok ? <I.check size={12} /> : <I.x size={12} />) : null}</span>
      <span className="cc-l">{label}</span>
      <span className={`cc-r ${c && !c.ok ? 'red' : 'faint'}`}>{c ? (c.ok ? 'OK' : c.reason) : idle}</span>
    </div>
  );
  return (
    <div className="copycat">
      <div className="cc-head"><b>Copycat check</b>{loading ? <Spinner size={13} /> : <span className="faint small">Against every live coin that picked No vamps</span>}</div>
      {touched ? <>
        {row('Ticker', vamp?.ticker, 'waiting')}
        {row('Name', vamp?.name, 'waiting')}
        {row('X account', vamp?.x, 'not added')}
        {row('Picture', vamp?.picture, 'not added')}
      </> : <span className="faint small">Starts checking as you type.</span>}
    </div>
  );
}

function KolList(p: {
  people: DirKol[]; picked: Set<string>; setPicked: (s: Set<string>) => void; preset: string; applyPreset: (id: string) => void;
  own: string[]; setOwn: (w: string[]) => void; wallets: number; rent: number; max: number; creator: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'kols' | 'own'>('kols');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return p.people;
    return p.people.filter((k) => k.name.toLowerCase().includes(s) || (k.handle || '').toLowerCase().includes(s) || k.wallets.some((x) => x.toLowerCase().startsWith(s)));
  }, [q, p.people]);
  const toggle = (id: string) => { const n = new Set(p.picked); n.has(id) ? n.delete(id) : n.add(id); p.setPicked(n); };
  const setAll = (v: boolean) => { const n = new Set(p.picked); shown.forEach((k) => (v ? n.add(k.id) : n.delete(k.id))); p.setPicked(n); };
  return (
    <div className="rule-extra kol-list-box">
      <div className="extra-row">
        <span className="small"><b>{p.wallets.toLocaleString()} wallet{p.wallets === 1 ? '' : 's'} on the list</b> <span className="muted">· {p.picked.size} KOLs{p.own.length ? ` + ${p.own.length} of yours` : ''} · adds {p.rent.toFixed(4)} SOL</span></span>
        <button className="btn ghost s" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Done' : 'Edit the list'}</button>
      </div>
      {p.wallets > p.max && <div className="notice red">A list holds up to {p.max} wallets. Untick a few.</div>}
      {open && <>
        <div className="seg s">
          <button className={tab === 'kols' ? 'on' : ''} onClick={() => setTab('kols')}>KOLs <span className="count">{p.picked.size}</span></button>
          <button className={tab === 'own' ? 'on' : ''} onClick={() => setTab('own')}>Your wallets <span className="count">{p.own.length}</span></button>
        </div>
        {tab === 'kols' ? <>
          <div className="extra-row">
            <label className="search"><I.search size={15} /><input placeholder="Find a KOL or wallet" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <div className="row-gap">
              <button className="btn ghost s" onClick={() => setAll(true)}>Keep all out</button>
              <button className="btn ghost s" onClick={() => setAll(false)}>Let all in</button>
            </div>
          </div>
          <div className="presets">{PRESETS.map((x) => <button key={x.id} className={p.preset === x.id ? 'on' : ''} onClick={() => p.applyPreset(x.id)}>{x.label}</button>)}</div>
          <p className="faint small">{p.people.length} KOLs from kolscan, pump.fun's KOL tracker, most followed on X first (the list comes from NoKol). Ticked KOLs can't buy until it bonds. Untick anyone you want to let in.</p>
          <div className="kol-rows">
            {shown.map((k) => {
              const sel = p.picked.has(k.id);
              const self = !!p.creator && k.wallets.includes(p.creator);
              return (
                <button type="button" key={k.id} className={`kol-row${sel ? '' : ' off'}`} onClick={() => toggle(k.id)} aria-pressed={sel}>
                  <span className="box">{sel && <I.check size={12} />}</span>
                  <Avatar src={k.pfp} name={k.name} size={34} />
                  <span className="who"><b>{k.name}{k.verified && <Verified />}</b><span className="who-meta">{k.handle && <span>@{k.handle}</span>}{k.followers ? <Fol n={k.followers} /> : <span>followers unknown</span>}{k.wallets.length > 1 && <span>{k.wallets.length} wallets</span>}{self && <span>that's you</span>}</span></span>
                  <span className={`state ${sel ? 'out' : 'in'}`}>{sel ? 'Kept out' : 'Let in'}</span>
                </button>
              );
            })}
            {!shown.length && <p className="faint small pad">No KOL matches “{q}”. Add any wallet under Your wallets.</p>}
          </div>
        </> : <OwnList own={p.own} setOwn={p.setOwn} people={p.people} />}
        <span className="faint small">Most of the {p.rent.toFixed(4)} SOL is storage for the list. When your coin bonds, it buys your coin back and burns it. {followers(p.people.reduce((s, k) => s + (p.picked.has(k.id) ? k.followers : 0), 0))} followers kept out.</span>
      </>}
    </div>
  );
}

function OwnList({ own, setOwn, people }: { own: string[]; setOwn: (w: string[]) => void; people: DirKol[] }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const known = useMemo(() => new Map(people.flatMap((k) => k.wallets.map((x) => [x, k] as const))), [people]);
  const add = () => {
    const found = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    const good = found.filter(isAddress);
    const fresh = good.filter((x) => !own.includes(x));
    setOwn([...own, ...fresh]);
    setNote(`${fresh.length} added${good.length - fresh.length ? `, ${good.length - fresh.length} already on the list` : ''}${found.length - good.length ? `, ${found.length - good.length} weren't wallets` : ''}.`);
    setText('');
  };
  return (
    <>
      <textarea className="input" placeholder="Paste wallets: one a line, or separated by commas or spaces" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="extra-row">
        <span className="muted small">{note || 'Snipers, side wallets, whoever. Each wallet adds about 0.0002 SOL of storage.'}</span>
        <div className="row-gap">
          {own.length > 0 && <button className="btn quiet s" onClick={() => { setOwn([]); setNote(''); }}>Clear</button>}
          <button className="btn primary s" disabled={!text.trim()} onClick={add}>Add wallets</button>
        </div>
      </div>
      <div className="kol-rows">
        {own.map((x) => {
          const k = known.get(x);
          return (
            <div className="own-row" key={x}>
              {k ? <Avatar src={k.pfp} name={k.name} size={26} /> : <Avatar name="?" seed={x} size={26} />}
              <span className="mono">{x}</span>
              {k && <span className="chip">{k.name}</span>}
              <button className="icon-btn" onClick={() => setOwn(own.filter((y) => y !== x))} aria-label="Remove"><I.x size={15} /></button>
            </div>
          );
        })}
        {!own.length && <p className="faint small pad">No wallets of your own yet. They join the KOLs you ticked.</p>}
      </div>
    </>
  );
}

function LaunchFlow({ flow, symbol, onClose, onRetry, onCloseList }: { flow: any; symbol: string; onClose: () => void; onRetry: () => void; onCloseList?: () => void }) {
  const lists = flow.prep ? flow.prep.txs.filter((t: any) => t.kind === 'list').length : flow.of || 0;
  const passTx = !!flow.prep?.txs.some((t: any) => t.kind === 'pass');
  const order = ['build', 'sign', 'list', 'pass', 'launch', 'live'];
  const at = order.indexOf(flow.stage === 'error' ? 'build' : flow.stage);
  const step = (id: string, label: string, sub?: string) => {
    const i = order.indexOf(id);
    const cls = flow.stage === 'live' || i < at ? 'done' : i === at ? 'now' : '';
    return (
      <div className={`seq-step ${cls}`} key={id}>
        <span className="dot">{cls === 'done' ? <I.check size={15} /> : cls === 'now' ? <Spinner size={14} /> : null}</span>
        <span>{label}</span>{sub && <span className="sub">{sub}</span>}
      </div>
    );
  };
  if (flow.stage === 'live') return (
    <Modal onClose={onClose}>
      <div className="center" style={{ padding: '10px 0' }}>
        <span className="live-lock"><I.lock size={26} /></span>
        <h3 style={{ marginTop: 14 }}>${symbol} is live</h3>
        <p>Its rules are locked. The program checks them on every buy.</p>
      </div>
    </Modal>
  );
  return (
    <Modal onClose={flow.stage === 'error' ? onClose : () => {}}>
      <h3>{flow.stage === 'error' ? 'The launch stopped' : `Launching $${symbol}`}</h3>
      <p>{flow.stage === 'error' ? flow.error : flow.stage === 'sign' ? `Approve ${flow.prep?.txs.length || ''} transactions in your wallet: ${lists ? `${lists} to write the list, then ` : ''}the launch.` : 'Keep this tab open. It takes a few seconds.'}</p>
      {flow.stage !== 'error' ? (
        <div className="seq">
          {step('build', 'Building the launch')}
          {step('sign', 'Approve in your wallet')}
          {lists > 0 && step('list', 'Writing the list on chain', flow.stage === 'list' ? `${flow.done || 0}/${lists}` : `${lists} parts`)}
          {passTx && step('pass', 'Minting your dev pass')}
          {step('launch', 'Launching and locking the rules')}
        </div>
      ) : (
        <div className="row-gap" style={{ marginTop: 20 }}>
          <button className="btn primary" onClick={onRetry}>Try again</button>
          {onCloseList && flow.prep && <button className="btn ghost" onClick={onCloseList}>Close the list, get the SOL back</button>}
          <Link className="btn quiet" to="/rules">How the rules work</Link>
        </div>
      )}
    </Modal>
  );
}
