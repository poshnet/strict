//! strict.fun: a bonding curve whose creator picks the rules every buy is checked against. Plain Solana Rust, no
//! framework. Forked from NoKol (nokol.fun), which it extends with the no-bundles and max-wallet rules.
//!
//! The rules, each off unless the creator picks it, all fixed by `create` and enforced by `buy` until the curve completes:
//! - no KOLs: before launch the creator writes a list of wallets (`open_list`, `add_to_list`). `create` seals it for
//!   good: no instruction adds to, removes from or rewrites a sealed list, and nobody (the creator, the admin) can unseal
//!   one. `buy` refuses any signer on the list.
//! - no snipers: a fee that starts at 99% and falls to the normal 1% over a few seconds; the extra goes to the buyback.
//! - no dev buy: the creator's wallet can't buy.
//! - no bundles: nothing can buy in the slot the coin was created in.
//! - max wallet: no buy can take a wallet past a share of the supply (0.5-10%).
//!
//! Who the creator's fees go to is fixed at launch too: the creator's wallet (locked to it for good), or a dev pass, a
//! 1-of-1 Metaplex Core NFT that only this coin's curve can update. `claim` pays whoever holds the pass right then, so
//! selling or sending it hands the fees on. When the curve completes, anyone can `migrate` it: its SOL and
//! remaining tokens open a Raydium CPMM pool whose LP tokens are burned, the list closes, and `buyback` spends the list's
//! rent, the shield's take and the unspent migration reserve buying the coin back and burning it.
//!
//! SOL lives in a system-owned PDA (`vault`) so it can pay for the pool's accounts; the curve's tokens live in a token
//! account the vault owns. The launch transaction makes the mint itself (mint, metadata, the whole supply into the vault,
//! mint authority revoked) and `create` checks the result.
//!
//! Instructions and accounts keep Anchor's wire format (8-byte sha256 discriminators, the same field order), so clients
//! built for the Anchor version work unchanged.
use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult, hash::hashv, log::sol_log_data, program_error::ProgramError,
    pubkey, pubkey::Pubkey, rent::Rent, system_program, sysvar::Sysvar,
};

pub mod cpi;
pub mod error;
pub mod state;

use cpi::{CORE, CPMM, SYSTEM, TOKEN, WSOL};
use error::E;
use state::*;

solana_program::declare_id!("strqZGb3RoGux1Z8s5pu7dLEB9G2QqEix4hTRC9p5DU");

/// the only key that may set the program up (so nobody can take `initialize` first after deploy)
pub const ADMIN: Pubkey = pubkey!("F7DgLYXVeMBCgQV67japbBXBFsY4w4qyChvFhyb8gK6A");
pub const DECIMALS: u8 = 6;
pub const MAX_ADD: usize = 28;
pub const MIN_BUYBACK: u64 = 100_000;
const BPS: u64 = 10_000;
/// the snipe shield starts at 99%
const SHIELD_START: u64 = 9_900;
/// (1/99)^(1/s) for s = 5..30 seconds, in billionths: the exponential shield falls by this factor each whole second,
/// from 99% at launch to 1% at s
const SHIELD_EXP: [u64; 26] = [
    398908197, 464937027, 518691651, 563048234, 600154071, 631591797, 658534631, 681862909, 702246528, 720202507, 736135316, 750365400, 763149624,
    774696115, 785175191, 794727498, 803470161, 811501467, 818904490, 825749907, 832098219, 838001508, 843504853, 848647458, 853463580, 857983284,
];

const IX_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const IX_SET_PARAMS: [u8; 8] = [27, 234, 178, 52, 147, 2, 187, 141];
const IX_SET_AUTHORITY: [u8; 8] = [133, 250, 37, 21, 110, 163, 26, 121];
const IX_OPEN_LIST: [u8; 8] = [79, 24, 80, 40, 242, 132, 48, 214];
const IX_ADD_TO_LIST: [u8; 8] = [189, 114, 172, 101, 248, 38, 249, 138];
const IX_CLOSE_LIST: [u8; 8] = [243, 64, 236, 85, 54, 86, 105, 155];
const IX_CREATE: [u8; 8] = [24, 30, 200, 40, 5, 28, 7, 119];
const IX_BUY: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];
const IX_SELL: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const IX_CLAIM: [u8; 8] = [62, 198, 214, 193, 213, 159, 108, 210];
const IX_MIGRATE: [u8; 8] = [155, 234, 231, 146, 236, 158, 162, 30];
const IX_BUYBACK: [u8; 8] = [106, 117, 64, 30, 56, 69, 7, 45];

