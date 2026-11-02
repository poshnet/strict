// Proof: the things you can check yourself, read from Solana while you look. The program as deployed, a listed buy run
// live against it, the code behind every rule, what the program can and can't do, and a coin's list re-hashed here.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CodeBlock } from '../components/RuleCode';
import { Avatar, Copy, I, Spinner } from '../components/ui';
import source from '../lib/source.json';
import { api, ApiError, type SimRun, type Simulation } from '../lib/api';
import { useConfig } from '../lib/data';
import { short } from '../lib/format';
import { programStatus, verifyList, type Verdict } from '../lib/verify';


const CAN = [
  ['open_list', 'An empty list for a mint that doesn’t exist yet. The mint’s key must sign.'],
  ['add_to_list', 'Up to 28 wallets, in ascending order, after the last one. Only before sealing.'],
  ['close_list', 'Refunds an unsealed list whose coin never launched.'],
  ['create', 'Checks the new mint (fixed supply, all on the curve, no mint or freeze authority) and seals the list.'],
  ['create', 'Writes the coin\u2019s rules into its account: the sniper fee, no dev buy, no bundles, the max wallet. Nothing changes them after.'],
  ['buy', 'Checks the coin\u2019s rules until the curve completes: refuses listed wallets, the creator on a no-dev-buy coin, any buy in the launch block on a no-bundles coin, and any buy past the max wallet.'],
  ['sell', 'Open to everyone.'],
  ['claim', 'Pays the creator their fees. Only ever to the creator.'],
  ['migrate', 'Completed curve to a Raydium pool, every LP token burned. Anyone can send it.'],
  ['buyback', 'The list’s rent and the sniper fee’s take buy the coin back and burn it. Once.'],
  ['initialize / set_params', 'Admin: fees and curve shape for coins launched later. Nothing else.'],
];
const CANT = ['Remove a wallet from a sealed list', 'Add a wallet to a sealed list', 'Unseal a list', 'Turn off or change a launched coin’s rules', 'Change a launched coin’s fees or curve', 'Move a coin’s SOL or tokens outside the curve, its pool or its buyback', 'Mint more tokens'];
const TESTS = [
  'only the deployer key can set the program up', 'list transactions fit in a transaction', 'the list is sealed at launch', 'stored in ascending byte order',
  'the curve records the count and the hash of the list', 'nothing can be added once sealed', 'a sealed list cannot be closed', 'a wallet below the last one is refused',
  'a repeat is refused', 'an unused list closes and refunds its rent', 'a listed wallet cannot buy', 'a buy gets exactly the quoted tokens',
  'the platform fee goes to the fee wallet', 'a sell pays the quoted SOL', 'slippage is enforced', 'anyone can pay the creator what they’re owed',
  'the buy that empties the curve pays only for what’s left', 'the curve takes no more trades once complete', 'migrated into a Raydium CPMM pool',
  'every LP token is burned', 'the pool opens within 2% of the curve’s last price', 'the list’s rent buys back and burns the coin', 'the buyback runs once',
  'the listed wallet can buy on the pool after it bonds', 'a buy in the first seconds pays the sniper fee', 'the sniper fee’s take waits for the buyback',
  'after the sniper window the fee is back to 1%', 'a sniper window is 5-30 s (fast) or 10-300 s (linear)', 'the creator’s first buy skips the sniper fee',
  'a no-dev-buy creator can’t buy', 'anyone else can', 'a buy in the launch transaction is refused (no bundles)', 'so is the creator’s own buy in the launch transaction',
  'from the next block anyone can buy', 'a max wallet is 0.5-10% of the supply', 'a buy under the cap goes through', 'a buy past the cap is refused',
  'another wallet can still buy', 'selling is never capped', 'only the admin changes settings', 'pausing stops new coins',
];
const CODE: { key: keyof typeof source; title: string }[] = [
  { key: 'kols', title: 'No KOLs: the list check, in buy, and the binary search it runs' },
  { key: 'snipers', title: 'No snipers: the fee a buy pays right now' },
  { key: 'dev', title: 'No dev buy' },
  { key: 'bundles', title: 'No bundles' },
  { key: 'maxWallet', title: 'Max wallet' },
  { key: 'lock', title: 'The lock: create seals the list; nothing writes to a sealed one' },
  { key: 'vamps', title: 'No vamps (the site, not the program): the lookalike key and the check' },
];

