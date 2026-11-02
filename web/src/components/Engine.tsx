// The engine, shown: the program's buy checks as an editor with a console walking example buys through them, the
// live numbers, the order every buy is checked in, and a tabbed read of each rule's source. Every line of code here
// comes from source.json, cut from the program by scripts/source-snippets.mjs, line numbers and all.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type RuleId } from '../lib/api';
import { useConfig } from '../lib/data';
import { ago, short } from '../lib/format';
import { rulesFor } from '../lib/rules';
import source from '../lib/source.json';
import { CodeBlock, CodeLine, type Block, type CodeKey } from './RuleCode';
import { useProgram } from './Trust';
import { Avatar, I, RuleIcon } from './ui';

const S = source as Record<CodeKey, Block[]>;

// ---------------------------------------------------------------- the hero editor

type Gate = 'dev' | 'bundles' | 'kols' | 'snipers' | 'maxWallet';
/** the checks in the order fn buy runs them */
const GATES: { id: Gate; block: Block }[] = [
  { id: 'dev', block: S.dev[0] },
  { id: 'bundles', block: S.bundles[0] },
  { id: 'kols', block: S.kols[0] },
  { id: 'snipers', block: S.snipers[0] },
  { id: 'maxWallet', block: S.maxWallet[0] },
];
/** example buys, each answered by one check (or by none: it fills) */
const SCENES: { who: string; what: string; gate: Gate | null; code: string; result: string; tone: 'stop' | 'fee' | 'ok' }[] = [
  { who: '9fRt…Kd2w', what: 'buy 3.00 SOL', gate: 'kols', code: '6000 Bounced', result: 'on the KOL list', tone: 'stop' },
  { who: '7xKq…3fPa', what: 'buy 0.50 SOL · creator', gate: 'dev', code: '6018 DevBuy', result: "creator can't buy before it bonds", tone: 'stop' },
  { who: 'Cz3v…9aTe', what: 'buy 1.00 SOL · launch slot', gate: 'bundles', code: '6023 Bundled', result: 'nothing buys in the launch block', tone: 'stop' },
  { who: 'Bq8s…x1Lm', what: 'buy 0.80 SOL · second 1', gate: 'snipers', code: 'fee 98%', result: 'the sniper fee, paid to the buyback', tone: 'fee' },
  { who: '4hNb…pQ7e', what: 'buy 2.40 SOL · 2.7% of supply', gate: 'maxWallet', code: '6024 OverCap', result: 'past the 2% max wallet', tone: 'stop' },
  { who: 'Gv3x…Q2mn', what: 'buy 0.25 SOL', gate: null, code: 'ok', result: 'every check passed · filled', tone: 'ok' },
];

function useTick(ms: number, n: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [ms, n]);
  return i;
}

function Lines({ block, active, passed, dim }: { block: Block; active?: boolean; passed?: boolean; dim?: boolean }) {
  return (
    <div className={`eg-block${active ? ' hot' : ''}${passed ? ' passed' : ''}${dim ? ' dim' : ''}`}>
      {block.code.split('\n').map((l, i) => <CodeLine key={i} n={block.start + i} line={l} js={false} />)}
    </div>
  );
}