const EV_CREATE: [u8; 8] = [27, 114, 169, 77, 222, 235, 99, 118];
const EV_TRADE: [u8; 8] = [189, 219, 127, 211, 78, 230, 97, 238];
const EV_COMPLETE: [u8; 8] = [95, 114, 97, 156, 212, 46, 152, 8];
const EV_CLAIM: [u8; 8] = [93, 15, 70, 170, 48, 140, 212, 219];
const EV_MIGRATE: [u8; 8] = [216, 175, 231, 95, 45, 98, 108, 21];
const EV_BUYBACK: [u8; 8] = [232, 115, 56, 116, 133, 162, 224, 61];

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process);

/// The panic handler: one fixed line. The default one formats the panic message, which links all of core::fmt.
#[cfg(all(feature = "custom-panic", target_os = "solana"))]
#[no_mangle]
fn custom_panic(_info: &core::panic::PanicInfo<'_>) {
    solana_program::log::sol_log("panicked");
}

pub fn process(_program_id: &Pubkey, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 { return Err(ProgramError::InvalidInstructionData); }
    let (d, args) = data.split_at(8);
    let mut r = Rd::new(args, 0);
    let d = arr8(d);
    match d {
        IX_BUY => buy(a, r.u64()?, r.u64()?),
        IX_SELL => sell(a, r.u64()?, r.u64()?),
        IX_ADD_TO_LIST => add_to_list(a, args),
        IX_OPEN_LIST => open_list(a),
        IX_CREATE => create(a, &mut r),
        IX_CLAIM => claim(a),
        IX_MIGRATE => migrate(a),
        IX_BUYBACK => buyback(a, r.u64()?),
        IX_CLOSE_LIST => close_list(a),
        IX_INITIALIZE => initialize(a, &mut r),
        IX_SET_PARAMS => set_params(a, &mut r),
        IX_SET_AUTHORITY => set_authority(a, r.key()?),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ------------------------------------------------------------------ checks

fn accounts<'a, 'b, const N: usize>(a: &'b [AccountInfo<'a>]) -> Result<&'b [AccountInfo<'a>; N], ProgramError> {
    a.get(..N).and_then(|s| s.try_into().ok()).ok_or(ProgramError::NotEnoughAccountKeys)
}
fn signer(a: &AccountInfo) -> ProgramResult { if a.is_signer { Ok(()) } else { Err(E::NotSigner.into()) } }
fn writable(a: &AccountInfo) -> ProgramResult { if a.is_writable { Ok(()) } else { Err(E::NotWritable.into()) } }
fn is(a: &AccountInfo, key: &Pubkey) -> ProgramResult { if a.key == key { Ok(()) } else { Err(E::BadAccount.into()) } }
fn pda_is(a: &AccountInfo, seeds: &[&[u8]]) -> ProgramResult {
    let k = Pubkey::create_program_address(seeds, &crate::ID).map_err(|_| ProgramError::from(E::BadAccount))?;
    is(a, &k)
}
fn empty(a: &AccountInfo) -> ProgramResult {
    if a.owner == &system_program::ID && a.data_is_empty() { Ok(()) } else { Err(E::AlreadyInitialized.into()) }
}
pub fn arr8(s: &[u8]) -> [u8; 8] { let mut a = [0u8; 8]; a.copy_from_slice(&s[..8]); a }
pub fn arr32(s: &[u8]) -> [u8; 32] { let mut a = [0u8; 32]; a.copy_from_slice(&s[..32]); a }
fn ok(c: bool, e: E) -> ProgramResult { if c { Ok(()) } else { Err(e.into()) } }

fn mul_div(x: u64, y: u64, d: u64) -> Result<u64, ProgramError> {
    u64::try_from((x as u128) * (y as u128) / d as u128).map_err(|_| E::Math.into())
}
fn ceil_div(n: u128, d: u128) -> Result<u128, ProgramError> {
    if d == 0 { return Err(E::Math.into()); }
    Ok((n + d - 1) / d)
}
fn now() -> Result<i64, ProgramError> { Ok(Clock::get()?.unix_timestamp) }
fn slot() -> Result<u64, ProgramError> { Ok(Clock::get()?.slot) }

/// The fee on a trade right now, in basis points of its SOL: the coin's normal fee, or its snipe shield while that's
/// higher (99% at launch, down to the normal fee after `shield_secs`).
pub fn fee_now(c: &Curve, t: i64) -> u64 {
    let base = c.fee_bps as u64 + c.creator_fee_bps as u64;
    let age = t.saturating_sub(c.created_at).max(0) as u64;
    let secs = c.shield_secs as u64;
    if c.shield_kind == 0 || age >= secs { return base; }
    let s = if c.shield_kind == 1 {
        base + (SHIELD_START - base) * (secs - age) / secs
    } else {
        let f = SHIELD_EXP[(secs - 5) as usize] as u128;
        let mut x = SHIELD_START as u128 * 1_000_000_000;
        for _ in 0..age { x = x * f / 1_000_000_000; }
        (x / 1_000_000_000) as u64
    };
    s.max(base)
}

