// The first visit: strict.fun in one screen (the six rules, the line of code that stops a KOL, why to trust it), and
// a confirm that you understand the coins are risky. Confirming lets you into the app; it's remembered, and the
// sidebar's "What is strict.fun?" opens it again.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/data';
import { rulesFor } from '../lib/rules';
import { ruleLine } from './Engine';
import { HowPossible } from './HowPossible';
import { CodeLine } from './RuleCode';
import { I, Mark, RuleIcon } from './ui';

const KEY = 'strict:intro:v1';
export const introSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

export function Intro({ onClose }: { onClose: () => void }) {
  const { data: cfg } = useConfig();
  const [ok, setOk] = useState(introSeen());
  const rules = rulesFor(cfg);
  const kol = ruleLine('kols');
  const enter = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && introSeen()) onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-h">
      <div className="intro-card">
        <div className="intro-top">
          <span className="intro-brand"><Mark size={34} /><span className="eyebrow">Welcome to strict.fun</span></span>
          {introSeen() && <button className="icon-btn" onClick={onClose} aria-label="Close"><I.x size={18} /></button>}
        </div>
        <h2 id="intro-h">Launch a coin with rules.<br /><span className="h1-sub">The code enforces them.</span></h2>
        <p className="intro-lede">Creators pick the rules at launch. They're written on chain, locked by the launch itself, and checked by the program on every buy until the coin bonds.</p>
        <HowPossible compact />
        <div className="intro-grid">
          <ul className="intro-rules">
            {rules.map((r) => (
              <li key={r.id}>
                <RuleIcon id={r.id} box={34} size={17} />
                <span><b>{r.id === 'maxWallet' ? 'Max wallet' : r.title}</b><span>{r.short}</span></span>
                {!r.onChain && <span className="pill-s off" title="Checked by strict.fun at launch, not on chain">site</span>}
              </li>
            ))}
          </ul>
          <div className="intro-side">
            {kol && (
              <figure className="intro-code">
                <figcaption className="mono">lib.rs · the line that stops a KOL</figcaption>
                <CodeLine n={kol.n} line={kol.code} js={false} />
              </figure>
            )}
            <ul className="intro-trust">
              <li><I.check size={14} />Open-source program</li>
              <li><I.check size={14} />{cfg?.testCount ?? 77} program tests, all passing</li>
              <li><I.check size={14} />Every coin re-checkable in your browser</li>
              <li><I.check size={14} />Bonds into a Raydium pool, LP burned</li>
              <li className="amber-t"><i className="dot" />Audit: coming, report published in full</li>
            </ul>
          </div>
        </div>
        <label className="intro-ack">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>I understand coins launched here are made by their creators, are highly risky and can lose all their value. Rules limit who can buy and how; they don't make a coin a good investment.</span>
        </label>
        <div className="intro-actions">
          <button className="btn primary l" disabled={!ok} onClick={enter}>Enter strict.fun <I.arrow size={16} /></button>
          <Link to="/rules" className="btn ghost l" onClick={() => { if (ok) enter(); }}>How it works</Link>
        </div>
      </div>
    </div>
  );
}
