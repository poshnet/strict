// The rules, in the words every page uses: what each one does, why, what it stops and how it works. Five are checked
// by the program on every buy; no vamps is a check this site runs when a coin is created. Keep the copy here so the
// home page, the launch page, the coin page and the rules page all say the same thing.
import type { Coin, CoinRules, Config, RuleId } from './api';
import { bpsPct } from './format';

export type Rule = {
  id: RuleId;
  title: string;
  /** one sentence: what the rule does */
  plain: string;
  /** the second sentence: why it matters */
  why: string;
  /** what it stops (rules page) */
  stops: string;
  /** how it works (rules page) */
  how: string;
  /** a few words, for previews and chips */
  short: string;
  /** checked by the program on every buy (false: a site check at launch) */
  onChain: boolean;
};

export const DEFAULT_KOLS = 562;
export const DEFAULT_MAX_WALLET_BPS = 200;
export const MAX_WALLET_CHOICES = [50, 100, 200, 300, 500, 1000];

/** the rules' copy, with the KOL count and the max wallet filled in */
export function rules(o: { kols?: number; maxWalletBps?: number } = {}): Rule[] {
  const n = (o.kols || DEFAULT_KOLS).toLocaleString();
  const mw = bpsPct(o.maxWalletBps || DEFAULT_MAX_WALLET_BPS);
  return [
    {
      id: 'kols', title: 'No KOLs', onChain: true, short: `${n} KOL wallets can't buy`,
      plain: `${n} known KOL wallets can't buy until the coin bonds. Add any other wallet you want kept out.`,
      why: 'Their buys are refused by the program, from any app or bot.',
      stops: 'Paid callers buying early and dumping on the people they told to buy.',
      how: `${n} known KOL wallets are on a list, plus any the creator adds. The list is sealed when the coin launches. Until the coin bonds, any buy from a listed wallet fails, from any app or bot.`,
    },
    {
      id: 'snipers', title: 'No snipers', onChain: true, short: 'Early buys pay up to 99%',
      plain: 'Buying in the first seconds costs up to 99% in fees, falling to the normal 1%.',
      why: 'Bots that snipe the launch pay for it. Their fees buy back and burn the coin when it bonds.',
      stops: 'Bots that buy in the first second, before a person can even click.',
      how: "The fee starts at 99% when the coin launches and falls every second to the normal 1%. Whatever snipers pay waits in the coin's vault, and buys back and burns the coin when it bonds.",
    },
    {
      id: 'dev', title: 'No dev buy', onChain: true, short: 'The creator holds nothing',
      plain: "The creator's wallet can't buy its own coin until it bonds.",
      why: 'No hidden dev bag sitting in the first block, waiting to dump.',
      stops: 'A creator buying a big bag at the bottom and selling it into the first buyers.',
      how: "The program refuses any buy signed by the creator's wallet until the coin bonds. Anyone can see the creator holds nothing.",
    },
    {
      id: 'bundles', title: 'No bundles', onChain: true, short: 'Nothing bought in the launch block',
      plain: 'Nobody can buy in the same block the coin is created.',
      why: "Stops a launch being bought up by one person's wallets before anyone else can see it.",
      stops: "One person using many wallets to buy the launch in the same moment it's created.",
      how: "The coin remembers the block it was created in. Any buy in that block fails, the creator's included. Everyone starts from the next block.",
    },
    {
      id: 'maxWallet', title: `Max wallet ${mw}`, onChain: true, short: `No wallet over ${mw} before it bonds`,
      plain: `No wallet can buy more than ${mw} of the supply until the coin bonds.`,
      why: 'Spreads the coin across more holders instead of a few whales.',
      stops: 'A few whales buying up most of the supply before the coin bonds.',
      how: `A buy that would take a wallet past ${mw} of the supply fails. Selling is never capped, and the cap lifts when the coin bonds.`,
    },
    {
      id: 'vamps', title: 'No vamps', onChain: false, short: 'No copycat coins',
      plain: "Nobody can launch a copy of the coin's name, ticker, X account or picture while it's live.",
      why: 'Lookalikes count too: $P3PE is $PEPE.',
      stops: "Copycat coins that steal a live coin's name, ticker, X account or picture.",
      how: 'When a coin is created here, strict.fun compares it with every coin that picked this rule: the ticker and name folded for lookalikes, the X account, and a fingerprint of the picture. This one is a site check at launch, not on chain.',
    },
  ];
}

export const rulesFor = (cfg?: Config, maxWalletBps?: number) => rules({ kols: cfg?.kolCount, maxWalletBps });

/** the picks a creator makes (the home page's switches, the launch page's checklist) */
export type Picks = { kols: boolean; snipers: boolean; dev: boolean; bundles: boolean; maxWallet: boolean; vamps: boolean };
export const DEFAULT_PICKS: Picks = { kols: true, snipers: true, dev: true, bundles: true, maxWallet: false, vamps: false };
export const pickCount = (p: Picks) => Object.values(p).filter(Boolean).length;

/** picks in a URL: /launch?rules=kols,snipers&mw=200 */
export function picksToQuery(p: Picks, maxWalletBps: number) {
  const on = (Object.keys(p) as RuleId[]).filter((k) => p[k]);
  return `rules=${on.join(',')}${p.maxWallet ? `&mw=${maxWalletBps}` : ''}`;
}
export function picksFromQuery(s: URLSearchParams): { picks: Picks; maxWalletBps: number } | null {
  const r = s.get('rules');
  if (r == null) return null;
  const on = new Set(r.split(',').filter(Boolean));
  const picks = { kols: on.has('kols'), snipers: on.has('snipers'), dev: on.has('dev'), bundles: on.has('bundles'), maxWallet: on.has('maxWallet'), vamps: on.has('vamps') };
  const mw = Number(s.get('mw'));
  return { picks, maxWalletBps: MAX_WALLET_CHOICES.includes(mw) ? mw : DEFAULT_MAX_WALLET_BPS };
}

/** a coin's rules as switches (falls back to the older fields when `rules` is missing) */
export function coinRules(c: Coin): CoinRules {
  return c.rules || { kols: c.blocked > 0, snipers: !!c.shield, dev: !!c.noDevBuy, bundles: !!c.noBundles, maxWalletBps: c.maxWalletBps || 0, vamps: !!c.noVamps };
}
export const isOn = (r: CoinRules, id: RuleId) => (id === 'maxWallet' ? r.maxWalletBps > 0 : !!r[id]);

/** the rules a coin picked, as short labels in order */
export function coinRuleLabels(c: Coin): string[] {
  const r = coinRules(c);
  return rules({ maxWalletBps: r.maxWalletBps }).filter((x) => isOn(r, x.id)).map((x) => x.title);
}
