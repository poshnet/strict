// Am I on a list? Paste a wallet (or connect one): every coin whose KOL list keeps it out until it bonds.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CoinCard } from '../components/CoinCard';
import { Avatar, Empty, I, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { isAddress } from '../lib/b58';
import { followers } from '../lib/data';
import { useWallet } from '../lib/wallet';

export default function Check() {
  const [params, setParams] = useSearchParams();
  const w = useWallet();
  const wallet = params.get('w') || '';
  const [v, setV] = useState(wallet);
  useEffect(() => setV(wallet), [wallet]);
  const q = useQuery({ queryKey: ['check', wallet], queryFn: () => api.check(wallet), enabled: isAddress(wallet) });
  const live = q.data?.coins.filter((c) => c.status === 'live') || [];
  const submit = (x: string) => { if (isAddress(x.trim())) setParams({ w: x.trim() }); };

  return (
    <div className="wrap narrow page">
      <header className="page-head">
        <div>
          <h1>Am I on a list?</h1>
          <p>Paste any Solana wallet to see every coin whose list keeps it out until the coin bonds.</p>
        </div>
      </header>
      <div className="check-row">
        <label className="search big"><I.search size={16} /><input placeholder="Wallet address" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(v)} /></label>
        <button className="btn primary l" disabled={!isAddress(v.trim())} onClick={() => submit(v)}>Check</button>
        {w.address && w.address !== wallet && <button className="btn ghost l" onClick={() => submit(w.address!)}>My wallet</button>}
      </div>
      {q.isLoading && <div className="page-load"><Spinner size={22} /></div>}
      {q.data && (
        <>
          <div className="card pad" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
            {q.data.kol ? <Avatar src={q.data.kol.pfp} name={q.data.kol.name} size={64} /> : <Avatar name="?" seed={wallet} size={64} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 18 }}>{q.data.kol ? q.data.kol.name : 'This wallet'}</b>
              <div className="muted mono" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{wallet}</div>
              {q.data.kol && <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>A tracked KOL wallet{q.data.kol.handle ? ` (@${q.data.kol.handle}, ${followers(q.data.kol.followers)} followers)` : ''}.</div>}
            </div>
            {live.length ? <span className="pill-s stop big">On {live.length} list{live.length === 1 ? '' : 's'}</span> : <span className="pill-s on big">On no list</span>}
          </div>
          {q.data.coins.length ? (
            <>
              <h2 className="h2">{live.length ? `Kept out of ${live.length} coin${live.length === 1 ? '' : 's'} right now` : 'Was kept out of these, before they bonded'}</h2>
              <div className="coin-grid">{q.data.coins.map((c) => <CoinCard key={c.mint} c={c} />)}</div>
            </>
          ) : <Empty title="Not on any list">No coin on strict.fun keeps this wallet out.</Empty>}
        </>
      )}
    </div>
  );
}
