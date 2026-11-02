// Every knob in one place. Each key can be overridden by a wrangler var (or secret) of the same name.
import { DEFAULT_PARAMS, MAX_WALLET_RANGE, PROGRAM_ID, SHIELD_RANGE, bondSol, listRent } from './program.js';
import { PEOPLE } from './kols.js';

const DEFAULTS = {
  SITE_NAME: 'strict.fun',
  SITE_URL: 'https://strict.fun',
  X_HANDLE: 'strictdotfun',
  // our own coin, launched elsewhere (Raydium LaunchLab): its contract address and ticker show in the top bar and on the
  // home page once set (blank: nothing shows)
  TOKEN_MINT: '',
  TOKEN_SYMBOL: '',
  // the public repo the "Show the code" panels link to (blank: no link until it's published)
  SOURCE_URL: '',
  // the RPC the browser checks coins and the program against, independently of this worker (blank: public mainnet
  // RPCs). Local dev points it at the local validator.
  PUBLIC_RPC: '',
  RPC_URL: 'https://solana-rpc.publicnode.com', // a secret in production (Helius)
  // the platform's fee wallet: the program's fee_recipient (set at initialize; this copy is what trades are built with)
  FEE_WALLET: '',
  // the crank: sends migrate, buyback and creator payouts (OPS_SECRET signs; it needs ~0.05 SOL for fees)
  OPS_WALLET: '',
  LAUNCHES: '0', // "1" once the program is deployed and initialized on mainnet and the domain is live
  LAUNCH_DAILY_MAX: '500',
  LAUNCH_COOLDOWN_MIN: '2', // one launch per wallet this often
  LIST_MAX: '1000', // the program's max_list
  DEV_BUY_MAX_SOL: '20',
  SLIPPAGE_BPS: '500',
  PRIORITY_MICROLAMPORTS: '120000',
  KOL_MIN_FOLLOWERS: '10000', // the launch page's default: every KOL with at least this many X followers
  CRANK: '1', // "0" pauses migrate / buyback / payouts (anyone can still send them by hand)
  PAYOUT_MIN_SOL: '0.01', // creator fees are paid out once a coin owes this much
  JUP_BASE: 'https://lite-api.jup.ag',
  // the launch page's starting picks (each rule stays the creator's choice)
  SHIELD_DEFAULT_KIND: 'linear', // linear (a straight line, 10-300 s) or exponential (fast, 5-30 s)
  SHIELD_DEFAULT_SECS: '60',
  MAX_WALLET_DEFAULT_BPS: '200',
  // checks in program/tests/run.mjs, quoted on the pages
  TEST_COUNT: '77',
  E2E_COUNT: '57',
};

export function cfg(env = {}) {
  const v = (k) => (env[k] != null && env[k] !== '' ? env[k] : DEFAULTS[k]);
  const n = (k) => Number(v(k));
  return {
    siteName: String(v('SITE_NAME')),
    siteUrl: String(v('SITE_URL')).replace(/\/$/, ''),
    xHandle: String(v('X_HANDLE')),
    tokenMint: String(v('TOKEN_MINT') || '').trim() || null,
    tokenSymbol: String(v('TOKEN_SYMBOL') || '').trim().replace(/^\$/, '').toUpperCase() || null,
    sourceUrl: String(v('SOURCE_URL') || '').replace(/\/$/, '') || null,
    publicRpc: String(v('PUBLIC_RPC') || '').trim() || null,
    rpcUrl: v('RPC_URL'),
    feeWallet: v('FEE_WALLET') || null,
    opsWallet: v('OPS_WALLET') || null,
    launches: String(v('LAUNCHES')) !== '0',
    launchDailyMax: n('LAUNCH_DAILY_MAX'),
    launchCooldownMs: n('LAUNCH_COOLDOWN_MIN') * 60_000,
    listMax: n('LIST_MAX'),
    devBuyMaxLamports: Math.round(n('DEV_BUY_MAX_SOL') * 1e9),
    slippageBps: n('SLIPPAGE_BPS'),
    priority: n('PRIORITY_MICROLAMPORTS'),
    kolMinFollowers: n('KOL_MIN_FOLLOWERS'),
    crank: String(v('CRANK')) !== '0',
    payoutMinLamports: Math.round(n('PAYOUT_MIN_SOL') * 1e9),
    jupBase: String(v('JUP_BASE')),
    shieldDefaultKind: String(v('SHIELD_DEFAULT_KIND')) === 'exponential' ? 'exponential' : 'linear',
    shieldDefaultSecs: n('SHIELD_DEFAULT_SECS'),
    maxWalletDefaultBps: n('MAX_WALLET_DEFAULT_BPS'),
    testCount: n('TEST_COUNT'),
    e2eCount: n('E2E_COUNT'),
    params: DEFAULT_PARAMS,
  };
}

/** What the page needs to know: names, the program, the curve, what a list costs, the rules' ranges and defaults. */
export function publicConfig(env) {
  const c = cfg(env);
  const p = c.params;
  return {
    siteName: c.siteName, siteUrl: c.siteUrl, xHandle: c.xHandle, sourceUrl: c.sourceUrl, publicRpc: c.publicRpc,
    tokenMint: c.tokenMint, tokenSymbol: c.tokenSymbol,
    programId: PROGRAM_ID.toBase58(),
    launches: c.launches && !!c.feeWallet,
    listMax: c.listMax,
    kolMinFollowers: c.kolMinFollowers,
    devBuyMaxSol: c.devBuyMaxLamports / 1e9,
    slippageBps: c.slippageBps,
    feeBps: p.feeBps, creatorFeeBps: p.creatorFeeBps,
    bondSol: bondSol(p),
    supply: Number(p.tokenSupply) / 1e6,
    curveTokens: Number(p.realToken) / 1e6,
    migrationFeeSol: Number(p.migrationFee) / 1e9,
    curve: { virtualSol: String(p.virtualSol), virtualToken: String(p.virtualToken), realToken: String(p.realToken), feeBps: p.feeBps, creatorFeeBps: p.creatorFeeBps },
    // a list's storage: rent for the header plus 32 bytes a wallet (exact lamports: listRent(n) in program.js)
    listRent: { base: listRent(1) - 32 * 6960, perWallet: 32 * 6960 },
    shieldRange: SHIELD_RANGE,
    shieldDefault: { kind: c.shieldDefaultKind, secs: c.shieldDefaultSecs },
    maxWalletRange: MAX_WALLET_RANGE,
    maxWalletDefaultBps: c.maxWalletDefaultBps,
    rulesDefault: { kols: true, snipers: true, dev: true, bundles: true, maxWalletBps: 0, vamps: false },
    kolCount: PEOPLE.length,
    testCount: c.testCount, e2eCount: c.e2eCount,
  };
}
