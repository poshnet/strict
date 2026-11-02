// "How is this possible?": the plain-English answer to "this sounds too good", in four steps, for people who don't read
// Rust. The intro opens it in place; /rules shows it in full. Every claim maps to the program: the full supply has to
// sit in the coin's vault with no mint or freeze key (create), there's no instruction that edits a coin's rules, and buy
// checks them before any token moves. What we still hold (the upgrade key) is read live, not assumed.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProgram } from './Trust';
import { I } from './ui';

const STEPS = [
  { t: 'The rules are part of the coin.', d: "The launch is one transaction: it creates the coin and writes its rules into the coin's own account on Solana. Only the strict program can write to that account." },
  { t: "There's no edit button.", d: "The program has no instruction that changes a coin's rules after launch. Not for the creator, not for us. Its whole list of instructions is public." },
  { t: 'Every buy goes through the program.', d: "Until it bonds, every token sits in the program's vault and nobody can mint more, so the program is the only seller. It checks the buyer first; if a rule says no, the whole transaction fails and the buyer keeps their SOL." },
  { t: 'You can check it yourself.', d: "Your browser reads any coin's rules straight from Solana, not from our server. Every stopped buy is a failed transaction anyone can look up." },
];

/** what we still control, read live: the program's upgrade key */
function StillHeld() {
  const s = useProgram().data;
  if (s?.deployed && !s.upgradeable) return <p className="hp-held green-t"><I.check size={13} />The program is frozen: nobody, us included, can change it. Read live from Solana.</p>;
  return (
    <p className="hp-held"><i className="dot" /><span><b>What we still hold:</b> the program's upgrade key, for now. We remove it after launch, and every coin page shows that live. Rules end when a coin bonds: on Raydium it trades like any token.</span></p>
  );
}

export function HowPossible({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const body = (
    <>
      <ol className="hp-steps">
        {STEPS.map((s, i) => (
          <li key={s.t}><span className="hp-n mono">{i + 1}</span><span><b>{s.t}</b><span>{s.d}</span></span></li>
        ))}
      </ol>
      <StillHeld />
    </>
  );
  if (compact) return (
    <div className={`hp compact${open ? ' open' : ''}`}>
      <button type="button" className="hp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I.info size={14} />How is this possible?<span className="hp-chev" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && <div className="hp-body">{body}</div>}
    </div>
  );
  return (
    <section className="hp section" id="how">
      <div className="sec-head"><div>
        <h2>How is this possible?</h2>
        <p>No magic and no promises. It's the same building block every launchpad's bonding curve already uses; strict.fun puts checks in front of the trade.</p>
      </div></div>
      {body}
      <Link to="/proof" className="small">How to check all of this yourself →</Link>
    </section>
  );
}
