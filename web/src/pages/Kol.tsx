// One KOL: their wallets, the coins that keep them out, and every time one of their wallets tried to buy anyway.
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CoinCard } from '../components/CoinCard';
import { Avatar, Copy, Empty, Fol, I, Spinner, Verified } from '../components/ui';
import { api } from '../lib/api';
import { ago, amount } from '../lib/format';

export default function Kol() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['kol', id], queryFn: () => api.kol(id), refetchInterval: 20_000 });
  if (q.isLoading) return <div className="page-load"><Spinner size={22} /></div>;
  if (!q.data) return <div className="wrap"><Empty title="Not in the directory" action={<Link to="/kols" className="btn ghost">All KOLs</Link>}>Nobody by that name.</Empty></div>;
  const { kol, coins, tries } = q.data;
  const live = coins.filter((c) => c.status === 'live');
  return (
    <div className="wrap page">
      <div className="profile-head">
        <Avatar src={kol.pfp} name={kol.name} size={84} />
        <div>
          <h1>{kol.name}{kol.verified && <Verified />}</h1>
          <div className="sub" style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'center', color: 'var(--muted)' }}>
            {kol.handle && <a href={`https://x.com/${kol.handle}`} target="_blank" rel="noreferrer" className="btn ghost s"><I.x_logo size={14} /> @{kol.handle}</a>}
            {kol.followers ? <span style={{ fontSize: 15 }}><Fol n={kol.followers} /></span> : <span>followers unknown</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          {live.length > 0 && <span className="pill-s stop big">Kept out of {live.length} live coin{live.length === 1 ? '' : 's'}</span>}
          <div style={{ marginTop: 14 }}><b className="big-num red">{coins.length}</b> <span className="muted">coin{coins.length === 1 ? '' : 's'} {live.length ? `(${live.length} right now)` : ''}</span></div>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 28 }}>
        <div className="label" style={{ marginBottom: 12 }}>Tracked wallets</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{kol.wallets.map((w) => <Copy key={w} text={w} label={w} />)}</div>
      </div>

      {tries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className="h2">Tried to buy anyway</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="table">
              <tbody>
                {tries.map((t, i) => (
                  <tr key={i}>
                    <td><Link className="who-cell" to={`/coin/${t.mint}`}><Avatar src={t.image} name={t.symbol} size={24} square /><b>${t.symbol || '?'}</b></Link></td>
                    <td><span className="pill-s stop">Stopped</span></td>
                    <td className="muted">{t.sol ? `${amount(t.sol, 3)} SOL` : ''}</td>
                    <td className="muted">{t.source === 'chain' ? <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer">failed on chain <I.ext size={12} /></a> : 'signed in and tried here'}</td>
                    <td className="r muted">{ago(t.ts)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <h2 className="h2">Coins that keep {kol.name} out</h2>
      {coins.length ? <div className="coin-grid">{coins.map((c) => <CoinCard key={c.mint} c={c} />)}</div> : (
        <div className="card"><Empty title="No coin keeps them out yet" action={<Link to="/launch" className="btn primary">Launch a coin with No KOLs</Link>}>No coin has put {kol.name} on its list yet.</Empty></div>
      )}
    </div>
  );
}
