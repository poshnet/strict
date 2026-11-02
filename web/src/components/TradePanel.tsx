// Buy and sell. Before bonding the trade is built on the coin's curve and checked against the coin's rules (a wallet on
// its list, its creator on a no-dev-buy coin, a buy past its max wallet: each is told which rule stops it). After
// bonding the same panel routes through Jupiter to the coin's Raydium pool.
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError, type Coin, type Live, type RuleId } from '../lib/api';
import { shieldFee, useNow, type Shield } from '../lib/curve';
import { amount, bpsPct } from '../lib/format';
import { useToast } from '../lib/toast';
import { useWallet, walletError } from '../lib/wallet';
import { I, RuleIcon, Spinner } from './ui';

export function TradePanel({ coin, live, listed }: { coin: Coin; live: Live | null; listed: boolean }) {
  const w = useWallet();
  const toast = useToast();
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<RuleId | null>(null);
  const bonded = !!live?.complete || coin.status !== 'live';
  const bal = useQuery({ queryKey: ['bal', w.address, coin.mint], queryFn: () => api.balance(w.address!, coin.mint), enabled: !!w.address, refetchInterval: 12_000 });
  const held = bal.data ? Number(bal.data.raw) / 1e6 : 0;
  const isCreatorEarly = !!w.address && w.address === coin.creator && !!coin.noDevBuy;
  const blockedHere: RuleId | null = bonded || side !== 'buy' ? null : listed ? 'kols' : isCreatorEarly ? 'dev' : null;
  const shield: Shield = live?.shieldKind ? { kind: live.shieldKind === 1 ? 'linear' : 'exponential', secs: live.shieldSecs } : null;
  const shieldLive = !!shield && !!live && Date.now() / 1000 - live.createdAt < shield.secs + 1;
  const now = useNow(250, shieldLive);
  const age = live ? now / 1000 - live.createdAt : 1e9;
  const isCreator = !!w.address && w.address === coin.creator;
  const feePct = bonded ? 0 : side === 'buy' && isCreator ? 1 : shieldFee(shield, age);

  async function go(pct?: number) {
    const wallet = await w.ensure();
    if (!wallet) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { wallet, mint: coin.mint, side };
      if (side === 'buy') body.sol = Number(val);
      else if (pct) body.pct = pct;
      else body.tokens = String(Math.floor(Number(val) * 1e6));
      const built = await api.trade(body);
      const sig = await w.signAndSend(built.tx, built.lastValidBlockHeight);
      toast({ kind: 'good', text: side === 'buy' ? `Bought $${coin.symbol}.` : `Sold $${coin.symbol}.`, link: { href: `https://solscan.io/tx/${sig}`, label: 'View' } });
      setVal('');
      api.ingest(sig).then(() => { qc.invalidateQueries({ queryKey: ['coin', coin.mint] }); qc.invalidateQueries({ queryKey: ['trades', coin.mint] }); qc.invalidateQueries({ queryKey: ['candles', coin.mint] }); });
      bal.refetch();
    } catch (e) {
      if (e instanceof ApiError && (e.data?.rule || e.data?.bounced)) { setStopped((e.data.rule as RuleId) || 'kols'); return; }
      toast({ kind: 'bad', text: e instanceof ApiError ? e.message : walletError(e) });
    } finally { setBusy(false); }
  }

  const rule = stopped || blockedHere;
  if (rule) return <Stopped coin={coin} rule={rule} onSell={() => { setStopped(null); setSide('sell'); }} onBack={stopped && !blockedHere ? () => setStopped(null) : undefined} />;

  return (
    <div className="card trade-card">
      <div className="trade-tabs">
        <button className={`buy${side === 'buy' ? ' on' : ''}`} onClick={() => setSide('buy')}>Buy</button>
        <button className={`sell${side === 'sell' ? ' on' : ''}`} onClick={() => setSide('sell')}>Sell</button>
      </div>
      {!bonded && shield && age < shield.secs && <div className="notice red"><span>No snipers: <b className="mono">{feePct.toFixed(1)}%</b> fee right now, back to 1% in <b className="mono">{Math.ceil(shield.secs - age)}s</b>.</span></div>}
      {!bonded && coin.maxWalletBps > 0 && side === 'buy' && <div className="notice"><span>Max wallet {bpsPct(coin.maxWalletBps)}: no wallet can hold more than that until it bonds{w.address && bal.data ? <>. You hold <b className="mono">{(held / ((coin.maxWalletBps / 10_000) * 1e9) * 100).toFixed(0)}%</b> of your cap.</> : '.'}</span></div>}
      {bonded && <div className="notice green"><I.check size={16} /> Bonded. The rules are done: this trades on its Raydium pool now.</div>}
      <div className="field">
        <label>{side === 'buy' ? 'You pay' : 'You sell'} <span className="hint">{w.address && bal.data ? (side === 'buy' ? `${amount(bal.data.sol, 4)} SOL` : `${amount(held)} $${coin.symbol}`) : ''}</span></label>
        <div className="input-wrap"><input className="input" inputMode="decimal" placeholder="0.0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))} /><span className="suffix">{side === 'buy' ? 'SOL' : `$${coin.symbol}`}</span></div>
      </div>
      {side === 'buy' ? (
        <div className="quick">{[0.1, 0.5, 1, 2].map((v) => <button key={v} onClick={() => setVal(String(v))}>{v} SOL</button>)}</div>
      ) : (
        <div className="quick">{[25, 50, 75, 100].map((v) => <button key={v} disabled={busy} onClick={() => go(v)}>{v}%</button>)}</div>
      )}
      <Estimate live={live} side={side} val={Number(val) || 0} symbol={coin.symbol} bonded={bonded} feePct={feePct} />
      {w.address ? (
        <button className={`btn l block ${side === 'buy' ? 'green' : 'red'}`} disabled={busy || !(Number(val) > 0)} onClick={() => go()}>
          {busy ? <Spinner /> : `${side === 'buy' ? 'Buy' : 'Sell'} $${coin.symbol}`}
        </button>
      ) : <button className="btn primary l block" onClick={w.openPicker}>Connect a wallet</button>}
      <span className="dim" style={{ fontSize: 12, textAlign: 'center' }}>{bonded ? 'Routed by Jupiter.' : `1% fee on the curve, ${(live?.creatorFeeBps ?? 30) / 100}% of it to the creator. 5% max slippage.`}</span>
    </div>
  );
}

