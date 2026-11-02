// The worker's API, typed the way the pages use it.
let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data: any) { super(message); this.status = status; this.data = data; }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body && typeof init.body === 'string') headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...init, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || `Request failed (${r.status})`, j);
  return j as T;
}
const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export type Kol = { id: string; name: string; handle: string | null; followers: number; verified: boolean; pfp: string | null; wallets: string[] };
export type DirKol = Kol & { bouncedBy: number; bouncingNow: number; tries: number };
export type MiniKol = { id?: string; name: string; handle: string | null; pfp: string | null; followers?: number };
export type RuleId = 'kols' | 'snipers' | 'dev' | 'bundles' | 'maxWallet' | 'vamps';
/** a coin's rules, as the program (and, for vamps, the site) holds them */
export type CoinRules = { kols: boolean; snipers: boolean; dev: boolean; bundles: boolean; maxWalletBps: number; vamps: boolean };
export type Coin = {
  mint: string; creator: string; name: string; symbol: string; description: string | null; image: string | null;
  twitter: string | null; telegram: string | null; website: string | null;
  blocked: number; kolsBlocked: number; kolReach: number; listHash: string | null; kols: MiniKol[];
  status: 'live' | 'complete' | 'migrated'; createdAt: number; signature: string | null;
  shield: { kind: 'linear' | 'exponential'; secs: number } | null; noDevBuy: boolean; noBundles: boolean; maxWalletBps: number; noVamps: boolean;
  rules: CoinRules; ruleCount: number; stopped: number;
  priceSol: number; mcapSol: number; athMcapSol: number; progress: number; volumeSol: number; trades: number; lastTradeAt: number | null;
  completedAt: number | null; pool: string | null; migratedAt: number | null; boughtBack: boolean; buybackSol: number | null; burnedTokens: number | null;
  creatorPaidSol: number;
  /** a dev pass (a Core NFT) holds the creator fees; null: locked to the creator */
  pass?: string | null;
};
export type PassStatus = {
  mint: string; locked: boolean; creator: string; earnsBps: number; paidSol: number; pass: string | null; holder: string | null; burned: boolean;
  owedSol: number; bonded: boolean; payouts: { wallet: string; sol: number; count: number; last: number }[];
};
export type Live = {
  virtualSol: string; virtualToken: string; realSol: string; realToken: string; priceSol: number; progress: number; complete: boolean; migrated: boolean;
  boughtBack: boolean; pool: string | null; creatorFees: number; blocked: number; listHash: string; feeBps: number; creatorFeeBps: number;
  accounts: { curve: string; list: string; vault: string };
  createdAt: number; creator: string; shieldKind: number; shieldSecs: number; noDevBuy: boolean; feeNowBps: number;
  noBundles?: boolean; maxWalletBps?: number; createdSlot?: number;
};
export type Config = {
  siteName: string; siteUrl: string; xHandle: string; programId: string; publicRpc?: string | null; launches: boolean; listMax: number; kolMinFollowers: number;
  devBuyMaxSol: number; slippageBps: number; feeBps: number; creatorFeeBps: number; bondSol: number; supply: number; curveTokens: number;
  migrationFeeSol: number; curve: { virtualSol: string; virtualToken: string; realToken: string; feeBps: number; creatorFeeBps: number };
  listRent: { base: number; perWallet: number }; solUsd: number | null; kolsUpdated: string; shieldRange: { linear: [number, number]; exponential: [number, number] };
  maxWalletRange?: [number, number];
  rulesDefault?: { kols: boolean; snipers: boolean; dev: boolean; bundles: boolean; maxWalletBps: number; vamps: boolean };
  shieldDefault?: { kind: 'linear' | 'exponential'; secs: number };
  kolCount?: number; sourceUrl?: string | null; testCount?: number; e2eCount?: number;
  /** our own coin (launched on LaunchLab), shown once set */
  tokenMint?: string | null; tokenSymbol?: string | null;
};
export type Stats = { coins: number; bonded: number; kolBounces: number; listed: number; wallets: number; volumeSol: number; tries: number; kols: number; stopped?: number; avgRules?: number };
export type FeedEvent = { kind: 'launch' | 'bounce' | 'stop' | 'bond' | 'buy'; ts: number; coin: { mint: string; name: string; symbol: string; image: string | null }; wallet?: string; kol?: MiniKol | null; sol?: number; blocked?: number; kols?: number; rule?: RuleId };
export type StopEvent = { ts: number; wallet: string; rule: 'kols' | 'dev' | 'bundles' | 'maxWallet'; sol: number | null; sig: string | null; source: 'chain' | 'site'; kol: MiniKol | null };
export type Stops = {
  counts: { kols: number; dev: number; bundles: number; maxWallet: number; vamps: number };
  sniperSol: number; sniperBuys: number; creatorHoldsPct: number | null; topHolderPct: number | null; events: StopEvent[];
};
export type Check = { ok: boolean; reason: string | null };
export type VampCheck = { ticker: Check; name: Check; x: Check | null; picture: Check | null };
export type Trade = { sig: string; wallet: string; side: 'buy' | 'sell'; sol: number; tokens: number; priceSol: number; mcapSol: number; ts: number; kol: MiniKol | null };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Holder = { owner: string | null; amount: number; pct: number; label: string | null; kol: MiniKol | null };
export type DoorList = { count: number; kolWallets: number; reach: number; people: Kol[]; others: string[]; othersCount: number };
export type Prepared = {
  id: string; mint: string; lastValidBlockHeight: number; txs: { kind: 'list' | 'launch'; count: number; tx: string }[]; listed: number; onChain: number;
  cost: { rent: number; list: number; fees: number; devBuy: number; total: number };
};
export type Built = { tx: string; lastValidBlockHeight: number; venue: 'curve' | 'jupiter'; quote: { side: string; solIn?: number; sol?: number; tokens: string; minOut: string; fee?: number; completes?: boolean } };