export default function Proof() {
  const { data: cfg } = useConfig();
  const status = useQuery({ queryKey: ['program', cfg?.programId], queryFn: () => programStatus(cfg!.programId, cfg!.publicRpc), enabled: !!cfg, staleTime: 60_000 });
  const coins = useQuery({ queryKey: ['coins', 'proof'], queryFn: () => api.coins({ sort: 'strictest', limit: 30 }) });
  const live = useMemo(() => (coins.data || []).filter((c) => c.status === 'live' && c.blocked > 0), [coins.data]);
  const s = status.data;

  return (
    <div className="wrap page">
      <header className="page-head">
        <div>
          <h1>Proof</h1>
          <p>Don't take our word for it. Everything on this page is read from Solana while you look at it, or run against it.</p>
        </div>
      </header>

      <section className="proof-sec">
        <h2 className="h2">The program</h2>
        <div className="card spec">
          <div><span>Address</span>{cfg ? <span className="spec-v"><Copy text={cfg.programId} label={cfg.programId} /></span> : '—'}</div>
          <div><span>Status</span>{status.isLoading ? <Spinner size={14} /> : s?.deployed ? <b className="green">Deployed on mainnet</b> : <b className="dim">Not deployed yet</b>}</div>
          <div><span>Code</span><b className="mono">{s?.bytes ? `${(s.bytes / 1024).toFixed(0)} KB, plain Rust (solana-program 1.18), no framework` : '—'}</b></div>
          <div><span>Upgradeable</span>{s?.deployed ? (s.upgradeable ? <b className="mono">Yes, by {short(s.authority, 6)} (to be made final after launch)</b> : <b className="green">No. Immutable</b>) : <b className="dim">—</b>}</div>
          <div><span>Last deployed</span><b className="mono">{s?.slot ? `slot ${s.slot.toLocaleString()}` : '—'}</b></div>
          <div><span>Read from</span><span className="dim">a public Solana RPC, from your browser{cfg && <> · <a href={`https://solscan.io/account/${cfg.programId}`} target="_blank" rel="noreferrer">Solscan <I.ext size={12} /></a></>}</span></div>
        </div>
      </section>

      <section className="proof-sec">
        <h2 className="h2">Watch a listed buy get stopped</h2>
        <p className="sec-p">The same 0.01 SOL buy of a live coin, simulated on Solana twice: once from a KOL wallet on the coin's list, once from a wallet that isn't. A simulation runs the real program on real state without sending anything, so these are the program's own logs.</p>
        <StopDemo coins={live} ready={!!s?.deployed} loading={coins.isLoading} />
      </section>

      <section className="proof-sec">
        <h2 className="h2">The code behind every rule</h2>
        <p className="sec-p">Cut straight from the program's source at build time, with its real line numbers. The checks run in buy before any SOL or token moves.</p>
        <div className="proof-code">{CODE.map((c) => (
          <div key={c.key} className="pc-item"><h3>{c.title}</h3>{(source[c.key] as { file: string; start: number; code: string }[]).map((b, i) => <CodeBlock key={i} block={b} sourceUrl={cfg?.sourceUrl} />)}</div>
        ))}</div>
      </section>

      <section className="proof-sec two">
        <div>
          <h2 className="h2">What the program can do</h2>
          <div className="card table-card">
            <table className="table"><tbody>{CAN.map(([n, d]) => <tr key={n}><td className="mono" style={{ verticalAlign: 'top' }}>{n}</td><td className="muted" style={{ whiteSpace: 'normal' }}>{d}</td></tr>)}</tbody></table>
          </div>
        </div>
        <div>
          <h2 className="h2">What nothing can do</h2>
          <div className="card cant">{CANT.map((c) => <div key={c}><I.x size={14} /> {c}</div>)}<p className="dim">There is no instruction for any of these, for anyone, including the admin.</p></div>
        </div>
      </section>

      <section className="proof-sec" id="tests">
        <h2 className="h2">Tested against the real thing</h2>
        <p className="sec-p">The program runs a {cfg?.testCount || 77}-check suite on a Solana validator that loads Raydium's and Metaplex's actual mainnet programs (and Metaplex Core, for dev passes), and {cfg?.e2eCount || 57} end-to-end checks run through this site's API. All pass.</p>
        <details className="tests"><summary>All the checks</summary><ul>{TESTS.map((t) => <li key={t}><I.check size={13} /> {t}</li>)}</ul></details>
      </section>

      <section className="proof-sec">
        <h2 className="h2">Check a coin's list</h2>
        <p className="sec-p">Re-hashes the wallets this site shows for a coin and compares them with the hash the program stored when it sealed the list.</p>
        <CheckList />
      </section>
    </div>
  );
}

