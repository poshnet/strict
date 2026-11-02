// Numbers people read: compact market caps, plain-decimal prices (never scientific notation), short ages.

export function usd(n: number | null | undefined, { compact = true, digits }: { compact?: boolean; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (compact) {
    if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  }
  if (a >= 1000) return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: digits ?? 0 })}`;
  if (a >= 1) return `${sign}$${a.toFixed(digits ?? 2)}`;
  return `${sign}$${plain(a)}`;
}

// A small number as a plain decimal with 4 significant digits: 0.00001234
export function plain(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : a >= 100 ? 2 : 3 });
  const zeros = Math.max(0, -Math.floor(Math.log10(a)) - 1);
  return n.toFixed(Math.min(18, zeros + sig)).replace(/(\.\d*?[1-9])0+$/, '$1');
}

export function amount(n: number | null | undefined, max = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: max });
  return plain(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 1000 ? 0 : digits)}%`;
}
export const dir = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'up' : n < 0 ? 'down' : '');

export function ago(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

export const short = (a: string | null | undefined, n = 4) => (!a ? '' : `${a.slice(0, n)}…${a.slice(-n)}`);
export const bpsPct = (b: number | null | undefined) => (b == null ? '—' : `${+(b / 100).toFixed(2)}%`);

// A deterministic gradient for wallets and coins without art.
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
export const gradientOf = (s: string) => {
  const h = hueOf(s);
  return `linear-gradient(135deg, hsl(${h} 70% 62%), hsl(${(h + 60) % 360} 70% 48%))`;
};