/// Is `who` on the coin's sealed list? A binary search over the sorted wallets, read straight from the account.
fn listed(list: &AccountInfo, who: &Pubkey) -> Result<bool, ProgramError> {
    let l = List::load(list)?;
    ok(l.sealed, E::ListMismatch)?;
    let d = list.try_borrow_data()?;
    let key = who.as_ref();
    let (mut lo, mut hi) = (0usize, l.count as usize);
    while lo < hi {
        let mid = (lo + hi) / 2;
        let o = LIST_HEADER + 32 * mid;
        match d[o..o + 32].cmp(key) {
            core::cmp::Ordering::Equal => return Ok(true),
            core::cmp::Ordering::Less => lo = mid + 1,
            core::cmp::Ordering::Greater => hi = mid,
        }
    }
    Ok(false)
}

fn emit(parts: &[&[u8]]) { sol_log_data(&[&parts.concat()]); }

// ------------------------------------------------------------------ admin

fn initialize(a: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [global, authority, system] = accounts::<3>(a)?;
    signer(authority)?;
    is(authority, &ADMIN).map_err(|_| ProgramError::from(E::Unauthorized))?;
    is(system, &SYSTEM)?;
    let p = Params::read(r)?;
    p.check()?;
    let (k, bump) = Pubkey::find_program_address(&[b"global"], &crate::ID);
    is(global, &k)?;
    empty(global)?;
    cpi::create_pda(authority, global, system, GLOBAL_LEN, &[b"global", &[bump]])?;
    Global { authority: *authority.key, p, bump }.store(global)
}

fn admin<'a, 'b>(a: &'b [AccountInfo<'a>]) -> Result<(&'b AccountInfo<'a>, Global), ProgramError> {
    let [global, authority] = accounts::<2>(a)?;
    writable(global)?;
    signer(authority)?;
    let g = Global::load(global)?;
    ok(&g.authority == authority.key, E::Unauthorized)?;
    Ok((global, g))
}

fn set_params(a: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let (global, mut g) = admin(a)?;
    let p = Params::read(r)?;
    p.check()?;
    g.p = p;
    g.store(global)
}

fn set_authority(a: &[AccountInfo], new: Pubkey) -> ProgramResult {
    let (global, mut g) = admin(a)?;
    g.authority = new;
    g.store(global)
}

// ------------------------------------------------------------------ the list

/// An empty list for a coin that doesn't exist yet. The mint's key signs, so only whoever creates the coin can open it.
fn open_list(a: &[AccountInfo]) -> ProgramResult {
    let [list, mint, creator, system] = accounts::<4>(a)?;
    signer(mint)?;
    signer(creator)?;
    is(system, &SYSTEM)?;
    let (k, bump) = Pubkey::find_program_address(&[b"list", mint.key.as_ref()], &crate::ID);
    is(list, &k)?;
    empty(list)?;
    cpi::create_pda(creator, list, system, LIST_HEADER, &[b"list", mint.key.as_ref(), &[bump]])?;
    List { mint: *mint.key, creator: *creator.key, count: 0, sealed: false, bump }.store(list)
}

/// Appends wallets to an unsealed list: strictly ascending bytes, after the last one stored, so the list stays sorted
/// and free of repeats and `buy` can binary-search it.
fn add_to_list(a: &[AccountInfo], args: &[u8]) -> ProgramResult {
    let [global, list, creator, system] = accounts::<4>(a)?;
    signer(creator)?;
    writable(list)?;
    is(system, &SYSTEM)?;
    let g = Global::load(global)?;
    let mut l = List::load(list)?;
    ok(&l.creator == creator.key, E::Unauthorized)?;
    ok(!l.sealed, E::Sealed)?;
    let mut r = Rd::new(args, 0);
    let n = r.u32()? as usize;
    ok(n > 0 && n <= MAX_ADD && args.len() == 4 + 32 * n, E::ListChunk)?;
    let count = l.count as usize;
    ok(count + n <= g.p.max_list as usize, E::ListFull)?;

    let len = LIST_HEADER + 32 * (count + n);
    let need = Rent::get()?.minimum_balance(len);
    if list.lamports() < need { cpi::sol(creator, list, system, need - list.lamports(), None)?; }
    list.realloc(len, false)?;
    {
        // each wallet must sort after the one before it (the last stored, for the first)
        let src = &args[4..4 + 32 * n];
        let mut d = list.try_borrow_mut_data()?;
        for i in 0..n {
            let w = &src[32 * i..32 * i + 32];
            let prev = if i > 0 { &src[32 * (i - 1)..32 * i] } else if count > 0 { &d[LIST_HEADER + 32 * (count - 1)..LIST_HEADER + 32 * count] } else { &[][..] };
            if !prev.is_empty() { ok(w > prev, E::ListOrder)?; }
        }
        let at = LIST_HEADER + 32 * count;
        d[at..at + 32 * n].copy_from_slice(src);
    }
    l.count = (count + n) as u32;
    l.store(list)
}

