// The KOL list: every KOL kolscan tracks (the list comes from NoKol), as a sortable table: followers, wallets, how many
// coins keep them out, and how often their wallets tried to buy anyway.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Fol, I, Spinner, Verified } from '../components/ui';
import type { DirKol } from '../lib/api';
import { useKols } from '../lib/data';

type Key = 'followers' | 'bouncedBy' | 'tries' | 'wallets' | 'name';
const COLS: { key: Key; label: string; cls?: string }[] = [
  { key: 'followers', label: 'Followers' },
  { key: 'wallets', label: 'Wallets', cls: 'hide-s' },
  { key: 'bouncedBy', label: 'On lists' },
  { key: 'tries', label: 'Tried', cls: 'hide-s' },
];
const val = (k: DirKol, key: Key) => (key === 'wallets' ? k.wallets.length : key === 'name' ? k.name.toLowerCase() : k[key]);

export default function Kols() {
  const { data, isLoading } = useKols();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Key>('followers');
  const all = data?.kols || [];
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? all.filter((k) => k.name.toLowerCase().includes(s) || (k.handle || '').toLowerCase().includes(s) || k.wallets.some((w) => w.toLowerCase().startsWith(s))) : all;
    return [...list].sort((a, b) => {
      const x = val(a, sort), y = val(b, sort);
      return sort === 'name' ? String(x).localeCompare(String(y)) : Number(y) - Number(x) || b.followers - a.followers;
    });
  }, [all, q, sort]);
  const rank = useMemo(() => new Map([...all].sort((a, b) => b.followers - a.followers).map((k, i) => [k.id, i + 1])), [all]);

  return (
    <div className="wrap page">
      <header className="page-head">
        <div>
          <h1>The KOL list</h1>
          <p>{all.length.toLocaleString()} KOLs and {all.reduce((s, k) => s + k.wallets.length, 0).toLocaleString()} wallets from kolscan, pump.fun's KOL tracker, with follower counts from X. A coin with No KOLs keeps them out until it bonds. The list comes from NoKol.</p>
        </div>
        <label className="search"><I.search size={15} /><input placeholder="Name, @handle or wallet" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </header>
      {isLoading ? <div className="page-load"><Spinner size={20} /></div> : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th className="n">#</th>
                <th><button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>KOL</button></th>
                {COLS.map((c) => <th key={c.key} className={`r ${c.cls || ''}`}><button className={sort === c.key ? 'on' : ''} onClick={() => setSort(c.key)}>{c.label}</button></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id} className="link" onClick={() => nav(`/kol/${k.id}`)}>
                  <td className="n dim mono">{rank.get(k.id)}</td>
                  <td>
                    <Link to={`/kol/${k.id}`} className="who-cell" onClick={(e) => e.stopPropagation()}>
                      <Avatar src={k.pfp} name={k.name} size={30} />
                      <span><b>{k.name}{k.verified && <Verified />}</b><span className="dim">{k.handle ? `@${k.handle}` : 'no X handle'}</span></span>
                    </Link>
                  </td>
                  <td className="r">{k.followers ? <Fol n={k.followers} /> : <span className="dim">—</span>}</td>
                  <td className="r mono hide-s">{k.wallets.length}</td>
                  <td className={`r mono ${k.bouncedBy ? 'red' : 'dim'}`}>{k.bouncedBy || '—'}</td>
                  <td className="r mono hide-s">{k.tries || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted" style={{ padding: 24, margin: 0 }}>No KOL matches "{q}".</p>}
        </div>
      )}
      <p className="footnote">A list stops wallets, not people: a KOL can always buy from a wallet nobody knows about.{data?.updated ? ` Directory refreshed ${new Date(data.updated).toLocaleDateString()}.` : ''}</p>
    </div>
  );
}
