// The strict.fun program from JavaScript: addresses, instructions, account and event decoding, and the curve's math (the
// same integer math the program runs, so quotes match what lands). Shared by the worker, the scripts and the tests.
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE, NATIVE_MINT, TOKEN_PROGRAM_ID, AuthorityType, createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction, createMintToInstruction, createSetAuthorityInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const PROGRAM_ID = new PublicKey('strqZGb3RoGux1Z8s5pu7dLEB9G2QqEix4hTRC9p5DU');
export const CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
export const CPMM_CONFIG = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2'); // index 0: 0.25% trade fee
export const CPMM_FEE_RECEIVER = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');
export const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'); // Metaplex Core: dev passes
export const NO_PASS = PublicKey.default.toBase58();
export const WSOL = NATIVE_MINT;
export const DECIMALS = 6;
export const LIST_HEADER = 78;
export const MAX_ADD = 28;
export const RENT_PER_BYTE_YEAR = 3480;
/** lamports to keep an account of `bytes` rent-exempt */
export const rentExempt = (bytes) => (128 + bytes) * RENT_PER_BYTE_YEAR * 2;
/** what a list of `n` wallets costs to store (it goes to the coin's buyback when it bonds) */
export const listRent = (n) => (n > 0 ? rentExempt(LIST_HEADER + 32 * n) : 0);

const IX = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  set_params: [27, 234, 178, 52, 147, 2, 187, 141],
  set_authority: [133, 250, 37, 21, 110, 163, 26, 121],
  open_list: [79, 24, 80, 40, 242, 132, 48, 214],
  add_to_list: [189, 114, 172, 101, 248, 38, 249, 138],
  close_list: [243, 64, 236, 85, 54, 86, 105, 155],
  create: [24, 30, 200, 40, 5, 28, 7, 119],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sell: [51, 230, 133, 164, 1, 127, 131, 173],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  migrate: [155, 234, 231, 146, 236, 158, 162, 30],
  buyback: [106, 117, 64, 30, 56, 69, 7, 45],
};
const ACCT = { Global: [167, 232, 232, 177, 200, 108, 114, 127], Curve: [191, 180, 249, 66, 180, 71, 51, 182], List: [169, 24, 186, 110, 22, 139, 190, 82] };
const EVENT = {
  CreateEvent: [27, 114, 169, 77, 222, 235, 99, 118],
  TradeEvent: [189, 219, 127, 211, 78, 230, 97, 238],
  CompleteEvent: [95, 114, 97, 156, 212, 46, 152, 8],
  ClaimEvent: [93, 15, 70, 170, 48, 140, 212, 219],
  MigrateEvent: [216, 175, 231, 95, 45, 98, 108, 21],
  BuybackEvent: [232, 115, 56, 116, 133, 162, 224, 61],
};
/** the program's error codes, by name (Anchor numbers them from 6000) */
export const ERRORS = ['Bounced', 'Complete', 'NotComplete', 'Slippage', 'Zero', 'Sealed', 'ListFull', 'ListOrder', 'ListChunk', 'ListMismatch',
  'MintAuthority', 'MintSupply', 'Paused', 'BadParams', 'PoolMismatch', 'Math', 'Unauthorized', 'BadAccount', 'DevBuy', 'BadShield', 'NotSigner',
  'NotWritable', 'AlreadyInitialized', 'Bundled', 'OverCap', 'BadMaxWallet', 'BadPass', 'NotHolder'];
/** the errors a buy fails with when it breaks one of the coin's rules, and the rule each enforces */
export const RULE_ERRORS = { Bounced: 'kols', DevBuy: 'dev', Bundled: 'bundles', OverCap: 'maxWallet' };
/** the max wallet's allowed range, in basis points of the supply */
export const MAX_WALLET_RANGE = [50, 1000];
/** the snipe shield's shapes, as the program numbers them, and the lengths each allows */
export const SHIELD = { none: 0, linear: 1, exponential: 2 };
export const SHIELD_RANGE = { linear: [10, 300], exponential: [5, 30] };
export const BOUNCED_CODE = 6000;

