// No snipers, drawn (after betterlaunch's shield replay): the fee a coin charges second by second from 99% down
// to 1%, on a log scale so every step shows. The replay puts each trade made into it on the curve as a dot (its size
// what it spent, red when it paid the curve); while the curve is still falling a line sweeps the seconds. The demo
// plays a whole curve on a loop for the launch page.
import { useQuery } from '@tanstack/react-query';
import { api, type Coin, type SniperTrade } from '../lib/api';
import { shieldFee, useNow, type Shield } from '../lib/curve';
import { amount, short } from '../lib/format';

const W = 640, H = 210, L = 40, R = 12, T = 12, B = 26;
const xOf = (sec: number, secs: number) => L + (Math.min(sec, secs) / secs) * (W - L - R);
const yOf = (pct: number) => T + ((2 - Math.log10(Math.max(1, Math.min(100, pct)))) / 2) * (H - T - B);
// a trade's place inside its second, the same every render
const jitter = (sig: string) => ([...sig].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7) % 1000) / 1000;

function curvePath(shield: NonNullable<Shield>) {
  const { secs } = shield;
  if (shield.kind === 'linear') {
    let d = '';
    for (let s = 0; s <= secs; s += Math.max(1, Math.floor(secs / 60))) d += `${s ? 'L' : 'M'}${xOf(s, secs)},${yOf(shieldFee(shield, s))} `;
    return `${d}L${xOf(secs, secs)},${yOf(1)}`;
  }
  let d = '';
  for (let s = 0; s < secs; s++) d += `${s ? 'L' : 'M'}${xOf(s, secs)},${yOf(shieldFee(shield, s))} L${xOf(s + 1, secs)},${yOf(shieldFee(shield, s))} `;
  return `${d}L${xOf(secs, secs)},${yOf(1)}`;
}

export function SniperChart({ shield, trades = [], sweep, dim }: { shield: NonNullable<Shield>; trades?: SniperTrade[]; sweep?: number | null; dim?: boolean }) {
  const { secs } = shield;
  const ticks = secs <= 30 ? Array.from({ length: secs + 1 }, (_, s) => s).filter((s) => secs <= 15 || s % 5 === 0) : [0, secs / 4, secs / 2, (3 * secs) / 4, secs].map(Math.round);
  const r = (t: SniperTrade) => Math.min(13, 3.5 + Math.sqrt(Math.max(0, t.sol)) * 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`sniper-chart${dim ? ' dim' : ''}`} role="img" aria-label={`The fee falling from 99% to 1% over ${secs} seconds`}>
      {[99, 50, 10, 1].map((p) => (
        <g key={p}>
          <line x1={L} x2={W - R} y1={yOf(p)} y2={yOf(p)} className="sc-grid" />
          <text x={L - 7} y={yOf(p) + 4} className="sc-axis" textAnchor="end">{p}%</text>
        </g>
      ))}
      {ticks.map((s) => <text key={s} x={xOf(s, secs)} y={H - 7} className="sc-axis" textAnchor="middle">{s}s</text>)}
      <path d={`${curvePath(shield)} L${xOf(secs, secs)},${H - B} L${xOf(0, secs)},${H - B} Z`} className="sc-fill" />
      <path d={curvePath(shield)} className="sc-curve" />
      {sweep != null && sweep >= 0 && sweep < secs && (
        <g>
          <line x1={xOf(sweep, secs)} x2={xOf(sweep, secs)} y1={T} y2={H - B} className="sc-sweep" />
          <circle cx={xOf(sweep, secs)} cy={yOf(shieldFee(shield, sweep))} r="5" className="sc-head" />
        </g>
      )}
      {trades.map((t) => (
        <a key={t.sig + t.side} href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer">
          <circle cx={xOf(Math.min(secs - 0.05, Math.floor(t.at) + 0.15 + jitter(t.sig) * 0.7), secs)} cy={yOf(t.feePct)} r={r(t)}
            className={`sc-dot ${t.side}${t.feePct > 1.5 ? ' taxed' : ''}`}>
            <title>{`${t.kol?.name || short(t.wallet, 4)} ${t.side === 'buy' ? 'bought' : 'sold'} ${amount(t.sol, 3)} SOL at ${t.at.toFixed(1)}s · paid ${t.feePct.toFixed(0)}%${t.shieldSol > 0 ? ` · ${amount(t.shieldSol, 3)} SOL to the buyback` : ''}${t.creator ? ' · the creator' : ''}`}</title>
          </circle>
        </a>
      ))}
    </svg>
  );
}

/** A whole curve played on a loop (in real time when it's short), with the fee it's at. */
export function SniperDemo({ shield, dim }: { shield: NonNullable<Shield>; dim?: boolean }) {
  const play = shield.secs <= 15 ? shield.secs * 1000 : 6000;
  const now = useNow(50, true);
  const cycle = play + 1400;
  const t = now % cycle;
  const age = t >= play ? null : (t / play) * shield.secs;
  const fee = age == null ? 1 : shieldFee(shield, age);
  return (
    <div className="sniper-demo">
      <SniperChart shield={shield} sweep={age} dim={dim} />
      <div className="sd-read">
        <b className={`mono${fee > 1.5 ? ' red' : ''}`}>{fee.toFixed(fee >= 10 ? 0 : 1)}%</b>
        <span className="dim">{age == null ? 'open: 1%' : `${Math.ceil(shield.secs - age)}s left`}</span>
      </div>
    </div>
  );
}

/** The coin page's replay: the sniper fee as it charged this coin, and every trade made while it was up. */
export function SniperReplay({ coin, createdAt }: { coin: Coin; createdAt?: number }) {
  const launched = (createdAt ? createdAt * 1000 : coin.createdAt) || 0;
  const live = !!coin.shield && Date.now() < launched + (coin.shield.secs + 30) * 1000;
  const now = useNow(100, live);
  const { data } = useQuery({ queryKey: ['sniper', coin.mint], queryFn: () => api.sniper(coin.mint), enabled: !!coin.shield, refetchInterval: live ? 1500 : false });
  if (!coin.shield) return null;
  const shield = coin.shield;
  const start = data?.launchedAt || launched;
  const age = (now - start) / 1000;
  const sweeping = age >= 0 && age < shield.secs;
  const trades = data?.trades || [];
  const taxed = trades.filter((t) => t.feePct > 1.5);
  return (
    <div className="card sniper-card">
      <div className="sniper-head">
        <div>
          <span className="label-sm">No snipers · {shield.kind === 'linear' ? 'linear' : 'fast'} · {shield.secs}s</span>
          <h3>{sweeping ? <><span className="red mono">{shieldFee(shield, age).toFixed(0)}%</span> fee right now</> : taxed.length ? `${taxed.length} sniper${taxed.length === 1 ? '' : 's'} paid the fee` : 'Clean launch'}</h3>
        </div>
        <span className="muted sniper-sub">
          {sweeping ? `${Math.ceil(shield.secs - age)}s until it's 1%` : taxed.length ? <><b className="mono">{amount(data?.taxedSol || 0, 3)} SOL</b> went to the buyback</> : 'Nobody bought while the fee was up.'}
        </span>
      </div>
      <SniperChart shield={shield} trades={trades} sweep={sweeping ? age : null} />
    </div>
  );
}
