// The rules, in plain English: for each one, what it stops, how it works, and the code that does it, opened in place.
// Then how to check all of it yourself, the audit, and what the rules can't do.
import { Link } from 'react-router-dom';
import { CodeTour, Pipeline } from '../components/Engine';
import { HowPossible } from '../components/HowPossible';
import { LockBanner } from '../components/RuleCard';
import { RuleCode } from '../components/RuleCode';
import { TrustRow } from '../components/Trust';
import { Checked, RuleIcon } from '../components/ui';
import { useConfig } from '../lib/data';
import { rulesFor } from '../lib/rules';

export default function Rules() {
  const { data: cfg } = useConfig();
  const list = rulesFor(cfg);
  return (
    <div className="wrap page rules-page">
      <header className="rules-hero">
        <span className="eyebrow">The rules</span>
        <h1>The rules, in plain English.</h1>
        <p className="lede">Six rules a creator can pick. What each one stops, how it works, and the code that does it.</p>
      </header>

      <LockBanner />

      {list.map((r, i) => (
        <article key={r.id} className="rule-article" id={r.id}>
          <div className="ra-name">
            <span className="ra-num"><RuleIcon id={r.id} /><span className="mono faint">Rule {i + 1}</span></span>
            <h2>{r.id === 'maxWallet' ? 'Max wallet' : r.title}</h2>
            <Checked onChain={r.onChain}>{r.onChain ? 'Checked on chain, every buy' : 'Checked by strict.fun at launch'}</Checked>
          </div>
          <div className="ra-col"><span className="ra-l">What it stops</span><p>{r.stops}</p></div>
          <div className="ra-col">
            <span className="ra-l">How it works</span>
            <p>{r.id === 'maxWallet' ? `${r.how.replace(/2%/g, 'the cap')} The creator picks the cap, from 0.5% to 10% of the supply.` : r.how}</p>
            {r.id === 'kols' && <Link to="/kols" className="small">See the list →</Link>}
          </div>
          <div className="ra-code"><RuleCode rule={r.id} /></div>
        </article>
      ))}

      <section className="section fees-rule" id="fees">
        <div className="limits-box">
          <b>One more thing fixed at launch: where the creator fees go</b>
          <ul>
            <li><b>Locked to the creator</b> (the default): the {cfg ? cfg.creatorFeeBps / 100 : 0.3}% of every trade that's the creator's goes to the wallet that launched the coin. The program pays nobody else, ever.</li>
            <li><b>Dev pass NFT</b> (Advanced, on the launch page): it goes to whoever holds a 1-of-1 Metaplex Core NFT minted to the creator at launch. The program reads the NFT's owner at every payout, so selling or sending it hands the fees on. The pass has no plugins and only the coin's curve can update it, so nobody can take it back.</li>
          </ul>
        </div>
      </section>

      <HowPossible />
      <Pipeline />
      <CodeTour />

      <section className="section check-us">
        <TrustRow title="How to check us" sub="Every rule above is enforced by a program you can read and verify." />
        <div className="limits-box">
          <b>What the rules can't do</b>
          <ul>
            <li>A list stops wallets, not people. A KOL can use a wallet that isn't listed.</li>
            <li>Tokens are normal Solana tokens: someone can still send them to a listed wallet.</li>
            <li>Max wallet limits buys, not transfers between wallets.</li>
            <li>No vamps is a site check at launch, not a program rule.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