export const pk = (x) => (x instanceof PublicKey ? x : new PublicKey(x));
const seed = (s) => Buffer.from(s);
const pda = (seeds, program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];

export const globalPda = () => pda([seed('global')]);
export const curvePda = (mint) => pda([seed('curve'), pk(mint).toBuffer()]);
export const vaultPda = (mint) => pda([seed('vault'), pk(mint).toBuffer()]);
export const listPda = (mint) => pda([seed('list'), pk(mint).toBuffer()]);
export const vaultTokens = (mint) => getAssociatedTokenAddressSync(pk(mint), vaultPda(mint), true);
export const vaultWsol = (mint) => getAssociatedTokenAddressSync(WSOL, vaultPda(mint), true);
export const metadataPda = (mint) => pda([seed('metadata'), METAPLEX.toBuffer(), pk(mint).toBuffer()], METAPLEX);
export const cpmmAuthority = () => pda([seed('vault_and_lp_mint_auth_seed')], CPMM);
export const cpmmLpMint = (pool) => pda([seed('pool_lp_mint'), pk(pool).toBuffer()], CPMM);
export const cpmmVault = (pool, mint) => pda([seed('pool_vault'), pk(pool).toBuffer(), pk(mint).toBuffer()], CPMM);
export const cpmmObservation = (pool) => pda([seed('observation'), pk(pool).toBuffer()], CPMM);

// ---------------------------------------------------------------- encoding

class W {
  constructor() { this.parts = []; }
  bytes(b) { this.parts.push(Buffer.from(b)); return this; }
  u8(n) { return this.bytes([n & 0xff]); }
  bool(b) { return this.u8(b ? 1 : 0); }
  u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return this.bytes(b); }
  u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return this.bytes(b); }
  u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return this.bytes(b); }
  key(k) { return this.bytes(pk(k).toBuffer()); }
  str(s) { const b = Buffer.from(s, 'utf8'); return this.u32(b.length).bytes(b); }
  done() { return Buffer.concat(this.parts); }
}

class R {
  constructor(buf, o = 0) { this.b = Buffer.from(buf); this.o = o; }
  u8() { return this.b[this.o++]; }
  bool() { return this.u8() !== 0; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  i64() { const v = this.b.readBigInt64LE(this.o); this.o += 8; return v; }
  key() { const v = new PublicKey(this.b.subarray(this.o, this.o + 32)); this.o += 32; return v.toBase58(); }
  hash() { const v = this.b.subarray(this.o, this.o + 32).toString('hex'); this.o += 32; return v; }
}

const same = (a, disc) => disc.every((x, i) => a[i] === x);
const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: pk(pubkey), isWritable, isSigner });
const ix = (name, keys, args = new W()) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([Buffer.from(IX[name]), args.done()]) });

// ---------------------------------------------------------------- instructions

const paramsArgs = (p) => new W().key(p.feeRecipient).key(p.cpmmConfig || CPMM_CONFIG).u16(p.feeBps).u16(p.creatorFeeBps)
  .u64(p.virtualSol).u64(p.virtualToken).u64(p.realToken).u64(p.tokenSupply).u64(p.migrationFee).u64(p.migrationReserve)
  .u32(p.maxList).bool(!!p.paused);

/** the launch defaults: the familiar launchpad curve shape (bonds at ~85 SOL), 1% fee (0.7% platform, 0.3% creator) */
export const DEFAULT_PARAMS = {
  feeBps: 70, creatorFeeBps: 30,
  virtualSol: 30_000_000_000n, virtualToken: 1_073_000_000_000_000n, realToken: 793_100_000_000_000n, tokenSupply: 1_000_000_000_000_000n,
  migrationFee: 500_000_000n, migrationReserve: 250_000_000n, maxList: 1000, paused: false,
};