function StopDemo({ coins, ready, loading }: { coins: { mint: string; symbol: string; name: string; blocked: number }[]; ready: boolean; loading: boolean }) {
  const [mint, setMint] = useState('');
  const [res, setRes] = useState<Simulation | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const auto = params.get('run');
  useEffect(() => { if (!mint && coins[0]) setMint(auto && coins.some((c) => c.mint === auto) ? auto : coins[0].mint); }, [coins, mint, auto]);
  async function go(m = mint) {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await api.simulate(m)); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  // /proof?run=<mint> runs it on arrival: a link anyone can post
  const ran = useRef(false);
  useEffect(() => { if (auto && mint && !ran.current) { ran.current = true; go(auto === '1' ? mint : auto); } }, [auto, mint]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loading && !coins.length) return <div className="card pad muted">{ready ? 'No live coin with a KOL list right now. Launch one and come back.' : 'This runs once the program is live on mainnet and a coin with a list exists.'}</div>;
  return (
    <div className="card sim">
      <div className="sim-bar">
        <select className="input" value={mint} onChange={(e) => { setMint(e.target.value); setRes(null); }}>
          {coins.map((c) => <option key={c.mint} value={c.mint}>${c.symbol} · {c.name} · {c.blocked} on its list</option>)}
        </select>
        <button className="btn primary" disabled={!mint || busy} onClick={() => go()}>{busy ? <Spinner size={14} /> : 'Run it'}</button>
        {res && <Copy text={`${location.origin}/proof?run=${res.mint}`} label="Copy link" />}
      </div>
      {err && <p className="err-text" style={{ padding: '0 16px 16px' }}>{err}</p>}
      {res && (
        <div className="sim-runs">
          <Run title={<>{res.bounced.kol ? <><Avatar src={res.bounced.kol.pfp} name={res.bounced.kol.name} size={18} /> {res.bounced.kol.name}</> : 'A listed wallet'} <span className="mono dim">{short(res.bounced.wallet, 4)}</span></>} run={res.bounced} />
          <Run title={<>A wallet that isn't on the list <span className="mono dim">{short(res.control.wallet, 4)}</span></>} run={res.control} />
        </div>
      )}
    </div>
  );
}

function Run({ title, run }: { title: React.ReactNode; run: SimRun }) {
  return (
    <div className="run">
      <div className="run-head">
        <span>{title}</span>
        {run.ok ? <span className="chip green">Goes through</span> : <span className="chip red">{run.error === 'Bounced' ? 'Stopped: on the list' : `Failed: ${run.error}`}</span>}
      </div>
      <pre className="term">{run.logs.map((l, i) => <span key={i} className={/Error Code|failed/.test(l) ? 'bad' : /Program data:/.test(l) ? 'evt' : /invoke|success|consumed/.test(l) ? 'sys' : ''}>{l}{'\n'}</span>)}</pre>
      <div className="run-foot mono dim">{run.slot ? `slot ${run.slot.toLocaleString()}` : ''}{run.units ? ` · ${run.units.toLocaleString()} compute units` : ''}</div>
    </div>
  );
}

function CheckList() {
  const { data: cfg } = useConfig();
  const [mint, setMint] = useState('');
  const [v, setV] = useState<Verdict | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(''); setV(null);
    try {
      const [{ live }, list] = await Promise.all([api.coin(mint.trim()), api.list(mint.trim())]);
      if (!live) throw new Error("That coin's curve isn't readable right now.");
      setV(await verifyList({ programId: cfg!.programId, mint: mint.trim(), curve: live.accounts.curve, wallets: [...list.people.flatMap((p) => p.wallets), ...list.others], rpc: cfg!.publicRpc }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="check-row">
        <label className="search big"><I.search size={16} /><input placeholder="A coin's mint address" value={mint} onChange={(e) => setMint(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
        <button className="btn primary l" disabled={!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint.trim()) || busy} onClick={go}>{busy ? <Spinner size={14} /> : 'Verify'}</button>
      </div>
      {err && <p className="err-text">{err}</p>}
      {v && (
        <div className="card spec">
          <div><span>Result</span>{v.ok ? <b className="green">Match: the list on this site is the list on chain</b> : <b className="red">Mismatch</b>}</div>
          <div><span>Wallets</span><b className="mono">{v.count} here · {v.blocked} on chain</b></div>
          <div><span>Hash on chain</span><b className="mono">{v.onChainHash.slice(0, 32)}…</b></div>
          <div><span>Hash of this list</span><b className="mono">{v.pageHash.slice(0, 32)}…</b></div>
        </div>
      )}
      <p className="footnote">Or open any coin and press <Link to="/" className="muted">Verify against chain</Link> on its rules.</p>
    </div>
  );
}
