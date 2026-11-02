// Who a coin's creator fees go to, picked at launch and fixed like the rules: locked to the creator's wallet, or a dev
// pass, a 1-of-1 NFT whose holder the program pays (worker/pass.js). On the coin page: the pass as a card, its holder
// read live from chain, what's owed and what's been paid. On the launch page: the pick itself, under Advanced.
import { useQuery } from '@tanstack/react-query';
import { api, type Coin, type PassStatus } from '../lib/api';
import { useConfig } from '../lib/data';
import { amount, short } from '../lib/format';
import { useWallet } from '../lib/wallet';
import { Avatar, I, Spinner } from './ui';

export type FeesTo = 'creator' | 'pass';
const sol = (a: string) => `https://solscan.io/account/${a}`;

/** the pass as a card, like the NFT itself */
export function PassArt({ symbol, image, seed, bps, size = 'm' }: { symbol: string; image: string | null; seed: string; bps: number; size?: 's' | 'm' }) {
  return (
    <div className={`pass-art ${size}`}>
      <div className="pa-top"><span className="mono">{'{s}'} strict.fun</span><span className="mono">1 of 1</span></div>
      <div className="pa-mid"><Avatar src={image} name={symbol} size={size === 's' ? 34 : 44} square seed={seed} /><span><b>DEV PASS</b><span className="mono">${symbol}</span></span></div>
      <div className="pa-foot mono">{bps / 100}% of every trade · to the holder</div>
    </div>
  );
}

/** on a coin's page: where its creator fees go */
export function CreatorFeesPanel({ coin }: { coin: Coin }) {
  const { data: cfg } = useConfig();
  const w = useWallet();
  const q = useQuery({ queryKey: ['pass', coin.mint], queryFn: () => api.pass(coin.mint), refetchInterval: 20_000, enabled: !!coin.pass });
  const p: PassStatus | undefined = q.data;
  const bps = p?.earnsBps ?? cfg?.creatorFeeBps ?? 30;
  if (!coin.pass) return (
    <section className="panel cp-fees">
      <div className="cpf-h"><b>Creator fees</b><span className="pill-s"><I.lock size={11} />Locked to creator</span></div>
      <p>{bps / 100}% of every trade goes to the wallet that launched it, <Wallet a={coin.creator} />, and the program pays nobody else, ever.</p>
    </section>
  );
  const mine = !!w.address && p?.holder === w.address;
  return (
    <section className="panel cp-fees pass">
      <div className="cpf-h"><b>Dev pass</b><span className="pill-s accent">NFT · creator fees</span></div>
      <PassArt symbol={coin.symbol} image={coin.image} seed={coin.mint} bps={bps} />
      <dl className="cpf-kv">
        <div><dt>Holder now</dt><dd>{q.isLoading ? <Spinner size={12} /> : p?.burned ? <span className="red-t">burned</span> : p?.holder ? <>{mine && <span className="pill-s green">you</span>}<Wallet a={p.holder} /></> : '–'}</dd></div>
        <div><dt>Owed now</dt><dd className="mono">{p ? `${amount(p.owedSol, 4)} SOL` : '–'}</dd></div>
        <div><dt>Paid so far</dt><dd className="mono">{amount(p?.paidSol ?? coin.creatorPaidSol ?? 0, 3)} SOL{p && p.payouts.length > 1 ? ` · ${p.payouts.length} holders` : ''}</dd></div>
      </dl>
      <p>{p?.burned ? 'This pass was burned, so its fees stay in the curve for good.' : `Whoever holds this NFT is paid the creator fees straight from the program${p?.bonded ? '' : ', every few minutes'}. Sell or send it and they go with it.`}</p>
      <a className="cpf-link" href={sol(coin.pass)} target="_blank" rel="noreferrer">See the NFT <I.ext size={11} /></a>
    </section>
  );
}

const Wallet = ({ a }: { a: string }) => <a className="mono" href={sol(a)} target="_blank" rel="noreferrer">{short(a, 4)}</a>;

/** on the launch page, under Advanced: where the creator fees go */
export function FeesPick({ value, onChange, symbol, image, devBuy }: { value: FeesTo; onChange: (v: FeesTo) => void; symbol: string; image: string | null; devBuy: boolean }) {
  const { data: cfg } = useConfig();
  const bps = cfg?.creatorFeeBps ?? 30;
  return (
    <div className="fees-pick">
      <div className="fp-opts" role="radiogroup" aria-label="Creator fees">
        <button type="button" role="radio" aria-checked={value === 'creator'} className={`fp-opt${value === 'creator' ? ' on' : ''}`} onClick={() => onChange('creator')}>
          <span className="fp-ic"><I.lock size={16} /></span>
          <span className="fp-t"><b>Locked to your wallet</b><span>Your {bps / 100}% of every trade goes to the wallet you launch from, and only ever to it.</span></span>
          <span className="fp-tag">Default</span>
        </button>
        <button type="button" role="radio" aria-checked={value === 'pass'} className={`fp-opt${value === 'pass' ? ' on' : ''}`} onClick={() => onChange('pass')}>
          <span className="fp-ic"><I.users size={16} /></span>
          <span className="fp-t"><b>Dev pass NFT</b><span>Your {bps / 100}% goes to whoever holds a 1-of-1 NFT, minted to you at launch. Sell or send it and the fees go with it.</span></span>
          <span className="fp-tag">Tradeable</span>
        </button>
      </div>
      {value === 'pass' && (
        <div className="fp-more">
          <PassArt symbol={symbol || 'TICKER'} image={image} seed={symbol || 'pass'} bps={bps} size="s" />
          <ul>
            <li>The program pays the pass's holder at payout time, read from the NFT itself. Nobody can redirect it, us included.</li>
            <li>It's a plain Metaplex Core NFT, list it on any marketplace that takes Core. No royalties, no plugins, so nobody can take it back.</li>
            <li>Burn it and its fees burn with it. Fees end when the coin bonds, like the rules.</li>
            <li>About 0.002 SOL of rent{devBuy ? ', and one more transaction to sign (your first buy leaves no room in the launch)' : ', minted in the launch transaction itself'}.</li>
          </ul>
        </div>
      )}
      <span className="faint small">Fixed at launch, like the rules: you can't switch later.</span>
    </div>
  );
}