/// Gives back an unsealed list's rent when its coin was never created.
fn close_list(a: &[AccountInfo]) -> ProgramResult {
    let [list, curve, creator] = accounts::<3>(a)?;
    signer(creator)?;
    writable(list)?;
    let l = List::load(list)?;
    ok(&l.creator == creator.key, E::Unauthorized)?;
    ok(!l.sealed, E::Sealed)?;
    let (k, _) = Pubkey::find_program_address(&[b"curve", l.mint.as_ref()], &crate::ID);
    is(curve, &k)?;
    ok(curve.data_is_empty(), E::Sealed)?;
    close(list, creator)
}

/// closes a program-owned account into `dest`
fn close(acct: &AccountInfo, dest: &AccountInfo) -> ProgramResult {
    let lamports = acct.lamports();
    **dest.try_borrow_mut_lamports()? += lamports;
    **acct.try_borrow_mut_lamports()? = 0;
    acct.realloc(0, false)?;
    acct.assign(&system_program::ID);
    Ok(())
}

// ------------------------------------------------------------------ the coin

/// Starts the curve for a mint the same transaction made, and seals the coin's list if it has one.
/// args: shield_kind u8 (0 none, 1 linear 10-300 s, 2 exponential 5-30 s), shield_secs u16, no_dev_buy bool, no_bundles bool,
/// max_wallet_bps u16 (0 none, or 50-1000), with_pass bool (optional: a dev pass, the 9th account, holds the creator's fees)
fn create(a: &[AccountInfo], r: &mut Rd) -> ProgramResult {
    let [global, creator, mint, curve, vault, vault_tokens, list, system] = accounts::<8>(a)?;
    signer(creator)?;
    writable(curve)?;
    writable(vault)?;
    is(system, &SYSTEM)?;
    let g = Global::load(global)?;
    ok(!g.p.paused, E::Paused)?;
    let (shield_kind, shield_secs, no_dev_buy) = (r.u8()?, r.u16()?, r.bool()?);
    let (no_bundles, max_wallet_bps) = (r.bool()?, r.u16()?);
    // the dev pass, if the creator picked one: the 9th account (older clients send no flag: locked to the creator)
    let with_pass = r.bool().unwrap_or(false);
    ok(match shield_kind { 0 => shield_secs == 0, 1 => (10..=300).contains(&shield_secs), 2 => (5..=30).contains(&shield_secs), _ => false }, E::BadShield)?;
    ok(max_wallet_bps == 0 || (50..=1000).contains(&max_wallet_bps), E::BadMaxWallet)?;

    let m = mint_account(mint)?;
    ok(m.no_mint_authority && m.no_freeze_authority, E::MintAuthority)?;
    ok(m.initialized && m.decimals == DECIMALS && m.supply == g.p.token_supply, E::MintSupply)?;
    let mk = mint.key.as_ref();
    let (ck, bump) = Pubkey::find_program_address(&[b"curve", mk], &crate::ID);
    let (vk, vault_bump) = Pubkey::find_program_address(&[b"vault", mk], &crate::ID);
    let (lk, list_bump) = Pubkey::find_program_address(&[b"list", mk], &crate::ID);
    is(curve, &ck)?;
    is(vault, &vk)?;
    is(list, &lk)?;
    empty(curve)?;
    ok(vault.owner == &system_program::ID, E::BadAccount)?;
    let t = token_account(vault_tokens)?;
    ok(t.mint == *mint.key && t.owner == vk && t.clean, E::BadAccount)?;
    ok(t.amount == g.p.token_supply, E::MintSupply)?;

    // the vault must stay rent-exempt however its SOL moves
    let rent_min = Rent::get()?.minimum_balance(0);
    if vault.lamports() < rent_min { cpi::sol(creator, vault, system, rent_min - vault.lamports(), None)?; }

    let mut blocked = 0u32;
    let mut list_hash = [0u8; 32];
    if list.owner == &crate::ID && !list.data_is_empty() {
        let mut l = List::load(list)?;
        ok(l.mint == *mint.key && l.creator == *creator.key, E::ListMismatch)?;
        ok(!l.sealed, E::Sealed)?;
        l.sealed = true;
        blocked = l.count;
        {
            let d = list.try_borrow_data()?;
            list_hash = hashv(&[&d[LIST_HEADER..LIST_HEADER + 32 * l.count as usize]]).to_bytes();
        }
        l.store(list)?;
    }

    let pass = if with_pass {
        let pass = a.get(8).ok_or(ProgramError::NotEnoughAccountKeys)?;
        plain_pass(pass, &ck)?;
        *pass.key
    } else {
        Pubkey::default()
    };

    cpi::create_pda(creator, curve, system, CURVE_LEN, &[b"curve", mk, &[bump]])?;
    let p = &g.p;
    let c = Curve {
        mint: *mint.key, creator: *creator.key, virtual_sol: p.virtual_sol, virtual_token: p.virtual_token, real_sol: 0, real_token: p.real_token,
        token_supply: p.token_supply, creator_fees: 0, fee_bps: p.fee_bps, creator_fee_bps: p.creator_fee_bps, migration_fee: p.migration_fee,
        migration_reserve: p.migration_reserve, blocked, list_hash, complete: false, migrated: false, bought_back: false, pool: Pubkey::default(),
        created_at: now()?, bump, vault_bump, list_bump, shield_kind, shield_secs, no_dev_buy, no_bundles, created_slot: slot()?, max_wallet_bps, pass,
    };
    c.store(curve)?;
    emit(&[&EV_CREATE, mk, creator.key.as_ref(), &blocked.to_le_bytes(), &list_hash, &c.virtual_sol.to_le_bytes(), &c.virtual_token.to_le_bytes(),
        &c.real_token.to_le_bytes(), &c.created_at.to_le_bytes(), &[shield_kind], &shield_secs.to_le_bytes(), &[no_dev_buy as u8], &[no_bundles as u8],
        &max_wallet_bps.to_le_bytes(), &c.created_slot.to_le_bytes(), pass.as_ref()]);
    Ok(())
}

