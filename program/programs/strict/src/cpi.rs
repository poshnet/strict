//! Calls into other programs, built by hand (no spl-token crate, no Anchor): SOL transfers, PDA account creation, the
//! SPL Token instructions this program uses, and Raydium CPMM's pool creation and swap.
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const CPMM: Pubkey = pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
pub const SYSTEM: Pubkey = pubkey!("11111111111111111111111111111111");
/// Metaplex Core: a dev pass is one of its assets
pub const CORE: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const CPMM_INITIALIZE: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const CPMM_SWAP_BASE_INPUT: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];

// System program instructions, encoded by hand (its own builders go through bincode and serde, a lot of code for a
// few bytes): a u32 tag, then the arguments, little-endian.
fn sys(tag: u32, args: &[&[u8]], keys: Vec<AccountMeta>) -> Instruction {
    let mut data = tag.to_le_bytes().to_vec();
    for a in args { data.extend_from_slice(a); }
    Instruction { program_id: SYSTEM, accounts: keys, data }
}
fn sys_transfer(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    sys(2, &[&lamports.to_le_bytes()], vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)])
}
fn sys_create(from: &Pubkey, to: &Pubkey, lamports: u64, space: u64, owner: &Pubkey) -> Instruction {
    sys(0, &[&lamports.to_le_bytes(), &space.to_le_bytes(), owner.as_ref()], vec![AccountMeta::new(*from, true), AccountMeta::new(*to, true)])
}
fn sys_allocate(acct: &Pubkey, space: u64) -> Instruction { sys(8, &[&space.to_le_bytes()], vec![AccountMeta::new(*acct, true)]) }
fn sys_assign(acct: &Pubkey, owner: &Pubkey) -> Instruction { sys(1, &[owner.as_ref()], vec![AccountMeta::new(*acct, true)]) }

fn go(ix: &Instruction, infos: &[AccountInfo], seeds: Option<&[&[u8]]>) -> ProgramResult {
    match seeds {
        Some(s) => invoke_signed(ix, infos, &[s]),
        None => invoke(ix, infos),
    }
}

/// lamports from `from` (a signer, or the vault signing with `seeds`) to `to`
pub fn sol<'a>(from: &AccountInfo<'a>, to: &AccountInfo<'a>, system: &AccountInfo<'a>, lamports: u64, seeds: Option<&[&[u8]]>) -> ProgramResult {
    if lamports == 0 { return Ok(()); }
    go(&sys_transfer(from.key, to.key, lamports), &[from.clone(), to.clone(), system.clone()], seeds)
}

/// Creates a PDA owned by this program. A PDA someone already sent lamports to can't take create_account, so then it's
/// topped up, allocated and assigned instead (otherwise a 1-lamport gift would block the address).
pub fn create_pda<'a>(payer: &AccountInfo<'a>, target: &AccountInfo<'a>, system: &AccountInfo<'a>, space: usize, seeds: &[&[u8]]) -> ProgramResult {
    let rent = Rent::get()?.minimum_balance(space);
    let have = target.lamports();
    if have == 0 {
        return invoke_signed(&sys_create(payer.key, target.key, rent, space as u64, &crate::ID), &[payer.clone(), target.clone(), system.clone()], &[seeds]);
    }
    if have < rent { sol(payer, target, system, rent - have, None)?; }
    invoke_signed(&sys_allocate(target.key, space as u64), &[target.clone(), system.clone()], &[seeds])?;
    invoke_signed(&sys_assign(target.key, &crate::ID), &[target.clone(), system.clone()], &[seeds])
}

fn token_ix(data: Vec<u8>, keys: Vec<AccountMeta>) -> Instruction { Instruction { program_id: TOKEN, accounts: keys, data } }
fn with_amount(op: u8, amount: u64) -> Vec<u8> { let mut d = vec![op]; d.extend_from_slice(&amount.to_le_bytes()); d }