export const initializeIx = (authority, params) => ix('initialize', [meta(globalPda(), true), meta(authority, true, true), meta(SystemProgram.programId)], paramsArgs(params));
export const setParamsIx = (authority, params) => ix('set_params', [meta(globalPda(), true), meta(authority, false, true)], paramsArgs(params));
export const openListIx = (creator, mint) => ix('open_list', [meta(listPda(mint), true), meta(mint, false, true), meta(creator, true, true), meta(SystemProgram.programId)]);
export const closeListIx = (creator, mint) => ix('close_list', [meta(listPda(mint), true), meta(curvePda(mint)), meta(creator, true, true)]);

export function addToListIx(creator, mint, wallets) {
  const a = new W().u32(wallets.length);
  for (const w of wallets) a.key(w);
  return ix('add_to_list', [meta(globalPda()), meta(listPda(mint), true), meta(creator, true, true), meta(SystemProgram.programId)], a);
}

/**
 * The coin's rules: `shield` { kind: 'linear' | 'exponential', secs } or null (no snipers); `noDevBuy` (the creator's
 * wallet can't buy before it bonds); `noBundles` (nothing buys in the launch slot); `maxWalletBps` (0, or 50-1000).
 * And who its creator fees go to: `pass`, a dev pass asset (made by passCreateIx earlier in the launch), or null (locked
 * to the creator's wallet).
 */
export const createIx = (creator, mint, { shield = null, noDevBuy = false, noBundles = false, maxWalletBps = 0, pass = null } = {}) => ix('create', [
  meta(globalPda()), meta(creator, true, true), meta(mint), meta(curvePda(mint), true), meta(vaultPda(mint), true), meta(vaultTokens(mint)),
  meta(listPda(mint), true), meta(SystemProgram.programId), ...(pass ? [meta(pass)] : []),
], new W().u8(shield ? SHIELD[shield.kind] : 0).u16(shield ? shield.secs : 0).bool(noDevBuy).bool(noBundles).u16(maxWalletBps).bool(!!pass));

const tradeKeys = (user, mint, feeRecipient) => [
  meta(globalPda()), meta(curvePda(mint), true), meta(mint), meta(vaultPda(mint), true), meta(vaultTokens(mint), true), meta(listPda(mint)),
  meta(user, true, true), meta(getAssociatedTokenAddressSync(pk(mint), pk(user)), true), meta(feeRecipient, true),
  meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
];
export const buyIx = (user, mint, feeRecipient, solIn, minOut) => ix('buy', tradeKeys(user, mint, feeRecipient), new W().u64(solIn).u64(minOut));
export const sellIx = (user, mint, feeRecipient, tokensIn, minOut) => ix('sell', tradeKeys(user, mint, feeRecipient), new W().u64(tokensIn).u64(minOut));
/** pays the coin's creator fees: to `to`, the creator, or with `pass` (the coin's dev pass) whoever holds it now */
export const claimIx = (mint, to, pass = null) => ix('claim', [meta(curvePda(mint), true), meta(mint), meta(vaultPda(mint), true), meta(to, true),
  meta(SystemProgram.programId), ...(pass ? [meta(pass)] : [])]);

// ---------------------------------------------------------------- dev passes (Metaplex Core)