struct Trade<'a, 'b> {
    curve: &'b AccountInfo<'a>,
    vault: &'b AccountInfo<'a>,
    vault_tokens: &'b AccountInfo<'a>,
    list: &'b AccountInfo<'a>,
    user: &'b AccountInfo<'a>,
    user_tokens: &'b AccountInfo<'a>,
    fee_recipient: &'b AccountInfo<'a>,
    token: &'b AccountInfo<'a>,
    system: &'b AccountInfo<'a>,
    c: Curve,
    /// what the trader holds before this trade (for the max wallet)
    held: u64,
}

fn trade_accounts<'a, 'b>(a: &'b [AccountInfo<'a>]) -> Result<Trade<'a, 'b>, ProgramError> {
    let [global, curve, mint, vault, vault_tokens, list, user, user_tokens, fee_recipient, token, system] = accounts::<11>(a)?;
    signer(user)?;
    writable(curve)?;
    let g = Global::load(global)?;
    let c = Curve::load(curve)?;
    is(mint, &c.mint)?;
    pda_is(vault, &[b"vault", c.mint.as_ref(), &[c.vault_bump]])?;
    let vt = token_account(vault_tokens)?;
    ok(vt.mint == c.mint && vt.owner == *vault.key, E::BadAccount)?;
    let ut = token_account(user_tokens)?;
    ok(ut.mint == c.mint && ut.owner == *user.key, E::BadAccount)?;
    is(fee_recipient, &g.p.fee_recipient)?;
    is(token, &TOKEN)?;
    is(system, &SYSTEM)?;
    ok(!c.complete, E::Complete)?;
    Ok(Trade { curve, vault, vault_tokens, list, user, user_tokens, fee_recipient, token, system, c, held: ut.amount })
}

/// splits a trade's fee into the platform's, the creator's and the shield's (what's above the normal fee)
fn split(c: &Curve, gross: u64, total_bps: u64) -> Result<(u64, u64, u64), ProgramError> {
    let all = mul_div(gross, total_bps, BPS)?;
    let platform = mul_div(gross, c.fee_bps as u64, BPS)?;
    let creator = mul_div(gross, c.creator_fee_bps as u64, BPS)?;
    Ok((platform, creator, all - platform - creator))
}

#[allow(clippy::too_many_arguments)]
fn emit_trade(c: &Curve, user: &Pubkey, is_buy: bool, sol: u64, tokens: u64, fee: u64, creator_fee: u64, shield: u64, t: i64) {
    emit(&[&EV_TRADE, c.mint.as_ref(), user.as_ref(), &[is_buy as u8], &sol.to_le_bytes(), &tokens.to_le_bytes(), &fee.to_le_bytes(),
        &creator_fee.to_le_bytes(), &c.virtual_sol.to_le_bytes(), &c.virtual_token.to_le_bytes(), &c.real_sol.to_le_bytes(),
        &c.real_token.to_le_bytes(), &t.to_le_bytes(), &shield.to_le_bytes()]);
}

