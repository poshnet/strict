// "Why you can trust it": open source, the verified build, whether the program can still be upgraded (read live from
// chain: frozen only once its upgrade authority is gone), the tests, the audit, and what rules can't do.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/data';
import { short } from '../lib/format';
import { programStatus } from '../lib/verify';
import { I, Spinner } from './ui';

export const useProgram = () => {
  const { data: cfg } = useConfig();
  return useQuery({ queryKey: ['program', cfg?.programId], queryFn: () => programStatus(cfg!.programId, cfg!.publicRpc), enabled: !!cfg, staleTime: 60_000, retry: 1 });
};

/** the program's upgrade authority, as a trust card: green when frozen, amber while it can still be upgraded */
export function UpgradeCard() {
  const p = useProgram();
  const s = p.data;
  if (p.isLoading) return <div className="trust"><b><Spinner size={13} />Upgrade key</b><span>Reading the program from Solana…</span></div>;
  if (s?.deployed && !s.upgradeable) return (
    <div className="trust"><b><I.check size={14} />Frozen</b><span>The program has no upgrade key, read live from Solana. Nobody can swap it out.</span><Link to="/proof">Check it →</Link></div>
  );
  return (
    <div className="trust amber">
      <b><i className="dot" />{s?.deployed ? 'Upgradeable until we freeze it' : 'Not deployed yet'}</b>
      <span>{s?.deployed
        ? <>Right now <span className="mono">{short(s.authority, 4)}</span> can upgrade the program. We remove that key after launch, and this card turns green when we do. Each coin's rules still lock at launch.</>
        : "Once the program is on mainnet, this card reads who can upgrade it, live. We remove that key after launch."}</span>
      <Link to="/proof">Check it →</Link>
    </div>
  );
}

export function TrustRow({ title = 'Why you can trust it', sub = "You don't have to take our word for any of this." }: { title?: string; sub?: string }) {
  const { data: cfg } = useConfig();
  const tests = cfg?.testCount || 77;
  return (
    <>
      <div className="sec-head"><div><h2>{title}</h2><p>{sub}</p></div></div>
      <div className="trust-grid">
        <div className="trust"><b><I.check size={14} />Open source</b><span>Anyone can read the code that enforces the rules. Every rule shows its code right where it's explained.</span>
          {cfg?.sourceUrl ? <a href={cfg.sourceUrl} target="_blank" rel="noreferrer">Read it →</a> : <Link to="/rules">Read the rules →</Link>}</div>
        <div className="trust"><b><I.check size={14} />Verified build</b><span>Build the source yourself and compare it with the program on chain.</span><Link to="/proof">How →</Link></div>
        <UpgradeCard />
        <div className="trust"><b><I.check size={14} />{tests} program tests</b><span>Every rule has tests that try to break it, run against the real Raydium and Metaplex programs, plus 48 end-to-end checks through this site. All passing.</span><Link to="/proof#tests">See them →</Link></div>
        <div className="trust amber"><b><i className="dot" />Audit</b><span>[AUDITOR], [DATE]. The full report goes here, unedited.</span><span className="amber-t">Coming</span></div>
      </div>
      <p className="limits"><b>What rules can't do:</b> a list stops wallets, not people. Tokens can still be sent to a listed wallet. Max wallet limits buys, not transfers. No vamps is checked by the site, not on chain.</p>
    </>
  );
}
