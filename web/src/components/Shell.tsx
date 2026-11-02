// The frame around every page, as an app: a sidebar (the places you go, what strict.fun is, the program on Solana), a
// top bar (search, launch, the wallet), the first-visit intro, and the footer. On a phone the sidebar is a drawer.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useConfig, useKols } from '../lib/data';
import { short } from '../lib/format';
import { useWallet } from '../lib/wallet';
import { Intro, introSeen } from './Intro';
import { useProgram } from './Trust';
import { Avatar, Fol, I, Mark, Modal, Spinner, Wordmark } from './ui';
import { TokenCA } from './TokenCA';

const LINKS = [
  { to: '/', label: 'Board', end: true, icon: I.grid },
  { to: '/launch', label: 'Launch a coin', icon: I.plus },
  { to: '/rules', label: 'The rules', icon: I.code },
  { to: '/proof', label: 'Proof', icon: I.shield },
  { to: '/kols', label: 'KOL list', icon: I.users },
  { to: '/check', label: 'Am I on a list?', icon: I.search },
];

export function Shell({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(false);
  const [menu, setMenu] = useState(false);
  const [intro, setIntro] = useState(() => !introSeen());
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    setMenu(false);
    if (!loc.hash) { window.scrollTo({ top: 0 }); return; }
    // /rules#how and the like: pages load lazily, so wait (up to 3 s) for the section, then scroll to it
    let n = 0;
    const t = setInterval(() => {
      const el = document.getElementById(decodeURIComponent(loc.hash.slice(1)));
      if (el) el.scrollIntoView({ block: 'start' });
      if (el || ++n > 30) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [loc.pathname, loc.hash]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="app">
      <aside className={`side${menu ? ' open' : ''}`} aria-label="Main">
        <Link to="/" className="brand side-brand" aria-label="strict.fun home"><Mark size={30} /><Wordmark /></Link>
        <nav className="side-nav">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'on' : '')}><l.icon size={17} /><span>{l.label}</span></NavLink>)}
        </nav>
        <div className="side-foot">
          <button className="side-intro" onClick={() => { setMenu(false); setIntro(true); }}><I.info size={16} /><span>What is strict.fun?</span></button>
          <NetStatus />
        </div>
      </aside>
      {menu && <div className="side-scrim" onClick={() => setMenu(false)} aria-hidden />}
      <div className="app-main">
        <header className="top">
          <button className="icon-btn top-menu" onClick={() => setMenu(true)} aria-label="Menu" aria-expanded={menu}><I.menu size={18} /></button>
          <Link to="/" className="top-mark" aria-label="strict.fun home"><Mark size={28} /></Link>
          <button className="top-search" onClick={() => setSearch(true)}><I.search size={15} /><span>Search coins, KOLs or a wallet</span><kbd>⌘K</kbd></button>
          <div className="top-right">
            <TokenCA />
            <Link to="/launch" className="btn primary s top-launch"><I.plus size={15} /><span className="hide-s">Launch</span></Link>
            <WalletButton />
          </div>
        </header>
        <main key={loc.pathname} className="page-in">{children}</main>
        <Footer />
      </div>
      <WalletPicker />
      {search && <Search onClose={() => setSearch(false)} />}
      {intro && <Intro onClose={() => setIntro(false)} />}
    </div>
  );
}

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  if (!w.address) return <button className="btn ghost s" onClick={w.openPicker}><I.wallet size={16} /><span className="hide-s">Connect wallet</span></button>;
  return (
    <div className="wallet-menu">
      <button className="btn ghost s" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {w.wallet?.icon && <img src={w.wallet.icon} alt="" width={18} height={18} style={{ borderRadius: 5 }} />}
        <span className="mono">{short(w.address, 4)}</span>
      </button>
      {open && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <Link className="menu-opt" to={`/check?w=${w.address}`} onClick={() => setOpen(false)}>Am I on a list?</Link>
          <Link className="menu-opt" to={`/?creator=${w.address}`} onClick={() => setOpen(false)}>My coins</Link>
          <button className="menu-opt" onClick={() => { navigator.clipboard?.writeText(w.address!); setOpen(false); }}>Copy address</button>
          <button className="menu-opt red" onClick={() => { w.disconnect(); setOpen(false); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

function WalletPicker() {
  const w = useWallet();
  const [err, setErr] = useState('');
  if (!w.pickerOpen) return null;
  return (
    <Modal onClose={w.closePicker}>
      <h3>Connect a wallet</h3>
      <p>Any Solana wallet works. Nothing is signed until you launch or trade.</p>
      <div className="wallet-list">
        {w.wallets.length ? w.wallets.map((x) => (
          <button key={x.name} className="wallet-opt" disabled={w.connecting} onClick={() => { setErr(''); w.connect(x).catch((e) => setErr(e?.message || 'That wallet did not connect.')); }}>
            <img src={x.icon} alt="" /><b>{x.name}</b>{w.connecting ? <Spinner /> : <I.arrow size={16} />}
          </button>
        )) : (
          <div className="notice">No Solana wallet found in this browser. Install <a href="https://phantom.app" target="_blank" rel="noreferrer"><b>Phantom</b></a>, <a href="https://solflare.com" target="_blank" rel="noreferrer"><b>Solflare</b></a> or <a href="https://backpack.app" target="_blank" rel="noreferrer"><b>Backpack</b></a>, then come back.</div>
        )}
      </div>
      {err && <p className="err-text" style={{ marginTop: 12 }}>{err}</p>}
    </Modal>
  );
}

function Search({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const { data: kols } = useKols();
  const { data: coins } = useQuery({ queryKey: ['search', q], queryFn: () => api.coins({ q, limit: 8 }), enabled: q.trim().length > 0 });
  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return (kols?.kols || []).slice(0, 6);
    return (kols?.kols || []).filter((k) => k.name.toLowerCase().includes(s) || (k.handle || '').toLowerCase().includes(s) || k.wallets.some((x) => x.toLowerCase().startsWith(s))).slice(0, 8);
  }, [q, kols]);
  const go = (to: string) => { onClose(); nav(to); };
  return (
    <Modal onClose={onClose} wide>
      <label className="search big" style={{ marginTop: 8 }}>
        <I.search size={16} />
        <input autoFocus placeholder="A coin, a ticker, a KOL, a wallet…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim())) go(`/check?w=${q.trim()}`); }} />
      </label>
      {!!coins?.length && <div className="label" style={{ marginTop: 20 }}>Coins</div>}
      <div className="wallet-list" style={{ marginTop: 8 }}>
        {coins?.map((c) => (
          <button key={c.mint} className="wallet-opt" onClick={() => go(`/coin/${c.mint}`)}>
            <Avatar src={c.image} name={c.symbol} size={36} square /><b>{c.name} <span className="muted">${c.symbol}</span></b>
            <span className="chip">{c.ruleCount ?? 0} rules</span>
          </button>
        ))}
      </div>
      <div className="label" style={{ marginTop: 20 }}>KOLs</div>
      <div className="wallet-list" style={{ marginTop: 8 }}>
        {people.map((k) => (
          <button key={k.id} className="wallet-opt" onClick={() => go(`/kol/${k.id}`)}>
            <Avatar src={k.pfp} name={k.name} size={36} /><b>{k.name} <span className="muted">{k.handle ? `@${k.handle}` : ''}</span></b>
            <span style={{ fontSize: 13 }}><Fol n={k.followers} /></span>
          </button>
        ))}
        {!people.length && !coins?.length && <p>Nothing matches. Paste a wallet and press enter to check it.</p>}
      </div>
    </Modal>
  );
}

/** the program on Solana, at a glance: deployed, and whether it can still be upgraded (read from chain) */
function NetStatus() {
  const { data: c } = useConfig();
  const p = useProgram();
  const s = p.data;
  const tone = !s ? 'idle' : !s.deployed ? 'amber' : s.upgradeable ? 'blue' : 'green';
  const text = !s ? 'Solana' : !s.deployed ? 'Not deployed' : s.upgradeable ? 'Live · upgradeable' : 'Live · frozen';
  return (
    <Link to="/proof" className={`net ${tone}`} title={c ? `Program ${c.programId}` : undefined}>
      <i className="dot" /><span>{text}</span>{c && <span className="mono faint">{short(c.programId, 4)}</span>}
    </Link>
  );
}

function Footer() {
  const { data: c } = useConfig();
  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div className="foot-brand">
          <Link to="/" className="brand" aria-label="strict.fun"><Mark size={24} /><Wordmark /></Link>
          <p className="muted">Pick the rules. The code enforces them. A Solana launchpad where every coin's rules are written on chain and checked on every buy.</p>
          <p className="foot-slogan">Strict can be fun.</p>
          {c && <a className="foot-prog mono" href={`https://solscan.io/account/${c.programId}`} target="_blank" rel="noreferrer"><i className="dot" />{c.programId}</a>}
        </div>
        <nav className="foot-col" aria-label="Product"><b>Product</b><Link to="/launch">Launch a coin</Link><Link to="/">Board</Link><Link to="/rules">The rules</Link><Link to="/kols">KOL list</Link></nav>
        <nav className="foot-col" aria-label="Verify"><b>Verify</b><Link to="/proof">Proof</Link><Link to="/#code">Read the code</Link><Link to="/check">Am I on a list?</Link>{c?.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</nav>
        <nav className="foot-col" aria-label="Follow"><b>Follow</b>{c && <a href={`https://x.com/${c.xHandle}`} target="_blank" rel="noreferrer">X @{c.xHandle}</a>}<Link to="/rules">How it works</Link></nav>
      </div>
      <div className="wrap foot-legal">
        <span>strict.fun is open-source software, not a broker, exchange or adviser. Coins launched here are created by their creators, are highly risky and can lose all of their value. The rules limit who can buy and how; they don't make a coin a good investment. The KOL list comes from NoKol.</span>
      </div>
    </footer>
  );
}