/// Buys with up to `sol_in` lamports (fees included) and at least `min_out` tokens, checked against the coin's rules
/// until the curve completes: refused to any signer on its list, to its creator (no dev buy), in its launch slot (no
/// bundles) and past its max wallet. The buy that empties the curve completes it, paying only for what's left.
fn buy(a: &[AccountInfo], sol_in: u64, min_out: u64) -> ProgramResult {
    let x = trade_accounts(a)?;
    let mut c = x.c;
    ok(sol_in > 0, E::Zero)?;
    // no dev buy: the creator can't buy before it bonds
    if c.no_dev_buy { ok(x.user.key != &c.creator, E::DevBuy)?; }
    // no bundles: nothing buys in the launch slot
    if c.no_bundles { ok(slot()? > c.created_slot, E::Bundled)?; }
    // no KOLs: a binary search over the sealed list
    if c.blocked > 0 {
        pda_is(x.list, &[b"list", c.mint.as_ref(), &[c.list_bump]])?;
        ok(!listed(x.list, x.user.key)?, E::Bounced)?;
    }
    let t = now()?;
    // no snipers: the shield is for snipers: the creator's own buys (their first buy rides in the launch transaction) pay the normal fee
    let f = if x.user.key == &c.creator { c.fee_bps as u64 + c.creator_fee_bps as u64 } else { fee_now(&c, t) };
    let mut gross = sol_in;
    let mut net = sol_in - mul_div(sol_in, f, BPS)?;
    let k = c.virtual_sol as u128 * c.virtual_token as u128;
    let mut out = (c.virtual_token as u128 - ceil_div(k, c.virtual_sol as u128 + net as u128)?) as u64;
    let mut complete = false;
    if out >= c.real_token {
        out = c.real_token;
        net = (ceil_div(k, (c.virtual_token - out) as u128)? - c.virtual_sol as u128) as u64;
        gross = (ceil_div(net as u128 * BPS as u128, (BPS - f) as u128)? as u64).min(sol_in);
        complete = true;
    }
    ok(out > 0, E::Zero)?;
    ok(out >= min_out, E::Slippage)?;
    // max wallet: no wallet past the cap until it bonds
    if c.max_wallet_bps > 0 { ok(x.held + out <= mul_div(c.token_supply, c.max_wallet_bps as u64, BPS)?, E::OverCap)?; }
    let (fee, creator_fee, shield) = split(&c, gross, f)?;
    let net = gross - fee - creator_fee - shield;

    // the curve's SOL, the creator's share and the shield's take all wait in the vault; the platform fee goes out
    cpi::sol(x.user, x.vault, x.system, net + creator_fee + shield, None)?;
    cpi::sol(x.user, x.fee_recipient, x.system, fee, None)?;
    let seeds: &[&[u8]] = &[b"vault", c.mint.as_ref(), &[c.vault_bump]];
    cpi::token_transfer(x.vault_tokens, x.user_tokens, x.vault, x.token, out, Some(seeds))?;

    c.virtual_sol += net;
    c.virtual_token -= out;
    c.real_sol += net;
    c.real_token -= out;
    c.creator_fees += creator_fee;
    c.complete = complete;
    c.store(x.curve)?;
    emit_trade(&c, x.user.key, true, net, out, fee, creator_fee, shield, t);
    if complete { emit(&[&EV_COMPLETE, c.mint.as_ref(), x.user.key.as_ref(), &c.real_sol.to_le_bytes(), &t.to_le_bytes()]); }
    Ok(())
}

/// Sells `tokens_in` for at least `min_out` lamports after fees. Open to everyone until the curve completes.
fn sell(a: &[AccountInfo], tokens_in: u64, min_out: u64) -> ProgramResult {
    let x = trade_accounts(a)?;
    let mut c = x.c;
    ok(tokens_in > 0, E::Zero)?;
    let k = c.virtual_sol as u128 * c.virtual_token as u128;
    let gross = (c.virtual_sol as u128 - ceil_div(k, c.virtual_token as u128 + tokens_in as u128)?) as u64;
    ok(gross > 0 && gross <= c.real_sol, E::Zero)?;
    let t = now()?;
    let (fee, creator_fee, shield) = split(&c, gross, fee_now(&c, t))?;
    let out = gross - fee - creator_fee - shield;
    ok(out >= min_out, E::Slippage)?;

    cpi::token_transfer(x.user_tokens, x.vault_tokens, x.user, x.token, tokens_in, None)?;
    let seeds: &[&[u8]] = &[b"vault", c.mint.as_ref(), &[c.vault_bump]];
    cpi::sol(x.vault, x.user, x.system, out, Some(seeds))?;
    cpi::sol(x.vault, x.fee_recipient, x.system, fee, Some(seeds))?;

    c.virtual_sol -= gross;
    c.virtual_token += tokens_in;
    c.real_sol -= gross;
    c.real_token += tokens_in;
    c.creator_fees += creator_fee;
    c.store(x.curve)?;
    emit_trade(&c, x.user.key, false, gross, tokens_in, fee, creator_fee, shield, t);
    Ok(())
}

