-- strict.fun: every coin on the strict program, the rules it launched with, its sealed list, its trades, and every buy a
-- rule stopped. (The schema started as NoKol's; the pump.fun parts are gone and the rules are new.)

-- One row per coin, from the launch (this site) or the indexer (a coin made straight on the program). Reserves are the
-- curve's raw numbers as text; prices and caps are in SOL.
CREATE TABLE coins (
  mint TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT,
  image TEXT,
  twitter TEXT,
  telegram TEXT,
  website TEXT,
  -- the rules, as the program stores them (no vamps is this site's own check at launch)
  blocked INTEGER NOT NULL DEFAULT 0,        -- no KOLs: wallets on the sealed list
  kols_blocked INTEGER NOT NULL DEFAULT 0,   -- of those, wallets in the KOL directory
  kol_reach INTEGER NOT NULL DEFAULT 0,      -- X followers of the KOLs on the list (each handle once)
  top_kols TEXT,                             -- JSON: the most followed KOLs on the list (directory ids), for the cards
  list_hash TEXT,                            -- sha256 of the list's wallets in order, as the curve stores it
  shield_kind INTEGER NOT NULL DEFAULT 0,    -- no snipers: 0 none, 1 linear, 2 exponential (99% down to the normal fee)
  shield_secs INTEGER NOT NULL DEFAULT 0,
  no_dev_buy INTEGER NOT NULL DEFAULT 0,     -- the creator's wallet can't buy before it bonds
  no_bundles INTEGER NOT NULL DEFAULT 0,     -- nothing buys in the launch slot
  max_wallet_bps INTEGER NOT NULL DEFAULT 0, -- no wallet buys past this share of the supply before it bonds (0: no cap)
  no_vamps INTEGER NOT NULL DEFAULT 0,       -- while it's live, no new coin may copy its ticker, name, X account or picture
  rule_count INTEGER NOT NULL DEFAULT 0,     -- how many of the six it picked (the board's "strictest" sort)
  stopped INTEGER NOT NULL DEFAULT 0,        -- buys a rule refused (on chain or here)
  -- the anti-vamp keys (worker/vamp.js)
  ticker_key TEXT,
  name_key TEXT,
  x_key TEXT,
  img_hash TEXT,
  status TEXT NOT NULL DEFAULT 'live',       -- 'live' | 'complete' | 'migrated'
  signature TEXT,
  created_at INTEGER NOT NULL,               -- ms
  launched_at INTEGER,                       -- unix seconds on chain: the curve's created_at, where its sniper curve starts
  created_slot INTEGER,                      -- the slot it was created in (no bundles)
  virtual_sol TEXT,
  virtual_token TEXT,
  real_sol TEXT,
  real_token TEXT,
  price_sol REAL,
  mcap_sol REAL,
  ath_mcap_sol REAL,
  progress REAL NOT NULL DEFAULT 0,
  volume_sol REAL NOT NULL DEFAULT 0,
  trades INTEGER NOT NULL DEFAULT 0,
  last_trade_at INTEGER,
  completed_at INTEGER,
  pool TEXT,
  migrated_at INTEGER,
  migrate_error TEXT,
  bought_back INTEGER NOT NULL DEFAULT 0,
  buyback_sol REAL,
  burned_tokens REAL,
  creator_paid_sol REAL NOT NULL DEFAULT 0,
  updated_at INTEGER
);
CREATE INDEX coins_created ON coins(created_at DESC);
CREATE INDEX coins_trade ON coins(last_trade_at DESC);
CREATE INDEX coins_status ON coins(status, progress DESC);
CREATE INDEX coins_creator ON coins(creator);
CREATE INDEX coins_strict ON coins(rule_count DESC, created_at DESC);
CREATE INDEX coins_vamp_ticker ON coins(ticker_key) WHERE no_vamps = 1;
CREATE INDEX coins_vamp_name ON coins(name_key) WHERE no_vamps = 1;
CREATE INDEX coins_vamp_x ON coins(x_key) WHERE no_vamps = 1;

-- Each coin's sealed list, one row a wallet: "who does this coin keep out" and "which coins keep this wallet out"
CREATE TABLE coin_list (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  PRIMARY KEY (mint, wallet)
) WITHOUT ROWID;
CREATE INDEX coin_list_wallet ON coin_list(wallet);

-- Curve trades, from the program's events
CREATE TABLE trades (
  sig TEXT NOT NULL,
  ix INTEGER NOT NULL,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  is_buy INTEGER NOT NULL,
  sol INTEGER NOT NULL,        -- lamports into the curve (buy, after fees) or out of it (sell, before fees)
  tokens INTEGER NOT NULL,     -- raw (6 decimals)
  price_sol REAL NOT NULL,     -- after the trade
  mcap_sol REAL NOT NULL,
  fee_total INTEGER NOT NULL DEFAULT 0, -- lamports: platform + creator + sniper fee
  ts INTEGER NOT NULL,         -- ms
  PRIMARY KEY (sig, ix)
);
CREATE INDEX trades_mint ON trades(mint, ts DESC);
CREATE INDEX trades_wallet ON trades(wallet, ts DESC);

-- A buy a rule stopped: 'chain' is a buy that landed and failed with the rule's error (Bounced, DevBuy, Bundled,
-- OverCap); 'site' is a signed-in wallet that asked this site for a buy a rule bars. rule: kols | dev | bundles | maxWallet
CREATE TABLE bounces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  rule TEXT NOT NULL DEFAULT 'kols',
  source TEXT NOT NULL,
  sig TEXT UNIQUE,
  sol REAL,
  ts INTEGER NOT NULL
);
CREATE INDEX bounces_ts ON bounces(ts DESC);
CREATE INDEX bounces_wallet ON bounces(wallet, ts DESC);
CREATE INDEX bounces_mint ON bounces(mint, ts DESC);

-- A copy refused at launch by a live coin's no-vamps rule (the coin it would have copied)
CREATE TABLE vamp_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,          -- the protected coin
  part TEXT NOT NULL,          -- ticker | name | x | picture
  ts INTEGER NOT NULL
);
CREATE INDEX vamp_stops_mint ON vamp_stops(mint, ts DESC);

-- Uploaded pictures' fingerprints (a PNG's 64-bit difference hash), by their /media key
CREATE TABLE media (
  key TEXT PRIMARY KEY,
  img_hash TEXT,
  created_at INTEGER NOT NULL
);

-- A launch between "prepare" and "live": the mint key (encrypted) and what the transactions must say
CREATE TABLE launches (
  id TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  mint TEXT NOT NULL UNIQUE,
  mint_secret TEXT NOT NULL,
  meta TEXT NOT NULL,          -- JSON: name, symbol, description, image, links and the rules
  wallets TEXT NOT NULL,       -- JSON: the list, sorted
  dev_buy INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,        -- 'prepared' | 'listing' | 'launching' | 'live' | 'failed'
  messages TEXT,               -- JSON: sha256 of each transaction message handed out, in order
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX launches_creator ON launches(creator, created_at DESC);

-- Pre-ground mint keys ending in "str" (scripts/load-mints.mjs), encrypted
CREATE TABLE mint_pool (
  mint TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE state (
  k TEXT PRIMARY KEY,
  v TEXT,
  at INTEGER
);
