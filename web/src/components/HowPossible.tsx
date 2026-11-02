// "How is this possible?", answered with the program itself instead of paragraphs: the line in `create` that writes a
// coin's rules into its own account, every instruction the program has (none edits a live coin's rules), the checks
// that nobody can mint more (so every buy goes through the program), and the program as Solana reports it, read in the
// visitor's browser. The intro shows it compact; /rules#how shows the full code with links to the exact lines.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import source from '../lib/source.json';
import { useConfig } from '../lib/data';
import { short } from '../lib/format';
import { CodeBlock, CodeLine, type Block } from './RuleCode';
import { useProgram } from './Trust';
import { I } from './ui';

const store = (source as Record<string, Block[]>).howStore[0];
const ixs = (source as Record<string, Block[]>).howIx[0];
const mint = (source as Record<string, Block[]>).howMint;
/** the program's instructions, as the dispatch names them */
const NAMES = [...ixs.code.matchAll(/IX_\w+ => (\w+)\(/g)].map((m) => m[1]);
const ADMIN = new Set(['initialize', 'set_params', 'set_authority']);
/** the line of `create` that writes the rules (with its real line number) */
const ruleLine = (() => { const k = store.code.split('\n').findIndex((l) => l.includes('no_dev_buy')); return { n: store.start + k, line: store.code.split('\n')[k] }; })();

function Chips() {
  return (
    <div className="hp-ix">
      {NAMES.map((n) => <span key={n} className={`mono${ADMIN.has(n) ? ' adm' : ''}`}>{n}</span>)}
      <span className="mono no" title="There is no such instruction">edit_rules</span>
    </div>
  );
}

function Live({ compact }: { compact?: boolean }) {
  const { data: cfg } = useConfig();
  const p = useProgram();
  const s = p.data;
  if (!cfg) return null;
  const rows: [string, string, string?][] = s ? [
    ['Program', short(cfg.programId, 5)],
    ['On mainnet', s.deployed ? 'yes' : 'not yet', s.deployed ? 'g' : 'a'],
    ['Size', s.bytes ? `${Math.round(s.bytes / 1024)} KB` : '–'],
    ['Upgrades', !s.deployed ? '–' : s.upgradeable ? `${short(s.authority || '', 4)} (until frozen)` : 'frozen for good', s.upgradeable ? 'a' : 'g'],
  ] : [];
  return (
    <div className={`hp-live${compact ? ' c' : ''}`}>
      <span className="hp-live-h"><i className={p.isLoading ? 'dot' : 'dot g'} />{p.isLoading ? 'Reading Solana from your browser…' : 'Read from Solana by your browser, just now'}</span>
      {rows.length > 0 && <dl>{rows.map(([k, v, c]) => <div key={k}><dt>{k}</dt><dd className={`mono${c === 'g' ? ' green-t' : c === 'a' ? ' amber-t' : ''}`}>{v}</dd></div>)}</dl>}
    </div>
  );
}

const STEPS = [
  { t: 'The rules are written into the coin.', d: 'In the launch transaction, into an account only the program can write to.' },
  { t: 'There’s no edit button.', d: 'Every instruction the program has. None changes a live coin’s rules.' },
  { t: 'Nobody can mint more.', d: 'The whole supply sits in the coin’s vault, so every buy passes the program’s checks.' },
  { t: 'Check it yourself.', d: 'Your browser asks Solana directly, not our server.' },
];

export function HowPossible({ compact }: { compact?: boolean }) {
  const { data: cfg } = useConfig();
  const [open, setOpen] = useState(!compact);
  if (compact) return (
    <div className={`hp compact${open ? ' open' : ''}`}>
      <button type="button" className="hp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I.code size={14} />How is this possible? See the code<span className="hp-chev" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ol className="hp-proof c">
          <li><span className="hp-n mono">1</span><b>{STEPS[0].t}</b><CodeLine n={ruleLine.n} line={ruleLine.line} js={false} className="hp-cl" /></li>
          <li><span className="hp-n mono">2</span><b>{STEPS[1].t}</b><Chips /></li>
          <li><span className="hp-n mono">3</span><b>{STEPS[2].t}</b><CodeLine n={mint[0].start} line={mint[0].code} js={false} className="hp-cl" /></li>
          <li><span className="hp-n mono">4</span><b>{STEPS[3].t}</b><Live compact /></li>
        </ol>
      )}
    </div>
  );
  return (
    <section className="hp section" id="how">
      <div className="sec-head"><div>
        <h2>How is this possible?</h2>
        <p>Don’t take our word for it. Here’s the program.</p>
      </div></div>
      <ol className="hp-proof">
        <li><div className="hp-t"><span className="hp-n mono">1</span><span><b>{STEPS[0].t}</b><span>{STEPS[0].d}</span></span></div><CodeBlock block={store} sourceUrl={cfg?.sourceUrl} /></li>
        <li><div className="hp-t"><span className="hp-n mono">2</span><span><b>{STEPS[1].t}</b><span>{STEPS[1].d}</span></span></div><Chips /><p className="hp-note">The three marked admin only touch settings for coins launched later, never a live coin.</p><CodeBlock block={ixs} sourceUrl={cfg?.sourceUrl} /></li>
        <li><div className="hp-t"><span className="hp-n mono">3</span><span><b>{STEPS[2].t}</b><span>{STEPS[2].d}</span></span></div>{mint.map((b) => <CodeBlock key={b.start} block={b} sourceUrl={cfg?.sourceUrl} />)}</li>
        <li><div className="hp-t"><span className="hp-n mono">4</span><span><b>{STEPS[3].t}</b><span>{STEPS[3].d}</span></span></div><Live /><Link to="/proof" className="hp-more">Every check, on the Proof page <I.arrow size={14} /></Link></li>
      </ol>
    </section>
  );
}
