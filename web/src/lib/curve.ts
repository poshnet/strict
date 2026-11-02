// The snipe shield's fee, as the program charges it: 99% at launch, falling to the normal fee over its seconds (by the
// same factor each whole second when exponential, in a straight line when linear).
import { useEffect, useState } from 'react';

export type Shield = { kind: 'linear' | 'exponential'; secs: number } | null;

/** the fee in percent `age` seconds after launch */
export function shieldFee(shield: Shield, age: number, basePct = 1): number {
  if (!shield || age >= shield.secs) return basePct;
  const a = Math.max(0, Math.floor(age));
  const s = shield.kind === 'linear' ? basePct + (99 - basePct) * ((shield.secs - a) / shield.secs) : 99 * (1 / 99) ** (a / shield.secs);
  return Math.max(basePct, s);
}

/** ticking clock while something is time-sensitive */
export function useNow(ms: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}
