// A number that counts up to its value the first time it's seen (and eases to new values after that).
import { useEffect, useRef, useState } from 'react';

export function CountUp({ to, format = (n: number) => Math.round(n).toLocaleString(), ms = 900 }: { to: number; format?: (n: number) => string; ms?: number }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(to); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - (1 - p) ** 3;
      setV(a + (to - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{format(v)}</>;
}
