// Small pieces every page uses: the mark, avatars, the progress bar, switches, copy buttons, icons, the modal.
import { useEffect, useState, type ReactNode } from 'react';
import type { RuleId } from '../lib/api';
import { followers } from '../lib/data';
import { short } from '../lib/format';

/** the mark: {s}, the braces in the accent */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="mark">
      <rect width="64" height="64" rx="15" style={{ fill: 'var(--panel)' }} />
      <text x="32" y="43" textAnchor="middle" fontFamily="'Geist Mono', ui-monospace, monospace" fontWeight="600" fontSize="34" letterSpacing="-3">
        <tspan style={{ fill: 'var(--accent)' }}>{'{'}</tspan><tspan style={{ fill: 'var(--ink)' }}>s</tspan><tspan style={{ fill: 'var(--accent)' }}>{'}'}</tspan>
      </text>
    </svg>
  );
}

/** the name beside the mark: strict.fun (the braces live in the {s} mark, so they aren't repeated here) */
export function Wordmark() {
  return (
    <span className="wm" role="img" aria-label="strict.fun">
      strict<span className="wm-d">.fun</span>
    </span>
  );
}

export const Spinner = ({ size = 18 }: { size?: number }) => <span className="spinner" style={{ ['--s' as any]: `${size}px` }} />;

/** a picture; without one, a wallet's identicon (a mirrored 5x5 pattern from its address) or plain initials */
export function Avatar({ src, name, size = 40, square, seed }: { src?: string | null; name?: string; size?: number; square?: boolean; seed?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  const ini = (name || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
  const pic = src && !bad;
  return (
    <span className={`av${square ? ' sq' : ''}`} style={{ ['--s' as any]: `${size}px` }}>
      {pic ? <img src={src!} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />
        : ini && ini !== '?' ? <span className="ini">{ini}</span> : <Identicon seed={seed || name || '?'} />}
    </span>
  );
}

function Identicon({ seed }: { seed: string }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const cells: [number, number][] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if ((h >>> (y * 3 + x)) & 1) { cells.push([x, y]); if (x < 2) cells.push([4 - x, y]); }
  return (
    <svg viewBox="-1 -1 7 7" width="100%" height="100%" aria-hidden>
      {cells.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" style={{ fill: 'var(--line-strong)' }} />)}
    </svg>
  );
}

export function AvatarStack({ people, size = 28, max = 5, more }: { people: { pfp: string | null; name: string; id?: string }[]; size?: number; max?: number; more?: number }) {
  const extra = more ?? Math.max(0, people.length - max);
  return (
    <span className="stack" style={{ ['--s' as any]: `${size}px` }}>
      {people.slice(0, max).map((p, i) => <Avatar key={p.id || i} src={p.pfp} name={p.name} size={size} />)}
      {extra > 0 && <span className="more">+{extra.toLocaleString()}</span>}
    </span>
  );
}

export const Progress = ({ pct, large }: { pct: number; large?: boolean }) => (
  <div className={`bar${large ? ' l' : ''}${pct >= 100 ? ' done' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
    <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
  </div>
);

/** an on/off switch (a real button) */
export function Switch({ on, onChange, label, text }: { on: boolean; onChange: (v: boolean) => void; label: string; text?: boolean }) {
  return (
    <button type="button" className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      {text && <span className="switch-t">{on ? 'On' : 'Off'}</span>}
      <span className="switch-track"><span className="switch-knob" /></span>
    </button>
  );
}

/** a green "checked" line, or the amber one for checks that aren't on chain */
export const Checked = ({ onChain, children }: { onChain: boolean; children?: ReactNode }) => (
  <span className={`checked${onChain ? '' : ' site'}`}>
    {onChain ? <I.check size={14} /> : <i className="dot" />}
    {children ?? (onChain ? 'Checked on every buy' : 'Checked by strict.fun at launch')}
  </span>
);

export function Copy({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copy" onClick={(e) => { e.preventDefault(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }} title="Copy">
      {label ?? short(text, 5)} {done ? <I.check size={13} /> : <I.copy size={13} />}
    </button>
  );
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal>
        <button className="icon-btn modal-x" onClick={onClose} aria-label="Close"><I.x /></button>
        {children}
      </div>
    </div>
  );
}

/** a follower count: a person and the compact number (the exact one on hover) */
export const Fol = ({ n }: { n: number }) => (
  <span className="fol" title={`${n.toLocaleString()} followers on X`}><I.user size={12} />{followers(n)}</span>
);

export const Verified = () => (
  <svg className="verified" width="15" height="15" viewBox="0 0 24 24" aria-label="verified"><path fill="currentColor" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" /></svg>
);

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Mark size={40} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

type IP = { size?: number };
const svg = (d: ReactNode, w = 2) => ({ size = 18 }: IP) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
export const I = {
  x: svg(<path d="M18 6 6 18M6 6l12 12" />),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  copy: svg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  arrow: svg(<path d="M5 12h14m-6-6 6 6-6 6" />),
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  image: svg(<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  grid: svg(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.2-5.4 6.5-5.4s5.9 2 6.5 5.4" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.9c2 .7 3.2 2.5 3.6 5.1" /></>),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></>),
  chev: svg(<path d="m6 9 6 6 6-6" />),
  user: svg(<><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.8-4 3.8-6.2 7.5-6.2s6.7 2.2 7.5 6.2" /></>),
  shield: svg(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  lock: svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>, 1.8),
  code: svg(<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />, 1.8),
  ext: svg(<><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  wallet: svg(<><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>),
  x_logo: ({ size = 16 }: IP) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2zm-1.2 18h1.9L7.4 3.9H5.4L17.7 20z" /></svg>,
  tg: ({ size = 16 }: IP) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5L20.6 2.8c.9-.3 1.6.2 1.3 1.5z" /></svg>,
  globe: svg(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
};

/** each rule's icon */
const RULE_ICONS: Record<RuleId, ReactNode> = {
  kols: <><path d="M3 10v4h3l5 4V6l-5 4H3z" /><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" /><path d="M18.5 7a7 7 0 0 1 0 10" /></>,
  snipers: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  dev: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  bundles: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 12.5l9 5 9-5" /><path d="M3 16.5l9 5 9-5" /></>,
  maxWallet: <><circle cx="12" cy="12" r="9" /><path d="M12 3v9h9" /></>,
  vamps: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
};
export function RuleIcon({ id, size = 22, box = 44, off }: { id: RuleId; size?: number; box?: number; off?: boolean }) {
  return (
    <span className={`rule-ic${off ? ' off' : ''}`} style={{ ['--b' as any]: `${box}px` }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{RULE_ICONS[id]}</svg>
    </span>
  );
}
