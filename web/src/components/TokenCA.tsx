// Our own coin's contract address (TOKEN_MINT, launched on Raydium LaunchLab): a pill to copy it, with a chart link.
// Shows only once it's set, in the top bar and on the home page.
import { useState } from 'react';
import { useConfig } from '../lib/data';
import { short } from '../lib/format';
import { I } from './ui';

export function TokenCA({ where = 'top' }: { where?: 'top' | 'home' }) {
  const { data: cfg } = useConfig();
  const [done, setDone] = useState(false);
  const mint = cfg?.tokenMint;
  if (!mint) return null;
  const copy = () => { navigator.clipboard?.writeText(mint).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); };
  return (
    <span className={`tca ${where}`}>
      <button type="button" className="tca-copy" onClick={copy} title={`Copy ${mint}`} aria-label={`Copy the contract address ${mint}`}>
        <span className="tca-t">{cfg?.tokenSymbol ? `$${cfg.tokenSymbol}` : 'Our coin'}</span>
        <span className="tca-k">CA</span>
        <span className="tca-m mono">{where === 'home' ? mint : short(mint, 4)}</span>
        {done ? <I.check size={13} /> : <I.copy size={13} />}
      </button>
      <a className="tca-chart" href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noreferrer" aria-label="Chart">Chart <I.ext size={11} /></a>
    </span>
  );
}
