# strict.fun: pick the rules. The code enforces them.

A Solana launchpad where every coin launches with rules its creator picks, written on chain before launch, sealed by
the launch itself, and checked by the program on every buy until the coin bonds. Nobody can change a coin's rules
afterwards: not the creator, not strict.fun.

strict.fun is built on two earlier launchpads:

- **[NoKol](https://nokol.fun)** (`~/Documents/kolblock`): the program, the KOL list, the sealed-list design, the
  sniper curve, no dev buy, the worker (index, cranks, launch flow) and the "watch a bounce" proof all come from
  NoKol. strict forks its program and keeps its wire format.
- **[betterlaunch](https://betterlaunch.fun)** (`~/Documents/launchbetter`): the snipe-shield idea and the anti-vamp
  check (`worker/vamp.js`, ported).

The idea came from launchvia.fun's "set the rules" launchpad.

**Source:** https://github.com/poshnet/strict (MIT). Keys and secrets never live in the repo: `keys/` and `.dev.vars` are
gitignored, and the rendered brand media is left out (the scripts make it again).

## The rules

| rule | what it stops | enforced by | error |
|---|---|---|---|
| **No KOLs** | 562 known KOL wallets (from NoKol's list, built from kolscan) plus any the creator adds can't buy until it bonds | the program: `buy` binary-searches the sealed list | `Bounced` (6000) |
| **No snipers** | buys in the first seconds pay up to 99%, falling to the normal 1% (5-30 s exponential or 10-300 s linear); the take buys back and burns the coin at bonding | the program: `fee_now` | (a fee, not an error) |
| **No dev buy** | the creator's wallet can't buy before it bonds | the program | `DevBuy` (6018) |
| **No bundles** | nothing can buy in the slot the coin was created in, the creator's own first buy included | the program: `created_slot` | `Bundled` (6023) |
| **Max wallet** | no buy can take a wallet past 0.5-10% of the supply (the launch page defaults to 2%) before it bonds; selling is never capped | the program: `max_wallet_bps` | `OverCap` (6024) |
| **No vamps** | while the coin is live, nobody can launch a coin with its ticker (lookalikes folded: $P3PE is $PEPE, $ROPEINU is $ROPE), name, X account or picture (a 64-bit difference hash) | **this site**, at launch (`worker/vamp.js`): not on chain, and the pages say so | 409 at prepare |

Every rule is off unless the creator picks it.

**Creator fees: locked, or a dev pass.** Also fixed at launch (Advanced, on the launch page): the creator's 0.3% of
every trade goes to the wallet that launched the coin (the default; the program pays nobody else), or to whoever holds
the coin's **dev pass**, a 1-of-1 Metaplex Core NFT minted to the creator at launch (`worker/pass.js`). `claim` reads
the pass's owner from the asset itself at every payout, so selling or sending the pass hands the fees on. `create`
only takes a plain pass: no plugins (so no permanent transfer, freeze or burn delegate can take it back) and the coin's
curve as its update authority (a PDA that never signs for Core, so nobody can change it). Burn the pass and its fees
burn with it. The idea is coinpair's dev pass, minus pump.fun's fee config: here the program itself pays the holder. The site's "Show the code" panels quote the lines that enforce each one,
cut straight from the source by `scripts/source-snippets.mjs` into `web/src/lib/source.json` (the build runs it), so
the code shown is the code built.

Honest limits (also on the site): a list stops wallets, not people; tokens are plain SPL tokens, so a listed wallet can
be sent them; the max wallet limits buys, not transfers; no vamps is a site check.

## The program (`program/programs/strict/src/`)

- **Program ID:** `strqZGb3RoGux1Z8s5pu7dLEB9G2QqEix4hTRC9p5DU` (keys/program.json). **Not on mainnet yet.**
- Plain Rust on solana-program 1.18 (no framework), forked from NoKol's: 139 KB (138,776 bytes), so deploying locks
  **0.71 SOL** of rent at an exact fit, **0.76 SOL** with `--max-len 150000` (room for later upgrades; mainnet rent read
  2026-10-31).
- What strict adds to NoKol's program: `no_bundles` + `created_slot`, `max_wallet_bps` and `pass` at the end of the
  curve account (8 + 261 bytes; NoKol's fields keep their offsets), three more `create` args (the last, `with_pass`,
  optional: a dev pass as a 9th account), the two checks in `buy`, `claim` paying a pass's holder (the pass as a 6th
  account), and the errors `Bundled`, `OverCap`, `BadMaxWallet`, `BadPass`, `NotHolder` (6023-6027). Everything else (the list, sealing, the curve, fees,
  migration to a Raydium CPMM pool with the LP burned, the buyback) is NoKol's, unchanged.
- **Wallets** (keys in `keys/`, gitignored: back them up offline): deployer / upgrade authority / program admin
  `F7DgLYXVeMBCgQV67japbBXBFsY4w4qyChvFhyb8gK6A` (the only key the program lets `initialize`), fee wallet
  `58HtzYFJXX4qMNYNZY5Xpbyo7S2aBZFjsAkpTiNgRGRS`, crank (ops) `9ShCaYigEgKnhmHWePcxMAzUaDRjUEK8XLY73vf1FiYE`.
  All new for strict; none of NoKol's keys are used.

Fees (NoKol's): 1% a trade on the curve, 0.7% to the fee wallet and 0.3% to the creator. At bonding (about 85 SOL):
0.5 SOL to the fee wallet, 0.25 SOL for Raydium's pool fee and rent, the rest to the buyback.

## The site

One Cloudflare Worker (`worker/`) serves the app (`web/`, Vite + React) and the API, and runs a minute cron: the index
of every program transaction (events → D1; a buy that failed with a rule's error → a stop, kept against the coin and the
rule), then the cranks (`migrate`, `buyback`, creator payouts, sent by the ops wallet, which only pays network fees).

```
worker/program.js   the program from JS: PDAs, instructions (the rules ride in createIx), decoders, events, the curve's math, walletCap
worker/launch.js    prepare (rules checked, no vamps checked, mint key, every tx built and mint-signed) / submit; vampPanel
worker/pass.js      dev passes: the pass key (derived from the mint's), its NFT metadata (/p/<mint>.json), its holder and payouts
worker/vamp.js      no vamps: ticker/name folding, X accounts, the PNG decoder and picture fingerprint (from betterlaunch)
worker/trade.js     buy/sell on the curve; a buy a rule would stop gets a 403 naming the rule (kols, dev, bundles, maxWallet)
worker/indexer.js   signatures → events → rows; failed buys → stops by rule; coins made straight on the program are adopted
worker/market.js    board (sort=strictest), coin + rules, coinStops, list, trades, candles, holders, KOL directory, feed, stats
worker/media.js     pictures in R2; a PNG's fingerprint in D1 (media)
worker/crank.js     migrate, buyback, creator payouts (to the creator, or a dev pass's holder right then)
worker/simulate.js  "watch a stop": a listed wallet's buy and a control buy, simulated on chain
```

API additions over NoKol: `GET /api/coin/:mint/pass` (the dev pass: holder read from chain, owed, payouts by wallet),
`GET /p/<mint>.json` (the pass NFT's metadata), `GET /api/coin/:mint/stops` (stops by rule, sniper take, creator and top holder share, the
latest stops), `POST /api/vamp-check`, `GET /api/coins?sort=strictest`, rules on every coin object, `rule` on stop
events and rule refusals. pump.fun launches (NoKol has them) are gone: pump.fun can't enforce any of these rules.

## The look

**Signal**: near-black (`#0A0A0B`), one amber accent (`#FF8A1F`), green for passed checks and buys, red for stopped
buys, yellow for what isn't on chain yet. **Sora** for words, **JetBrains Mono** for code and numbers (ligatures off, so
code reads exactly as written). The mark is `{s}` and the wordmark `{strict}.fun`, both in **Geist Mono**, braces in the
accent. Every colour is a variable in `web/src/styles/app.css` (`:root`).

The site is an app: a first-visit intro (the rules in one screen, a risk confirm, then "Enter strict.fun"), a sidebar
and top bar, the board as compact rows with each coin's rules as icons, and a rail with the program's `fn buy` checks
running example buys (`components/Engine.tsx`). Every line of code on the site comes from `web/src/lib/source.json`.

Brand files (X profile picture, banner, link card, icons, the teaser, launch videos) are HTML scenes in `brand/src`,
rendered by `node scripts/render-brand.mjs [stills|videos|all]` (Chrome, ffmpeg, gifski, puppeteer-core). The square
warm-up ad (`render-brand.mjs ad`) has its own music, written in code and synced to its cuts: `node scripts/warmup-music.mjs`
makes `brand/warmup-music.wav` and `brand/warmup-ad-music.mp4` (106.67 bpm; the scene's timeline runs on the same beat grid,
so change both together). Photo assets made with Higgsfield are in `brand/higgs/` (see its README). Launch tweets
and the X bio: `brand/tweets.md`.

## Run it locally (the whole stack on a local validator)

```bash
npm install
program/validator.sh &                         # clones Raydium CPMM, Metaplex and Metaplex Core from mainnet via keys/RPC_URL.txt
solana airdrop 10 $(cat keys/deployer.address.txt) --url localhost
solana airdrop 1 $(cat keys/fee-wallet.address.txt) --url localhost
node --experimental-require-module scripts/init-program.mjs
npm run db:local && npm run build && npx wrangler dev --port 8789 --ip 127.0.0.1 &   # .dev.vars points at the local validator
API=http://127.0.0.1:8789 node --experimental-require-module scripts/e2e.mjs        # 57 checks through the API
```

Tests: `npm run program:build` then `npm run program:test` (**77 checks** against the real CPMM, Metaplex and Core binaries:
NoKol's 50 — the admin lock, the list and its sealing, exact quotes, fees, completion, migration, LP burn, buyback, the
snipe shield, no dev buy — plus 11 for no bundles and the max wallet, and 16 for the dev pass: minted in or before the
launch, paying its holder, moving with a transfer, refusing another coin's pass, a pass with plugins or the wrong update
authority, a non-Core account, and a burned pass) and `scripts/e2e.mjs` (**57 checks**: every rule through the API and
on chain, the anti-vamp check, a dev pass launch and the payout crank paying its new holder, stops by rule, the
strictest sort, bonding, the cranks, every read endpoint). Both pass on a fresh validator and database (2026-10-31). Node 22.11 needs
`--experimental-require-module` for web3.js in scripts.

The program builds with Solana 1.18.26 / platform-tools 1.41 (`Cargo.lock` is pinned, version 3, for its rustc 1.75).

## Going live

**Done (2026-10-31):** the preview runs at **https://strict.hunrtech.workers.dev** (Worker `strict`, D1 `strict`
`4926f2da-…`, R2 `strict-media`, secrets RPC_URL / ADMIN_KEY / VAULT_KEY / OPS_SECRET set from keys/). Launches are off
(`LAUNCHES: "0"`) and the board is empty until the program is on mainnet. Still to do, in order:

1. **Domain: done (2026-10-31).** strict.fun is on Cloudflare (Free, nameservers `bradley`/`irma.ns.cloudflare.com`)
   and `wrangler.jsonc` routes strict.fun and www.strict.fun to this Worker as custom domains. Every coin's metadata uri
   is `SITE_URL/m/<mint>.json` (https://strict.fun), baked in at launch.
2. **Cloudflare resources:** `npx wrangler d1 create strict` (put the id in `wrangler.jsonc`),
   `npx wrangler d1 migrations apply strict --remote` (again after any new file in `migrations/`) and
   `npx wrangler r2 bucket create strict-media`.
3. **Program: deployed (2026-10-31).** `strqZGb3…p5DU` on mainnet, `--max-len 150000` (programdata `8jueKPxM…hhsP`,
   0.763 SOL of rent; the on-chain bytes match the tested build, sha256 `2b60bdacd0d3411a…`). Upgrade authority: the
   deployer `F7Dg…gK6A`. Upgrades: `solana program deploy … --program-id keys/program.json --buffer keys/buffer.json`.
4. **Initialized (2026-10-31)** with DEFAULT_PARAMS: admin `F7Dg…gK6A`, fees to `58Ht…RGRS` (funded 0.01 SOL).
5. **Ops wallet funded** with 0.05 SOL (`9ShC…1FiYE`).
6. **Worker:** secrets are set. Still to do: publish the source, set `SOURCE_URL` to the repo (the site says "open
   source"), then `LAUNCHES: "1"` and `npx wrangler deploy`. Mint addresses ending in "fair": ~6 minutes each on this
   Mac, so grind in the background (`cd keys/mints && solana-keygen grind --ends-with fair:20 --num-threads 8`), then
   `node scripts/load-mints.mjs` loads every `*fair.json` there into the live pool. Launches without one get a random
   address.
7. One small real launch with every rule on: a buy from a listed test wallet must fail with `Bounced`, the creator's
   with `DevBuy`, an over-cap buy with `OverCap`. Leave one coin to bond before announcing.
8. **Make it final** once it has run in the wild (and ideally been audited):
   `solana program set-upgrade-authority strqZGb3RoGux1Z8s5pu7dLEB9G2QqEix4hTRC9p5DU --final`. Until then "nobody can
   change it" is true of every coin's rules (nothing writes to a sealed list or a created curve's rules) but the
   program itself could be upgraded; the site must not claim "frozen" or "no upgrade key" before this step.

**Coming soon (on 2026-10-31, off since 2026-11-02; launches still off):** with `COMING_SOON: "1"` every page, on strict.fun and the workers.dev address, is
one "soon" page (`worker/soon.js`), the API answers 503, and the app's files, KOL pictures and metadata are withheld.
The team's way in is the preview link `https://strict.fun/?preview=<keys/PREVIEW_KEY.txt>`: it sets a cookie for 30
days. The admin API and the cron keep working. On launch day: set `COMING_SOON` to `"0"` (or delete it), add `"!/assets/*"`
and `"!/kols/*"` back to `run_worker_first`, and deploy.

**Our own coin's CA:** set `TOKEN_MINT` (and `TOKEN_SYMBOL`) in `wrangler.jsonc` and deploy: a copy pill with a chart link
shows in the top bar and on the home page (`web/src/components/TokenCA.tsx`); blank shows nothing.

Admin: `POST /api/admin/run?task=index|crank|all` with header `x-admin-key`.

## Knobs (wrangler vars)

| var | default | meaning |
|---|---|---|
| `LAUNCHES` | 0 | `1` opens launches |
| `SOURCE_URL` | (blank) | the public repo the code panels link to |
| `SHIELD_DEFAULT_KIND` / `SHIELD_DEFAULT_SECS` / `MAX_WALLET_DEFAULT_BPS` | linear / 60 / 200 | the launch page's starting picks |
| `LAUNCH_DAILY_MAX` / `LAUNCH_COOLDOWN_MIN` | 500 / 2 | launches a day; one per wallet this often |
| `LIST_MAX` | 1000 | the program's max_list |
| `DEV_BUY_MAX_SOL` | 20 | the biggest first buy |
| `KOL_MIN_FOLLOWERS` | 10000 | the launch page's default KOL list: every KOL with at least this many followers |
| `CRANK` / `PAYOUT_MIN_SOL` | 1 / 0.01 | the cranks; creator fees are paid out once a coin owes this much |
| `TEST_COUNT` / `E2E_COUNT` | 77 / 57 | the test counts the pages quote |

Refresh the KOL list: `npm run kols` (kolscan → X followers via fxtwitter → pictures at 96 px in `web/public/kols/`).
