// A coin on the board: its picture, name and market cap, the rules it launched with in words, how far it is to bonding
// and how many buys its rules stopped.
import { Link } from 'react-router-dom';
import type { Coin } from '../lib/api';
import { shieldFee, useNow } from '../lib/curve';
import { useUsd } from '../lib/data';
import { ago, usd } from '../lib/format';
import { coinRuleLabels } from '../lib/rules';
import { Avatar } from './ui';

export function CoinCard({ c, i = 0 }: { c: Coin; i?: number }) {
  const toUsd = useUsd();
  const bonded = c.status === 'migrated';
  const pct = bonded ? 100 : c.progress;
  const labels = coinRuleLabels(c);
  const stopped = c.stopped ?? 0;
  return (
    <Link to={`/coin/${c.mint}`} className="coin" style={{ ['--i' as any]: Math.min(i, 12) }}>
      <div className="coin-top">
        <div className="coin-id">
          <Avatar src={c.image} name={c.symbol} size={46} square seed={c.mint} />
          <div className="coin-names">
            <b>{c.name}</b>
            <span>${c.symbol} · {usd(toUsd(c.mcapSol))}</span>
          </div>
        </div>
        <span className="chip accent">{labels.length} rule{labels.length === 1 ? '' : 's'}</span>
      </div>
      <p className="coin-rules">{labels.length ? labels.join(' · ') : 'No rules: anyone can buy, any way.'}</p>
      {c.shield && <SniperMeter c={c} />}
      <div className={`bar${bonded ? ' done' : ''}`}><i style={{ width: `${Math.max(1.5, Math.min(100, pct))}%` }} /></div>
      <div className="coin-foot">
        <span>{bonded ? 'Bonded' : c.status === 'complete' ? 'Bonding now' : `Bonding ${pct.toFixed(0)}%`} · {ago(c.createdAt)}</span>
        <span className={stopped ? 'red' : 'faint'}>{stopped ? `${stopped.toLocaleString()} buy${stopped === 1 ? '' : 's'} stopped` : 'No buys stopped'}</span>
      </div>
    </Link>
  );
}

export function CoinSkeleton() {
  return (
    <div className="coin">
      <div className="coin-top"><div className="coin-id"><div className="skeleton" style={{ width: 46, height: 46, borderRadius: 12 }} /><div style={{ display: 'grid', gap: 8 }}><div className="skeleton" style={{ height: 13, width: 120 }} /><div className="skeleton" style={{ height: 10, width: 80 }} /></div></div></div>
      <div className="skeleton" style={{ height: 12, width: '90%' }} />
      <div className="skeleton" style={{ height: 6, width: '100%' }} />
    </div>
  );
}

/** while a coin's sniper fee is still falling: the fee right now and the seconds left, ticking */
function SniperMeter({ c }: { c: Coin }) {
  const shield = c.shield!;
  const live = Date.now() < c.createdAt + shield.secs * 1000;
  const now = useNow(200, live);
  const age = (now - c.createdAt) / 1000;
  if (!live || age >= shield.secs) return null;
  const fee = shieldFee(shield, age);
  return (
    <div className="sniper-meter" title="No snipers: the fee falls to 1%">
      <span>Sniper fee</span>
      <span className="sm-track"><i style={{ width: `${(1 - age / shield.secs) * 100}%` }} /></span>
      <b className="mono">{fee.toFixed(0)}%</b>
    </div>
  );
}