export type SniperTrade = { sig: string; wallet: string; side: 'buy' | 'sell'; at: number; sol: number; feePct: number; shieldSol: number; creator: boolean; kol: { name: string; pfp: string | null } | null };
export type SniperReplay = { shield: { kind: 'linear' | 'exponential'; secs: number } | null; launchedAt?: number; trades?: SniperTrade[]; taxedSol?: number };
export type SimRun = { wallet: string; ok: boolean; error: string | null; logs: string[]; units: number | null; slot: number | null };
export type Simulation = { mint: string; sol: number; programId: string; bounced: SimRun & { kol: MiniKol | null }; control: SimRun };

export type Range = '24h' | '7d' | '30d' | 'all';
export type Point = { t: number; volume: number; trades: number; launches: number; bounces: number; bouncedSol: number };
export type Analytics = {
  range: Range; bucket: number; start: number; now: number; series: Point[];
  totals: { volume: number; trades: number; traders: number; launched: number; bonded: number; bounces: number; bouncedSol: number; bouncedWallets: number;
    buybackSol: number; shieldSol: number; shieldCoins: number; noDevBuyCoins: number; avgKols: number };
  prev: { volume: number; trades: number; traders: number; launched: number; bonded: number; bounces: number } | null;
  kols: (Kol & { tries: number; sol: number; coins: number; last: number })[];
  strangers: number;
  coins: { mint: string; name: string; symbol: string; image: string | null; status: string; blocked: number; kols: number; progress: number; volume: number; trades: number; traders: number }[];
};
export const api = {
  config: () => call<Config>('/api/config'),
  stats: () => call<Stats>('/api/stats'),
  analytics: (range: Range) => call<Analytics>(`/api/analytics?range=${range}`),
  feed: () => call<{ events: FeedEvent[] }>('/api/feed').then((r) => r.events),
  coins: (o: { sort?: string; q?: string; limit?: number; creator?: string } = {}) =>
    call<{ coins: Coin[] }>(`/api/coins?${new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))}`).then((r) => r.coins),
  coin: (mint: string) => call<{ coin: Coin; live: Live | null }>(`/api/coin/${mint}`),
  list: (mint: string, q = '') => call<DoorList>(`/api/coin/${mint}/list${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  trades: (mint: string) => call<{ trades: Trade[] }>(`/api/coin/${mint}/trades`).then((r) => r.trades),
  candles: (mint: string, tf: string) => call<{ candles: Candle[] }>(`/api/coin/${mint}/candles?tf=${tf}`).then((r) => r.candles),
  holders: (mint: string) => call<{ holders: Holder[] }>(`/api/coin/${mint}/holders`).then((r) => r.holders),
  kols: () => call<{ kols: DirKol[]; updated: string }>('/api/kols'),
  kol: (id: string) => call<{ kol: Kol; coins: Coin[]; tries: { mint: string; name: string; symbol: string; image: string | null; source: string; sig: string | null; sol: number | null; ts: number; wallet: string }[] }>(`/api/kol/${encodeURIComponent(id)}`),
  check: (wallet: string) => call<{ wallet: string; kol: Kol | null; coins: Coin[] }>(`/api/check/${wallet}`),
  balance: (wallet: string, mint?: string) => call<{ sol: number; raw: string }>(`/api/balance/${wallet}${mint ? `?mint=${mint}` : ''}`),
  upload: async (file: Blob) => {
    const r = await fetch('/api/upload', { method: 'POST', body: file, headers: { 'content-type': file.type || 'image/png' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, j.error || 'Upload failed', j);
    return j as { url: string; path: string; hash: string | null };
  },
  stops: (mint: string) => call<Stops>(`/api/coin/${mint}/stops`),
  pass: (mint: string) => call<PassStatus>(`/api/coin/${mint}/pass`),
  vampCheck: (b: { symbol?: string; name?: string; twitter?: string; imageHash?: string | null }) => post<VampCheck>('/api/vamp-check', b),
  prepare: (b: Record<string, unknown>) => post<Prepared>('/api/launch/prepare', b),
  /** streams the launch's progress, one JSON line a step */
  submit: async (id: string, txs: string[], onStep: (s: any) => void) => {
    const r = await fetch(`/api/launch/${id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txs }) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new ApiError(r.status, j.error || 'The launch could not be sent.', j); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', last: any = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        last = JSON.parse(line);
        onStep(last);
      }
    }
    return last;
  },
  closeList: (id: string, creator: string) => post<{ tx: string; lastValidBlockHeight: number; refund: number }>(`/api/launch/${id}/close`, { creator }),
  trade: (b: Record<string, unknown>) => post<Built>('/api/trade', b),
  send: (tx: string, lastValidBlockHeight?: number) => post<{ signature: string }>('/api/send', { tx, lastValidBlockHeight }),
  ingest: (sig: string) => post('/api/ingest', { sig }).catch(() => null),
  sniper: (mint: string) => call<SniperReplay>(`/api/coin/${mint}/sniper`),
  simulate: (mint: string, wallet?: string) => post<Simulation>('/api/simulate', { mint, wallet }),
  authMessage: (wallet: string) => call<{ message: string }>(`/api/auth/message?wallet=${wallet}`),
  authVerify: (wallet: string, message: string, signature: string) => post<{ token: string }>('/api/auth/verify', { wallet, message, signature }),
};