pub fn token_transfer<'a>(from: &AccountInfo<'a>, to: &AccountInfo<'a>, authority: &AccountInfo<'a>, token: &AccountInfo<'a>, amount: u64, seeds: Option<&[&[u8]]>) -> ProgramResult {
    let ix = token_ix(with_amount(3, amount), vec![AccountMeta::new(*from.key, false), AccountMeta::new(*to.key, false), AccountMeta::new_readonly(*authority.key, true)]);
    go(&ix, &[from.clone(), to.clone(), authority.clone(), token.clone()], seeds)
}

pub fn token_burn<'a>(account: &AccountInfo<'a>, mint: &AccountInfo<'a>, authority: &AccountInfo<'a>, token: &AccountInfo<'a>, amount: u64, seeds: &[&[u8]]) -> ProgramResult {
    let ix = token_ix(with_amount(8, amount), vec![AccountMeta::new(*account.key, false), AccountMeta::new(*mint.key, false), AccountMeta::new_readonly(*authority.key, true)]);
    go(&ix, &[account.clone(), mint.clone(), authority.clone(), token.clone()], Some(seeds))
}

pub fn sync_native<'a>(account: &AccountInfo<'a>, token: &AccountInfo<'a>) -> ProgramResult {
    go(&token_ix(vec![17], vec![AccountMeta::new(*account.key, false)]), &[account.clone(), token.clone()], None)
}

pub fn close_token<'a>(account: &AccountInfo<'a>, dest: &AccountInfo<'a>, owner: &AccountInfo<'a>, token: &AccountInfo<'a>, seeds: &[&[u8]]) -> ProgramResult {
    let ix = token_ix(vec![9], vec![AccountMeta::new(*account.key, false), AccountMeta::new(*dest.key, false), AccountMeta::new_readonly(*owner.key, true)]);
    go(&ix, &[account.clone(), dest.clone(), owner.clone(), token.clone()], Some(seeds))
}

/// CPMM `initialize`: the vault (signing) creates the pool, depositing both sides. `a` is, in CPMM's order: creator,
/// amm_config, authority, pool_state (signer), token_0_mint, token_1_mint, lp_mint, creator_token_0, creator_token_1,
/// creator_lp_token, token_0_vault, token_1_vault, create_pool_fee, observation, token_program (x3), associated token
/// program, system program, rent.
pub fn cpmm_initialize(a: &[AccountInfo], amount0: u64, amount1: u64, seeds: &[&[u8]]) -> ProgramResult {
    let mut data = CPMM_INITIALIZE.to_vec();
    data.extend_from_slice(&amount0.to_le_bytes());
    data.extend_from_slice(&amount1.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // open at once (CPMM opens it the next second)
    let w = |i: usize, s: bool| AccountMeta::new(*a[i].key, s);
    let r = |i: usize| AccountMeta::new_readonly(*a[i].key, false);
    let accounts = vec![
        w(0, true), r(1), r(2), w(3, true), r(4), r(5), w(6, false), w(7, false), w(8, false), w(9, false), w(10, false), w(11, false),
        w(12, false), w(13, false), r(14), r(15), r(16), r(17), r(18), r(19),
    ];
    invoke_signed(&Instruction { program_id: CPMM, accounts, data }, a, &[seeds])
}

/// CPMM `swap_base_input`, the vault paying: payer, authority, amm_config, pool_state, input account, output account,
/// input vault, output vault, input token program, output token program, input mint, output mint, observation.
pub fn cpmm_swap(a: &[AccountInfo], amount_in: u64, min_out: u64, seeds: &[&[u8]]) -> ProgramResult {
    let mut data = CPMM_SWAP_BASE_INPUT.to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    let w = |i: usize| AccountMeta::new(*a[i].key, false);
    let r = |i: usize| AccountMeta::new_readonly(*a[i].key, false);
    let accounts = vec![AccountMeta::new(*a[0].key, true), r(1), r(2), w(3), w(4), w(5), w(6), w(7), r(8), r(9), r(10), r(11), w(12)];
    invoke_signed(&Instruction { program_id: CPMM, accounts, data }, a, &[seeds])
}