const coreStr = (str) => { const b = Buffer.from(str, 'utf8'); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
const coreNone = { pubkey: CORE, isSigner: false, isWritable: false }; // an optional account left out
export const PASS_NAME_MAX = 32;

/**
 * A dev pass: Core create_v1 with no collection and no plugins, owned by `owner`, and updatable only by the coin's curve
 * (a PDA that never signs for Core, so nobody can change it). The asset key signs; `payer` pays its rent. `plugins` is
 * raw bytes for an Option<Vec<PluginAuthorityPair>>, for the tests' bad passes.
 */
export function passCreateIx({ asset, payer, owner, mint, name, uri, updateAuthority = curvePda(mint), plugins = Buffer.from([0]) }) {
  return new TransactionInstruction({
    programId: CORE,
    data: Buffer.concat([Buffer.from([0, 0]), coreStr(name.slice(0, PASS_NAME_MAX)), coreStr(uri), plugins]), // create_v1, AccountState, name, uri, plugins
    keys: [
      meta(asset, true, true), coreNone /* collection */, coreNone /* authority: the payer */, meta(payer, true, true), meta(owner),
      meta(updateAuthority), meta(SystemProgram.programId), coreNone /* log wrapper */,
    ],
  });
}
/** Core transfer_v1: the holder (`owner`, who signs) sends the pass to `to` */
export const passTransferIx = (asset, owner, to) => new TransactionInstruction({
  programId: CORE, data: Buffer.from([14, 0]),
  keys: [meta(asset, true), coreNone, meta(owner, true, true), coreNone, meta(to), coreNone, coreNone],
});
/** Core burn_v1, by its holder */
export const passBurnIx = (asset, owner) => new TransactionInstruction({
  programId: CORE, data: Buffer.from([12, 0]),
  keys: [meta(asset, true), coreNone, meta(owner, true, true), coreNone, coreNone, coreNone],
});
/** who holds a dev pass, from its account data (AssetV1: key 1, then the owner), or null if it isn't one */
export function passHolder(info) {
  if (!info || !pk(info.owner).equals(CORE) || !info.data || info.data.length < 33 || info.data[0] !== 1) return null;
  return new PublicKey(Buffer.from(info.data).subarray(1, 33)).toBase58();
}
/** a coin's dev pass, or null when its creator fees are locked to the creator */
export const passOf = (c) => (c?.pass && c.pass !== NO_PASS ? c.pass : null);

const cpmmMints = (mint) => (Buffer.compare(pk(mint).toBuffer(), WSOL.toBuffer()) < 0 ? [pk(mint), WSOL] : [WSOL, pk(mint)]);

/** Bonds a completed curve. `pool` is a fresh keypair's public key; it must sign. Send with `wsolAtaIx` in front. */
export function migrateIx(payer, mint, feeRecipient, pool, cpmmConfig = CPMM_CONFIG) {
  const [m0, m1] = cpmmMints(mint);
  const vault = vaultPda(mint);
  const lpMint = cpmmLpMint(pool);
  return ix('migrate', [
    meta(globalPda()), meta(curvePda(mint), true), meta(mint), meta(vault, true), meta(vaultTokens(mint), true), meta(vaultWsol(mint), true),
    meta(listPda(mint), true), meta(feeRecipient, true), meta(payer, true, true), meta(WSOL), meta(CPMM), meta(cpmmConfig), meta(cpmmAuthority()),
    meta(pool, true, true), meta(lpMint, true), meta(getAssociatedTokenAddressSync(lpMint, vault, true), true),
    meta(cpmmVault(pool, m0), true), meta(cpmmVault(pool, m1), true), meta(CPMM_FEE_RECEIVER, true), meta(cpmmObservation(pool), true),
    meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(SYSVAR_RENT_PUBKEY),
  ]);
}

export const wsolAtaIx = (payer, mint) => createAssociatedTokenAccountIdempotentInstruction(pk(payer), vaultWsol(mint), vaultPda(mint), WSOL);

/** Buys the coin back on its pool with the vault's spare SOL, and burns it. Send with `wsolAtaIx` in front. */
export const buybackIx = (payer, mint, pool, minOut = 0n, cpmmConfig = CPMM_CONFIG) => ix('buyback', [
  meta(curvePda(mint), true), meta(mint, true), meta(vaultPda(mint), true), meta(vaultTokens(mint), true), meta(vaultWsol(mint), true), meta(WSOL),
  meta(payer, true, true), meta(CPMM), meta(cpmmAuthority()), meta(cpmmConfig), meta(pool, true), meta(cpmmVault(pool, WSOL), true), meta(cpmmVault(pool, mint), true),
  meta(cpmmObservation(pool), true), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
], new W().u64(minOut));

/** Metaplex CreateMetadataAccountV3: name, symbol, uri; immutable, no creators or collection. */
export function metadataIx({ mint, mintAuthority, payer, updateAuthority, name, symbol, uri }) {
  const data = new W().u8(33).str(name).str(symbol).str(uri).u16(0).u8(0).u8(0).u8(0).bool(false).u8(0).done();
  return new TransactionInstruction({
    programId: METAPLEX,
    keys: [meta(metadataPda(mint), true), meta(mint), meta(mintAuthority, false, true), meta(payer, true, true), meta(updateAuthority),
      meta(SystemProgram.programId), meta(SYSVAR_RENT_PUBKEY)],
    data,
  });
}

/**
 * The launch's instructions, in order: make the mint, its metadata, the whole supply into the curve's vault, revoke the
 * mint authority, then `create` (which checks all of that and seals the list).
 */
/**
 * `pass`: { asset, name, uri } to launch with a dev pass, minted to the creator right before `create` checks it, or
 * { asset, made: true } when an earlier transaction made it (a launch with a dev buy is too big to hold it too); or null.
 */
export function launchIxs({ creator, mint, name, symbol, uri, supply = DEFAULT_PARAMS.tokenSupply, mintRent, shield = null, noDevBuy = false, noBundles = false, maxWalletBps = 0, pass = null }) {
  const c = pk(creator), m = pk(mint);
  return [
    SystemProgram.createAccount({ fromPubkey: c, newAccountPubkey: m, lamports: mintRent ?? rentExempt(MINT_SIZE), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(m, DECIMALS, c, null),
    metadataIx({ mint: m, mintAuthority: c, payer: c, updateAuthority: c, name, symbol, uri }),
    createAssociatedTokenAccountIdempotentInstruction(c, vaultTokens(m), vaultPda(m), m),
    createMintToInstruction(m, vaultTokens(m), c, supply),
    createSetAuthorityInstruction(m, c, AuthorityType.MintTokens, null),
    ...(pass && !pass.made ? [passCreateIx({ asset: pass.asset, payer: c, owner: c, mint: m, name: pass.name, uri: pass.uri })] : []),
    createIx(c, m, { shield, noDevBuy, noBundles, maxWalletBps, pass: pass?.asset ?? null }),
  ];
}

/** wallets sorted the way the program wants them: ascending bytes, no repeats */
export function sortWallets(wallets) {
  const seen = new Map();
  for (const w of wallets) { const k = pk(w); seen.set(k.toBase58(), k); }
  return [...seen.values()].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
}
export const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ---------------------------------------------------------------- accounts

export function decodeGlobal(data) {
  const b = Buffer.from(data);
  if (!same(b, ACCT.Global)) throw new Error('not a Global account');
  const r = new R(b, 8);
  return {
    authority: r.key(), feeRecipient: r.key(), cpmmConfig: r.key(), feeBps: r.u16(), creatorFeeBps: r.u16(),
    virtualSol: r.u64(), virtualToken: r.u64(), realToken: r.u64(), tokenSupply: r.u64(), migrationFee: r.u64(), migrationReserve: r.u64(),
    maxList: r.u32(), paused: r.bool(), bump: r.u8(),
  };
}

export function decodeCurve(data) {
  const b = Buffer.from(data);
  if (!same(b, ACCT.Curve)) throw new Error('not a Curve account');
  const r = new R(b, 8);
  return {
    mint: r.key(), creator: r.key(), virtualSol: r.u64(), virtualToken: r.u64(), realSol: r.u64(), realToken: r.u64(), tokenSupply: r.u64(),
    creatorFees: r.u64(), feeBps: r.u16(), creatorFeeBps: r.u16(), migrationFee: r.u64(), migrationReserve: r.u64(), blocked: r.u32(),
    listHash: r.hash(), complete: r.bool(), migrated: r.bool(), boughtBack: r.bool(), pool: r.key(), createdAt: Number(r.i64()),
    bump: r.u8(), vaultBump: r.u8(), listBump: r.u8(), shieldKind: r.u8(), shieldSecs: r.u16(), noDevBuy: r.bool(),
    noBundles: r.bool(), createdSlot: Number(r.u64()), maxWalletBps: r.u16(), pass: r.key(),
  };
}

/** a list account: its header and every wallet on it, in stored order */
export function decodeList(data) {
  const b = Buffer.from(data);
  if (!same(b, ACCT.List)) throw new Error('not a List account');
  const r = new R(b, 8);
  const l = { mint: r.key(), creator: r.key(), count: r.u32(), sealed: r.bool(), bump: r.u8() };
  l.wallets = Array.from({ length: l.count }, (_, i) => new PublicKey(b.subarray(LIST_HEADER + 32 * i, LIST_HEADER + 32 * (i + 1))).toBase58());
  return l;
}

/** sha256 of a list's wallets in order: what `create` stored as the coin's list_hash */
export async function listHash(wallets) {
  const bytes = Buffer.concat(sortWallets(wallets).map((w) => w.toBuffer()));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(h).toString('hex');
}

// ---------------------------------------------------------------- events

/** Every strict program event in a transaction's log lines ("Program data: ..." from this program). */
export function decodeEvents(logs) {
  const out = [];
  const stack = [];
  for (const line of logs || []) {
    let m;
    if ((m = /^Program (\S+) invoke \[\d+\]$/.exec(line))) { stack.push(m[1]); continue; }
    if (/^Program (\S+) (success|failed)/.test(line)) { stack.pop(); continue; }
    if (stack[stack.length - 1] !== PROGRAM_ID.toBase58() || !line.startsWith('Program data: ')) continue;
    const b = Buffer.from(line.slice(14), 'base64');
    const name = Object.keys(EVENT).find((n) => same(b, EVENT[n]));
    if (!name) continue;
    const r = new R(b, 8);
    if (name === 'TradeEvent') {
      out.push({ name, mint: r.key(), user: r.key(), isBuy: r.bool(), sol: r.u64(), tokens: r.u64(), fee: r.u64(), creatorFee: r.u64(),
        virtualSol: r.u64(), virtualToken: r.u64(), realSol: r.u64(), realToken: r.u64(), timestamp: Number(r.i64()), shieldFee: r.o < b.length ? r.u64() : 0n });
    } else if (name === 'CreateEvent') {
      out.push({ name, mint: r.key(), creator: r.key(), blocked: r.u32(), listHash: r.hash(), virtualSol: r.u64(), virtualToken: r.u64(), realToken: r.u64(), timestamp: Number(r.i64()),
        shieldKind: r.u8(), shieldSecs: r.u16(), noDevBuy: r.bool(), noBundles: r.bool(), maxWalletBps: r.u16(), createdSlot: Number(r.u64()), pass: r.key() });
    } else if (name === 'CompleteEvent') {
      out.push({ name, mint: r.key(), user: r.key(), realSol: r.u64(), timestamp: Number(r.i64()) });
    } else if (name === 'ClaimEvent') {
      out.push({ name, mint: r.key(), creator: r.key(), amount: r.u64(), timestamp: Number(r.i64()) });
    } else if (name === 'MigrateEvent') {
      out.push({ name, mint: r.key(), pool: r.key(), sol: r.u64(), tokens: r.u64(), lpBurned: r.u64(), timestamp: Number(r.i64()) });
    } else if (name === 'BuybackEvent') {
      out.push({ name, mint: r.key(), sol: r.u64(), burned: r.u64(), timestamp: Number(r.i64()) });
    }
  }
  return out;
}

/** The program error a failed transaction ended with, by name, or null. */
export function programError(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  if (custom == null || custom < 6000) return null;
  return ERRORS[custom - 6000] || `Error${custom}`;
}

// ---------------------------------------------------------------- the curve's math (bigint, as the program does it)

const ceilDiv = (n, d) => (n + d - 1n) / d;
const B = (x) => BigInt(x);
const SHIELD_START = 9_900n;
/** (1/99)^(1/s) for s = 5..30, in billionths: the exponential shield's factor a second (the program's table) */
const SHIELD_EXP = [398908197n, 464937027n, 518691651n, 563048234n, 600154071n, 631591797n, 658534631n, 681862909n, 702246528n, 720202507n, 736135316n,
  750365400n, 763149624n, 774696115n, 785175191n, 794727498n, 803470161n, 811501467n, 818904490n, 825749907n, 832098219n, 838001508n, 843504853n,
  848647458n, 853463580n, 857983284n];

/** the fee on a trade at unix second `now`, in basis points of its SOL: the normal fee, or the snipe shield while higher */
export function feeNow(c, now = Math.floor(Date.now() / 1000)) {
  const base = B(c.feeBps) + B(c.creatorFeeBps);
  const secs = B(c.shieldSecs || 0);
  const age = B(Math.max(0, now - (c.createdAt || 0)));
  if (!c.shieldKind || age >= secs) return base;
  let s;
  if (c.shieldKind === 1) s = base + ((SHIELD_START - base) * (secs - age)) / secs;
  else {
    const f = SHIELD_EXP[Number(secs) - 5];
    let x = SHIELD_START * 1_000_000_000n;
    for (let i = 0n; i < age; i++) x = (x * f) / 1_000_000_000n;
    s = x / 1_000_000_000n;
  }
  return s > base ? s : base;
}

function split(c, gross, f) {
  const all = (gross * f) / 10_000n;
  const fee = (gross * B(c.feeBps)) / 10_000n, creatorFee = (gross * B(c.creatorFeeBps)) / 10_000n;
  return { fee, creatorFee, shieldFee: all - fee - creatorFee };
}

/** the most tokens one wallet may hold on a max-wallet coin before it bonds, or null if it has no cap */
export const walletCap = (c) => (c.maxWalletBps ? (B(c.tokenSupply ?? DEFAULT_PARAMS.tokenSupply) * B(c.maxWalletBps)) / 10_000n : null);

/** Buying with `solIn` lamports (fees included) at unix second `now`, by `buyer` -> { tokens, net, fee, creatorFee, shieldFee, spent, complete, feeBps } */
export function quoteBuy(c, solIn, now, buyer) {
  const vs = B(c.virtualSol), vt = B(c.virtualToken), realToken = B(c.realToken);
  // the creator's buys skip the shield (as the program does)
  const f = buyer && c.creator && String(buyer) === String(c.creator) ? B(c.feeBps) + B(c.creatorFeeBps) : feeNow(c, now);
  let gross = B(solIn);
  let net = gross - (gross * f) / 10_000n;
  const k = vs * vt;
  let tokens = vt - ceilDiv(k, vs + net);
  let complete = false;
  if (tokens >= realToken) {
    tokens = realToken;
    net = ceilDiv(k, vt - tokens) - vs;
    const g = ceilDiv(net * 10_000n, 10_000n - f);
    gross = g < gross ? g : gross;
    complete = true;
  }
  const { fee, creatorFee, shieldFee } = split(c, gross, f);
  return { tokens, net: gross - fee - creatorFee - shieldFee, fee, creatorFee, shieldFee, spent: gross, complete, feeBps: Number(f) };
}

/** Selling `tokensIn` at unix second `now` -> { sol (to the seller), gross, fee, creatorFee, shieldFee } */
export function quoteSell(c, tokensIn, now) {
  const vs = B(c.virtualSol), vt = B(c.virtualToken);
  let gross = vs - ceilDiv(vs * vt, vt + B(tokensIn));
  if (gross > B(c.realSol)) gross = B(c.realSol);
  const f = feeNow(c, now);
  const { fee, creatorFee, shieldFee } = split(c, gross, f);
  return { sol: gross - fee - creatorFee - shieldFee, gross, fee, creatorFee, shieldFee, feeBps: Number(f) };
}

/** price in SOL per whole token */
export const priceSol = (c) => (Number(c.virtualSol) / 1e9) / (Number(c.virtualToken) / 10 ** DECIMALS);
/** how far the curve is to bonding, 0..100 */
export function progress(c, initialRealToken = DEFAULT_PARAMS.realToken) {
  if (c.complete) return 100;
  const sold = Number(B(initialRealToken) - B(c.realToken));
  return Math.max(0, Math.min(100, (sold / Number(initialRealToken)) * 100));
}
/** SOL the curve holds when it completes, from its start */
export function bondSol(p = DEFAULT_PARAMS) {
  const vs = B(p.virtualSol), vt = B(p.virtualToken);
  return Number(ceilDiv(vs * vt, vt - B(p.realToken)) - vs) / 1e9;
}