/** what you'd get, with the program's own math on the live curve */
function Estimate({ live, side, val, symbol, bonded, feePct }: { live: Live | null; side: 'buy' | 'sell'; val: number; symbol: string; bonded: boolean; feePct: number }) {
  if (!live || bonded || !(val > 0)) return null;
  const vs = Number(live.virtualSol), vt = Number(live.virtualToken);
  const fee = feePct / 100;
  let out: string, impact: number;
  if (side === 'buy') {
    const net = val * 1e9 * (1 - fee);
    let tokens = vt - (vs * vt) / (vs + net);
    tokens = Math.min(tokens, Number(live.realToken));
    out = `${amount(tokens / 1e6)} $${symbol}`;
    impact = ((vs + net) ** 2 / vs ** 2 - 1) * 100;
  } else {
    const t = val * 1e6;
    const gross = vs - (vs * vt) / (vt + t);
    out = `${amount((gross * (1 - fee)) / 1e9, 4)} SOL`;
    impact = (1 - vt ** 2 / (vt + t) ** 2) * 100;
  }
  return (
    <div className="quote">
      <div><span>You get about</span><b>{out}</b></div>
      <div><span>Price impact</span><b className={impact > 5 ? 'red' : ''}>{impact.toFixed(2)}%</b></div>
      <div><span>Fee</span><b className={fee > 0.011 ? 'red' : ''}>{feePct.toFixed(feePct >= 10 ? 0 : 1)}%</b></div>
    </div>
  );
}

const WHY: Record<RuleId, (c: Coin) => string> = {
  kols: (c) => `This wallet is on $${c.symbol}'s list. The program refuses its buys until the coin bonds.`,
  dev: (c) => `You created $${c.symbol} with no dev buy, so your wallet can't buy it until it bonds.`,
  bundles: () => 'Nothing can buy in the block the coin was created in. Try again in a moment.',
  maxWallet: (c) => `This buy would take your wallet past $${c.symbol}'s max wallet of ${bpsPct(c.maxWalletBps)}. Try a smaller amount.`,
  snipers: () => 'The sniper fee is still high. Wait a few seconds.',
  vamps: () => 'Copycat coins are refused at launch.',
};
const TITLE: Record<RuleId, string> = { kols: 'No KOLs', dev: 'No dev buy', bundles: 'No bundles', maxWallet: 'Max wallet', snipers: 'No snipers', vamps: 'No vamps' };

function Stopped({ coin, rule, onSell, onBack }: { coin: Coin; rule: RuleId; onSell: () => void; onBack?: () => void }) {
  const w = useWallet();
  const toast = useToast();
  const [signed, setSigned] = useState(w.signedIn);
  return (
    <div className="card trade-card">
      <div className="stopped-box">
        <RuleIcon id={rule} />
        <b>Stopped by a rule: {TITLE[rule]}</b>
        <p>{WHY[rule](coin)}</p>
      </div>
      {rule === 'kols' && !signed && w.wallet && 'solana:signMessage' in w.wallet.features && (
        <button className="btn ghost block" onClick={async () => {
          try {
            await w.signIn();
            setSigned(true);
            await api.trade({ wallet: w.address, mint: coin.mint, side: 'buy', sol: 0.01 }).catch(() => null);
            toast({ kind: 'good', text: 'Logged. This try shows in the coin\'s rules at work.' });
          } catch (e) { toast({ kind: 'bad', text: walletError(e) }); }
        }}>Sign to put this try on the record</button>
      )}
      {onBack && <button className="btn ghost block" onClick={onBack}>Change the amount</button>}
      <button className="btn quiet block" onClick={onSell}>Sell instead</button>
    </div>
  );
}