/// Pays the creator what the coin owes them. Anyone may send it; it only ever goes to the creator.
fn claim(a: &[AccountInfo]) -> ProgramResult {
    let [curve, mint, vault, creator, system] = accounts::<5>(a)?;
    writable(curve)?;
    is(system, &SYSTEM)?;
    let mut c = Curve::load(curve)?;
    is(mint, &c.mint)?;
    // locked to the creator: only their wallet. A dev pass: whoever holds it now (the pass is the 6th account)
    if c.pass == Pubkey::default() {
        is(creator, &c.creator)?;
    } else {
        let pass = a.get(5).ok_or(ProgramError::NotEnoughAccountKeys)?;
        is(pass, &c.pass)?;
        ok(pass_holder(pass)? == *creator.key, E::NotHolder)?;
    }
    let seeds: &[&[u8]] = &[b"vault", c.mint.as_ref(), &[c.vault_bump]];
    pda_is(vault, seeds)?;
    let amount = c.creator_fees;
    ok(amount > 0, E::Zero)?;
    cpi::sol(vault, creator, system, amount, Some(seeds))?;
    c.creator_fees = 0;
    c.store(curve)?;
    emit(&[&EV_CLAIM, c.mint.as_ref(), creator.key.as_ref(), &amount.to_le_bytes(), &now()?.to_le_bytes()]);
    Ok(())
}

// ------------------------------------------------------------------ the dev pass

/// A Metaplex Core asset (AssetV1): key 1, then the owner, the update authority (a tag, then a key for an address or a
/// collection), the name and uri (u32 length, bytes), and seq (an optional u64). Plugins, if any, come after.
const CORE_ASSET: u8 = 1;
const CORE_UA_ADDRESS: u8 = 1;

/// Who holds a dev pass right now: the asset's owner, read straight from the asset.
fn pass_holder(pass: &AccountInfo) -> Result<Pubkey, ProgramError> {
    ok(pass.owner == &CORE, E::BadPass)?;
    let d = pass.try_borrow_data()?;
    ok(d.len() >= 33 && d[0] == CORE_ASSET, E::BadPass)?;
    Ok(Pubkey::new_from_array(arr32(&d[1..33])))
}

/// At launch: the pass must be a plain asset (no plugins, so no permanent transfer, freeze or burn delegate can take it
/// from its holder) whose update authority is this coin's curve, a PDA that never signs for Core, so nobody can change it.
fn plain_pass(pass: &AccountInfo, curve: &Pubkey) -> ProgramResult {
    pass_holder(pass)?;
    let d = pass.try_borrow_data()?;
    let mut r = Rd::new(&d, 33);
    ok(r.u8()? == CORE_UA_ADDRESS && r.key()? == *curve, E::BadPass)?;
    let mut o = 66;
    for _ in 0..2 {
        let n = d.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize).ok_or(E::BadPass)?;
        o += 4 + n;
    }
    o += match d.get(o) { Some(0) => 1, Some(1) => 9, _ => return Err(E::BadPass.into()) };
    ok(d.len() == o, E::BadPass)
}

// ------------------------------------------------------------------ bonding