/** fn buy's checks, with example buys walked through them (compact: the board's rail) */
export function Engine({ compact }: { compact?: boolean }) {
  const { data: cfg } = useConfig();
  const i = useTick(2600, SCENES.length);
  const scene = SCENES[i];
  const at = scene.gate ? GATES.findIndex((g) => g.id === scene.gate) : GATES.length;
  return (
    <div className={`engine${compact ? ' compact' : ''}`} aria-label="The program's buy checks, with example buys">
      <div className="eg-bar">
        <span className="eg-tabs"><span className="eg-tab on"><i className="rs" />lib.rs</span>{!compact && <span className="eg-tab">vamp.js</span>}</span>
        <span className="eg-path mono">programs/strict/src/lib.rs · fn buy</span>
        <span className="eg-badge"><I.check size={12} />open source</span>
      </div>
      <div className="eg-body">
        <pre className="eg-code"><code>
          <Lines block={S.head[0]} dim />
          {GATES.map((g, k) => {
            const prev = k ? GATES[k - 1].block : S.head[0];
            const gap = g.block.start > prev.start + prev.code.split('\n').length;
            return (
              <div key={g.id}>
                {gap && <span className="cl gap"><i aria-hidden>⋮</i><span className="cl-t">{'\n'}</span></span>}
                <Lines block={g.block} active={k === at} passed={k < at} />
              </div>
            );
          })}
          <CodeLine n="…" line="    // every check passed: the buy fills" js={false} className="dim" />
        </code></pre>
        <div className="eg-console" aria-live="polite">
          <div className="eg-c-head"><span>Example buys</span><span className="faint">{compact ? 'walked through the checks' : 'each one meets the checks in order'}</span></div>
          <ol className="eg-runs">
            {SCENES.map((s, k) => (
              <li key={k} className={`eg-run ${s.tone}${k === i ? ' now' : k < i ? ' done' : ''}`}>
                <span className="eg-who mono">{s.who}</span>
                <span className="eg-what">{s.what}</span>
                <span className={`eg-code-r mono ${s.tone}`}>{s.tone === 'stop' ? '✕ ' : s.tone === 'ok' ? '✓ ' : ''}{s.code}</span>
                <span className="eg-why">{s.result}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="eg-foot mono">
        <span><i className="dot" />program {cfg ? short(cfg.programId, 5) : '…'}</span>
        <span>6 rules · 5 checked on every buy</span>
        <span className="hide-s">{cfg?.testCount ?? 77} program tests passing</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the numbers

const STOP_TEXT: Record<string, string> = { kols: 'On the KOL list', dev: "Creator can't buy", bundles: 'Launch block', maxWallet: 'Over max wallet' };

export function Numbers() {
  const { data: cfg } = useConfig();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 20_000 });
  const feed = useQuery({ queryKey: ['feed'], queryFn: api.feed, refetchInterval: 8_000 });
  const prog = useProgram();
  const s = stats.data;
  const stops = (feed.data || []).filter((e) => (e.kind === 'bounce' || e.kind === 'stop') && e.rule).slice(0, 3);
  const n = (v: number | undefined | null, d = 0) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
  return (
    <section className="wrap numbers" aria-label="strict.fun in numbers">
      <div className="nums">
        <div className="num"><span className="nl">Buys stopped by a rule</span><b className="mono red">{n(s?.stopped ?? s?.tries)}</b><span className="ns">refused on chain or here</span></div>
        <div className="num"><span className="nl">Strict coins</span><b className="mono">{n(s?.coins)}</b><span className="ns">{n(s?.bonded)} bonded</span></div>
        <div className="num"><span className="nl">Rules a coin, on average</span><b className="mono">{n(s?.avgRules, 1)}</b><span className="ns">of 6</span></div>
        <div className="num"><span className="nl">Program</span><b className="mono">{cfg?.testCount ?? 77}<em>/{cfg?.testCount ?? 77}</em></b><span className="ns">tests passing · {prog.data?.deployed ? (prog.data.upgradeable ? 'upgradeable until frozen' : 'frozen') : 'not deployed yet'}</span></div>
      </div>
      <div className="num-feed">
        <div className="nf-head"><span className="aw-live"><i />live</span><b>Latest stops</b><Link to="/proof" className="faint">How we prove it →</Link></div>
        {stops.length ? stops.map((e, k) => (
          <Link key={k} to={`/coin/${e.coin.mint}`} className="nf-row">
            <Avatar src={e.coin.image} name={e.coin.symbol} size={26} square seed={e.coin.mint} />
            <b>${e.coin.symbol}</b>
            <span className="mono faint">{e.kol ? e.kol.name : short(e.wallet)}</span>
            <span className="pill-s stop">{STOP_TEXT[e.rule!] || 'Stopped'}</span>
            <span className="faint nf-t">{ago(e.ts)}</span>
          </Link>
        )) : <p className="faint small nf-empty">{feed.isLoading ? 'Loading…' : 'No buys stopped yet. The first one shows up here the second it happens.'}</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- the order of the checks

const STEPS: { id: RuleId | 'in' | 'out'; name: string; code: string; note: string }[] = [
  { id: 'in', name: 'A buy arrives', code: 'fn buy', note: 'from any app, bot or terminal' },
  { id: 'dev', name: 'No dev buy', code: '6018 DevBuy', note: 'is it the creator?' },
  { id: 'bundles', name: 'No bundles', code: '6023 Bundled', note: 'is it the launch slot?' },
  { id: 'kols', name: 'No KOLs', code: '6000 Bounced', note: 'is it on the list?' },
  { id: 'snipers', name: 'No snipers', code: 'fee 99% → 1%', note: 'how early is it?' },
  { id: 'maxWallet', name: 'Max wallet', code: '6024 OverCap', note: 'would it pass the cap?' },
  { id: 'out', name: 'Filled', code: 'TradeEvent', note: 'at ~85 SOL it bonds into Raydium' },
];

export function Pipeline() {
  return (
    <section className="section" id="how">
      <div className="sec-head"><div><span className="eyebrow">How a buy is checked</span><h2>Every buy runs the same checks, in order.</h2><p>Inside the program, before a single token moves. A check that fails reverts the whole transaction, so there's nothing to front-run and nothing to undo.</p></div></div>
      <ol className="pipe">
        {STEPS.map((s) => (
          <li key={s.id} className={`pipe-step ${s.id}`}>
            <span className="pipe-ic">{s.id === 'in' ? <I.wallet size={18} /> : s.id === 'out' ? <I.check size={18} /> : <RuleIcon id={s.id} box={0} size={18} />}</span>
            <b>{s.name}</b>
            <code>{s.code}</code>
            <span className="pipe-n">{s.note}</span>
          </li>
        ))}
      </ol>
      <p className="footnote">When the curve fills (about 85 SOL) the coin bonds into a <b>Raydium</b> CPMM pool with every LP token burned, and the rules are done. No vamps is checked by strict.fun when a coin is created, not by the program: it compares the new coin with every live coin that picked it.</p>
    </section>
  );
}

// ---------------------------------------------------------------- read the code

const TABS: { id: CodeKey; label: string; err: string }[] = [
  { id: 'kols', label: 'No KOLs', err: 'E::Bounced · 6000' },
  { id: 'snipers', label: 'No snipers', err: 'fee, not an error' },
  { id: 'dev', label: 'No dev buy', err: 'E::DevBuy · 6018' },
  { id: 'bundles', label: 'No bundles', err: 'E::Bundled · 6023' },
  { id: 'maxWallet', label: 'Max wallet', err: 'E::OverCap · 6024' },
  { id: 'vamps', label: 'No vamps', err: 'site check · 409' },
  { id: 'lock', label: 'The lock', err: 'E::Sealed · 6005' },
];

export function CodeTour() {
  const { data: cfg } = useConfig();
  const [tab, setTab] = useState<CodeKey>('kols');
  const rules = useMemo(() => rulesFor(cfg), [cfg]);
  const t = TABS.find((x) => x.id === tab)!;
  const r = rules.find((x) => x.id === tab);
  const blocks = S[tab];
  const lines = blocks.reduce((n, b) => n + b.code.split('\n').length, 0);
  let body: ReactNode;
  if (tab === 'lock') body = <><h3>The lock</h3><p>The launch seals the coin's list and writes its rules into the coin's own account. No instruction writes to a sealed list, and no instruction changes a coin's rules: not the creator's, not ours.</p></>;
  else body = <><h3>{r?.title}</h3><p>{r?.plain}</p><p className="muted">{r?.how}</p></>;
  return (
    <section className="section" id="code">
      <div className="sec-head"><div><span className="eyebrow">Read the code</span><h2>The rules are a few dozen lines of Rust.</h2><p>Every rule below is the exact source that's built and deployed, with its real line numbers. Nothing here is a summary of the code: it is the code.</p></div></div>
      <div className="tour">
        <div className="seg tour-tabs" role="tablist" aria-label="Rule">
          {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>{x.label}</button>)}
        </div>
        <div className="tour-in">
          <div className="tour-code">{blocks.map((b, k) => <CodeBlock key={`${tab}${k}`} block={b} sourceUrl={cfg?.sourceUrl} />)}</div>
          <aside className="tour-side">
            {body}
            <dl className="tour-facts">
              <div><dt>Answers with</dt><dd className="mono">{t.err}</dd></div>
              <div><dt>Checked</dt><dd>{tab === 'vamps' ? <span className="amber-t">by strict.fun, at launch</span> : tab === 'lock' ? 'once, at launch' : <span className="green-t">on chain, on every buy</span>}</dd></div>
              <div><dt>Lines</dt><dd className="mono">{lines}</dd></div>
              <div><dt>File</dt><dd className="mono">{blocks[0].file.split('/').pop()}</dd></div>
            </dl>
            <Link to="/proof" className="btn ghost s">Watch it stop a buy →</Link>
          </aside>
        </div>
      </div>
    </section>
  );
}

/**
 * A rule's enforcing line, for the rule cards: the line that refuses (it names the error, or for no vamps marks the
 * copy), else the first line of code under the rule.
 */
export function ruleLine(id: CodeKey): { n: number; code: string; js: boolean } | null {
  const blocks = S[id];
  if (!blocks?.length) return null;
  const all = blocks.flatMap((b) => b.code.split('\n').map((l, k) => ({ n: b.start + k, code: l.trim(), js: b.file.endsWith('.js') })));
  const code = all.filter((l) => l.code && !/^(\/\/|\/\*|\*)/.test(l.code));
  return code.find((l) => /E::(?!Zero|Math)\w+|out\.ticker = \{ ok: false/.test(l.code)) || code[0] || null;
}
