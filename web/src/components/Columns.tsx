// A column chart for one series over time: thin columns from one baseline, rounded at the data end, a few clean y
// ticks on hairlines, and a tooltip per column (the column is the hit target, and it takes keyboard focus). Any chart
// flips to a table of the same numbers.
import { useLayoutEffect, useRef, useState } from 'react';

export type Col = { t: number; v: number };

const HOUR = 3_600_000, DAY = 24 * HOUR;
const H = 168, B = 24, T = 10;

export function useWidth<E extends HTMLElement>() {
  const ref = useRef<E>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 0 and a few round steps up to (at least) the max (whole steps for counts) */
function ticks(max: number, whole: boolean) {
  if (max <= 0) return [0, 1];
  const raw = max / 3, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  if (whole) step = Math.max(1, Math.ceil(step));
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => +(i * step).toPrecision(6));
}

// hours in the reader's time; days and weeks are UTC days, as the worker buckets them
export const bucketLabel = (t: number, bucket: number, long = false) => {
  const d = new Date(t);
  if (bucket < DAY) return d.toLocaleTimeString('en-US', { hour: 'numeric', ...(long ? { month: 'short', day: 'numeric' } : {}) });
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return bucket > DAY && long ? `Week of ${day}` : day;
};

const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${+n.toFixed(n < 10 && n % 1 ? 1 : 0)}`);

/** a column with a rounded top and a square foot */
const column = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
};

export function Columns({ data, bucket, fmt, tone = 'ink', unit, whole = false, empty = 'Nothing yet in this range.' }: {
  data: Col[]; bucket: number; fmt: (v: number) => string; tone?: 'ink' | 'red'; unit: string; whole?: boolean; empty?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.v));
  const ys = ticks(max, whole);
  const top = ys[ys.length - 1];
  const L = Math.max(28, 10 + Math.max(...ys.map((v) => compact(v).length)) * 7), R = 4;
  const slot = width > L ? (width - L - R) / Math.max(1, data.length) : 0;
  const bw = Math.max(2, Math.min(24, slot - 2, slot * 0.62));
  const y = (v: number) => T + (1 - v / top) * (H - T);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((width - L) / 64))));
  const h = hover == null ? null : data[hover];
  const cx = (i: number) => L + slot * (i + 0.5);

  return (
    <div className={`cols ${tone}`} ref={ref}>
      {width > 0 && (
        <svg width={width} height={H + B} role="img" aria-label={`${unit}, ${bucketLabel(data[0]?.t ?? 0, bucket, true)} to ${bucketLabel(data[data.length - 1]?.t ?? 0, bucket, true)}`}>
          {ys.map((v) => (
            <g key={v}>
              <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} className={v === 0 ? 'cols-base' : 'cols-grid'} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="cols-axis">{compact(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const hgt = d.v > 0 ? Math.max(2, H - y(d.v)) : 0;
            return hgt > 0 && <path key={d.t} d={column(cx(i) - bw / 2, H - hgt, bw, hgt)} className={`cols-bar${hover === i ? ' on' : ''}`} />;
          })}
          {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (data.length - 1 - i >= every || i === data.length - 1) && (
            <text key={d.t} x={cx(i)} y={H + 17} textAnchor="middle" className="cols-axis">{bucketLabel(d.t, bucket)}</text>
          ))}
          {data.map((d, i) => (
            <rect key={d.t} x={L + slot * i} y={T} width={slot} height={H - T} fill="transparent" tabIndex={0} className="cols-hit"
              aria-label={`${bucketLabel(d.t, bucket, true)}: ${fmt(d.v)}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          ))}
        </svg>
      )}
      {max === 0 && width > 0 && <div className="cols-empty">{empty}</div>}
      {h && hover != null && (
        <div className="cols-tip" style={{ left: Math.min(Math.max(cx(hover), 70), width - 70), top: (h.v > 0 ? y(h.v) : H) - 10 }}>
          <b>{fmt(h.v)}</b>
          <span>{bucketLabel(h.t, bucket, true)}{hover === data.length - 1 ? ', so far' : ''}</span>
        </div>
      )}
    </div>
  );
}

/** the same numbers as a table */
export function ColTable({ data, bucket, fmt, unit }: { data: Col[]; bucket: number; fmt: (v: number) => string; unit: string }) {
  return (
    <div className="cols-table">
      <table className="table">
        <thead><tr><th>{bucket < DAY ? 'Hour' : bucket > DAY ? 'Week (UTC)' : 'Day (UTC)'}</th><th className="r">{unit}</th></tr></thead>
        <tbody>
          {[...data].reverse().map((d) => <tr key={d.t}><td>{bucketLabel(d.t, bucket, true)}</td><td className="r mono">{fmt(d.v)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
