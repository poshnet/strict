// A rule, spelled out: its icon, its name, what it does and why, whether it's checked on chain or by the site, and its
// code one click away. With `onToggle` it carries an on/off switch (the home page's rule picker).
import type { ReactNode } from 'react';
import type { Rule } from '../lib/rules';
import { ruleLine } from './Engine';
import { RuleCode, tokens } from './RuleCode';
import { Checked, RuleIcon, Switch } from './ui';

export function RuleCard({ rule, on = true, onToggle, extra }: { rule: Rule; on?: boolean; onToggle?: (v: boolean) => void; extra?: ReactNode }) {
  return (
    <article className={`rule-card${on ? '' : ' off'}`}>
      <div className="rule-card-top">
        <RuleIcon id={rule.id} off={!on} />
        {onToggle && <Switch on={on} onChange={onToggle} label={rule.title} text />}
      </div>
      <h3>{rule.title}</h3>
      <p className="rule-plain">{rule.plain}</p>
      <p className="rule-why">{rule.why}</p>
      {extra}
      <RuleLine id={rule.id} />
      <div className="rule-card-foot">
        <Checked onChain={rule.onChain} />
      </div>
      <RuleCode rule={rule.id} label="Show all of it" />
    </article>
  );
}

/** the line of code that enforces the rule, always in view */
export function RuleLine({ id }: { id: Rule['id'] }) {
  const l = ruleLine(id);
  if (!l) return null;
  return (
    <div className="rule-line" title={l.code}>
      <i aria-hidden>{l.n}</i>
      <code>{tokens(l.code, l.js)}</code>
    </div>
  );
}

/** the rule behind the rules: they lock at launch */
export function LockBanner({ light }: { light?: boolean }) {
  return (
    <div className={`lock-banner${light ? ' light' : ''}`}>
      <span className="lock-ic" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </span>
      <div className="lock-text">
        <b>And the rule behind the rules: they lock at launch.</b>
        <span>Once a coin is live, nobody can turn a rule off or change it. Not the creator, not strict.fun.</span>
        <RuleCode rule="lock" label="Show the code that locks them" note="The launch seals the coin's list and writes its rules into the coin's account. No instruction can write to a sealed list, and no instruction changes a coin's rules." />
      </div>
    </div>
  );
}
