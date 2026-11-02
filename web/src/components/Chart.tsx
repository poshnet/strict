// The coin's market cap or price (USD when SOL's price is known), from its curve trades: a line (the default, clear
// even with few trades) or candles.
import { cssVar } from '../lib/theme';
import { AreaSeries, CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Candle } from '../lib/api';

const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`);

export default function Chart({ candles, scale, kind = 'line' }: { candles: Candle[]; scale: number; kind?: 'line' | 'candles' }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--faint') || '#8d8a83', fontFamily: cssVar('--mono') || 'ui-monospace', attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)', scaleMargins: { top: 0.15, bottom: 0.1 } },
      timeScale: { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { color: `rgba(${cssVar('--accent-rgb')}, 0.4)`, labelBackgroundColor: cssVar('--accent') }, vertLine: { color: 'rgba(255,255,255,0.15)', labelBackgroundColor: cssVar('--raised') } },
    });
    const priceFormat = { type: 'custom' as const, minMove: 0.01, formatter: money };
    const a = cssVar('--accent-rgb');
    series.current = kind === 'candles'
      ? c.addSeries(CandlestickSeries, { upColor: cssVar('--green'), downColor: cssVar('--red'), borderVisible: false, wickUpColor: cssVar('--green'), wickDownColor: cssVar('--red'), priceFormat })
      : c.addSeries(AreaSeries, { lineColor: cssVar('--accent'), lineWidth: 2, topColor: `rgba(${a}, 0.28)`, bottomColor: `rgba(${a}, 0)`, priceFormat, crosshairMarkerBackgroundColor: cssVar('--accent') });
    chart.current = c;
    return () => { c.remove(); chart.current = null; series.current = null; fitted.current = false; };
  }, [kind]);

  useEffect(() => {
    if (!series.current) return;
    // the scale's step follows the numbers: a cap in dollars moves by cents, a price a millionth of a cent moves by less.
    // (One tiny fixed step for everything made the chart crawl through millions of ticks on a flat line.)
    const top = candles.reduce((m, k) => Math.max(m, k.high * scale), 0);
    const minMove = top > 0 ? Math.max(1e-12, 10 ** (Math.floor(Math.log10(top)) - 5)) : 0.01;
    series.current.applyOptions({ priceFormat: { type: 'custom', minMove, formatter: money } });
    if (kind === 'candles') (series.current as ISeriesApi<'Candlestick'>).setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open * scale, high: k.high * scale, low: k.low * scale, close: k.close * scale })));
    else (series.current as ISeriesApi<'Area'>).setData(candles.map((k) => ({ time: k.time as UTCTimestamp, value: k.close * scale })));
    if (!fitted.current && candles.length) { chart.current?.timeScale().fitContent(); fitted.current = true; }
  }, [candles, scale, kind]);

  return <div ref={box} className="chart-box" />;
}