/// Moves a completed curve into a Raydium CPMM pool (a fresh keypair signs as the pool, so nobody can take its address
/// first), burns every LP token, and closes the list into the vault for the buyback. Anyone may send it.
fn migrate(a: &[AccountInfo]) -> ProgramResult {
    let [global, curve, mint, vault, vault_tokens, vault_wsol, list, fee_recipient, payer, wsol_mint, cpmm, amm_config, cpmm_authority, pool_state,
        lp_mint, vault_lp, token_0_vault, token_1_vault, create_pool_fee, observation, token, ata_program, system, rent] = accounts::<24>(a)?;
    signer(payer)?;
    signer(pool_state)?;
    writable(curve)?;
    let g = Global::load(global)?;
    let mut c = Curve::load(curve)?;
    ok(c.complete && !c.migrated, E::NotComplete)?;
    is(mint, &c.mint)?;
    let mk = c.mint;
    let seeds: &[&[u8]] = &[b"vault", mk.as_ref(), &[c.vault_bump]];
    pda_is(vault, seeds)?;
    pda_is(list, &[b"list", mk.as_ref(), &[c.list_bump]])?;
    let vt = token_account(vault_tokens)?;
    ok(vt.mint == mk && vt.owner == *vault.key, E::BadAccount)?;
    let vw = token_account(vault_wsol)?;
    ok(vw.mint == WSOL && vw.owner == *vault.key, E::BadAccount)?;
    is(fee_recipient, &g.p.fee_recipient)?;
    is(wsol_mint, &WSOL)?;
    is(cpmm, &CPMM)?;
    is(amm_config, &g.p.cpmm_config)?;
    is(token, &TOKEN)?;
    is(system, &SYSTEM)?;

    ok(c.real_sol > c.migration_fee + c.migration_reserve, E::NotComplete)?;
    let sol_for_pool = c.real_sol - c.migration_fee - c.migration_reserve;
    cpi::sol(vault, fee_recipient, system, c.migration_fee, Some(seeds))?;
    cpi::sol(vault, vault_wsol, system, sol_for_pool, Some(seeds))?;
    cpi::sync_native(vault_wsol, token)?;

    let tokens_for_pool = vt.amount;
    let mint_first = mk.as_ref() < WSOL.as_ref();
    let (m0, m1, t0, t1, amt0, amt1) = if mint_first {
        (mint, wsol_mint, vault_tokens, vault_wsol, tokens_for_pool, sol_for_pool)
    } else {
        (wsol_mint, mint, vault_wsol, vault_tokens, sol_for_pool, tokens_for_pool)
    };
    cpi::cpmm_initialize(&[
        vault.clone(), amm_config.clone(), cpmm_authority.clone(), pool_state.clone(), m0.clone(), m1.clone(), lp_mint.clone(), t0.clone(), t1.clone(),
        vault_lp.clone(), token_0_vault.clone(), token_1_vault.clone(), create_pool_fee.clone(), observation.clone(), token.clone(), token.clone(),
        token.clone(), ata_program.clone(), system.clone(), rent.clone(),
    ], amt0, amt1, seeds)?;

    // burn every LP token: the pool's liquidity can never be withdrawn
    let lp = token_account(vault_lp)?.amount;
    cpi::token_burn(vault_lp, lp_mint, vault, token, lp, seeds)?;

    c.migrated = true;
    c.pool = *pool_state.key;
    c.store(curve)?;
    // the list is done: its rent joins the vault for the buyback. Last, after every CPI: lamports moved by hand between
    // two accounts only balance once both are synced, and a CPI syncs only the accounts it's given.
    if list.owner == &crate::ID && !list.data_is_empty() { close(list, vault)?; }
    emit(&[&EV_MIGRATE, mk.as_ref(), pool_state.key.as_ref(), &sol_for_pool.to_le_bytes(), &tokens_for_pool.to_le_bytes(), &lp.to_le_bytes(),
        &now()?.to_le_bytes()]);
    Ok(())
}

/// After the pool opens: spends what's left in the vault (the list's rent, the shield's take and the unspent migration
/// reserve, never the creator's fees) buying the coin on its pool, and burns what it bought. Anyone may send it, once.
fn buyback(a: &[AccountInfo], min_out: u64) -> ProgramResult {
    let [curve, mint, vault, vault_tokens, vault_wsol, wsol_mint, payer, cpmm, cpmm_authority, amm_config, pool_state, pool_wsol_vault,
        pool_token_vault, observation, token, system] = accounts::<16>(a)?;
    signer(payer)?;
    writable(curve)?;
    let mut c = Curve::load(curve)?;
    ok(c.migrated && !c.bought_back, E::NotComplete)?;
    ok(pool_state.key == &c.pool, E::PoolMismatch)?;
    is(mint, &c.mint)?;
    let mk = c.mint;
    let seeds: &[&[u8]] = &[b"vault", mk.as_ref(), &[c.vault_bump]];
    pda_is(vault, seeds)?;
    let vt = token_account(vault_tokens)?;
    ok(vt.mint == mk && vt.owner == *vault.key, E::BadAccount)?;
    let vw = token_account(vault_wsol)?;
    ok(vw.mint == WSOL && vw.owner == *vault.key, E::BadAccount)?;
    is(wsol_mint, &WSOL)?;
    is(cpmm, &CPMM)?;
    is(token, &TOKEN)?;
    is(system, &SYSTEM)?;

    let rent_min = Rent::get()?.minimum_balance(0);
    let spare = vault.lamports().saturating_sub(rent_min).saturating_sub(c.creator_fees);
    let mut burned = 0u64;
    if spare >= MIN_BUYBACK {
        cpi::sol(vault, vault_wsol, system, spare, Some(seeds))?;
        cpi::sync_native(vault_wsol, token)?;
        cpi::cpmm_swap(&[
            vault.clone(), cpmm_authority.clone(), amm_config.clone(), pool_state.clone(), vault_wsol.clone(), vault_tokens.clone(),
            pool_wsol_vault.clone(), pool_token_vault.clone(), token.clone(), token.clone(), wsol_mint.clone(), mint.clone(), observation.clone(),
        ], spare, min_out, seeds)?;
        burned = token_account(vault_tokens)?.amount;
        cpi::token_burn(vault_tokens, mint, vault, token, burned, seeds)?;
    }
    // the wrapped-SOL account is spent: its rent goes back to whoever opened it
    cpi::close_token(vault_wsol, payer, vault, token, seeds)?;
    c.bought_back = true;
    c.store(curve)?;
    emit(&[&EV_BUYBACK, mk.as_ref(), &(if burned > 0 { spare } else { 0 }).to_le_bytes(), &burned.to_le_bytes(), &now()?.to_le_bytes()]);
    Ok(())
}
