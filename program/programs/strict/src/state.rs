//! Account layouts: an 8-byte discriminator, then little-endian fields in a fixed order (the same bytes Anchor's Borsh
//! layout produced, so every client decodes them unchanged). The list is its header followed by raw 32-byte wallets.
use crate::error::E;
use solana_program::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

pub const DISC_GLOBAL: [u8; 8] = [167, 232, 232, 177, 200, 108, 114, 127];
pub const DISC_CURVE: [u8; 8] = [191, 180, 249, 66, 180, 71, 51, 182];
pub const DISC_LIST: [u8; 8] = [169, 24, 186, 110, 22, 139, 190, 82];

pub const GLOBAL_LEN: usize = 8 + 154;
pub const CURVE_LEN: usize = 8 + 261;
pub const LIST_HEADER: usize = 78;

/// a cursor over account or instruction bytes
pub struct Rd<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Rd<'a> {
    pub fn new(b: &'a [u8], o: usize) -> Self { Rd { b, o } }
    fn take(&mut self, n: usize) -> Result<&'a [u8], ProgramError> {
        let s = self.b.get(self.o..self.o + n).ok_or(ProgramError::InvalidAccountData)?;
        self.o += n;
        Ok(s)
    }
    pub fn u8(&mut self) -> Result<u8, ProgramError> { Ok(self.take(1)?[0]) }
    pub fn bool(&mut self) -> Result<bool, ProgramError> { Ok(self.u8()? != 0) }
    pub fn u16(&mut self) -> Result<u16, ProgramError> { let s = self.take(2)?; Ok(u16::from_le_bytes([s[0], s[1]])) }
    pub fn u32(&mut self) -> Result<u32, ProgramError> { let s = self.take(4)?; Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]])) }
    pub fn u64(&mut self) -> Result<u64, ProgramError> { Ok(u64::from_le_bytes(crate::arr8(self.take(8)?))) }
    pub fn i64(&mut self) -> Result<i64, ProgramError> { Ok(i64::from_le_bytes(crate::arr8(self.take(8)?))) }
    pub fn key(&mut self) -> Result<Pubkey, ProgramError> { Ok(Pubkey::new_from_array(crate::arr32(self.take(32)?))) }
    pub fn bytes32(&mut self) -> Result<[u8; 32], ProgramError> { Ok(crate::arr32(self.take(32)?)) }
}

/// a writer into a byte buffer
pub struct Wr<'a> {
    b: &'a mut [u8],
    o: usize,
}

impl<'a> Wr<'a> {
    pub fn new(b: &'a mut [u8]) -> Self { Wr { b, o: 0 } }
    pub fn put(&mut self, s: &[u8]) -> &mut Self { self.b[self.o..self.o + s.len()].copy_from_slice(s); self.o += s.len(); self }
    pub fn u8(&mut self, v: u8) -> &mut Self { self.put(&[v]) }
    pub fn bool(&mut self, v: bool) -> &mut Self { self.u8(v as u8) }
    pub fn u16(&mut self, v: u16) -> &mut Self { self.put(&v.to_le_bytes()) }
    pub fn u32(&mut self, v: u32) -> &mut Self { self.put(&v.to_le_bytes()) }
    pub fn u64(&mut self, v: u64) -> &mut Self { self.put(&v.to_le_bytes()) }
    pub fn i64(&mut self, v: i64) -> &mut Self { self.put(&v.to_le_bytes()) }
    pub fn key(&mut self, k: &Pubkey) -> &mut Self { self.put(k.as_ref()) }
}

/// an account this program owns, with the expected discriminator
pub fn owned<'a>(a: &AccountInfo<'a>, disc: &[u8; 8]) -> Result<(), ProgramError> {
    if a.owner != &crate::ID { return Err(E::BadAccount.into()); }
    let d = a.try_borrow_data()?;
    if d.len() < 8 || &d[..8] != disc { return Err(E::BadAccount.into()); }
    Ok(())
}

#[derive(Clone)]
pub struct Params {
    pub fee_recipient: Pubkey,
    pub cpmm_config: Pubkey,
    pub fee_bps: u16,
    pub creator_fee_bps: u16,
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub real_token: u64,
    pub token_supply: u64,
    pub migration_fee: u64,
    pub migration_reserve: u64,
    pub max_list: u32,
    pub paused: bool,
}

impl Params {
    pub fn read(r: &mut Rd) -> Result<Self, ProgramError> {
        Ok(Params {
            fee_recipient: r.key()?, cpmm_config: r.key()?, fee_bps: r.u16()?, creator_fee_bps: r.u16()?, virtual_sol: r.u64()?,
            virtual_token: r.u64()?, real_token: r.u64()?, token_supply: r.u64()?, migration_fee: r.u64()?, migration_reserve: r.u64()?,
            max_list: r.u32()?, paused: r.bool()?,
        })
    }
    pub fn check(&self) -> Result<(), ProgramError> {
        let ok = self.fee_bps as u64 + self.creator_fee_bps as u64 <= 500
            && self.virtual_sol > 0 && self.real_token > 0 && self.real_token < self.virtual_token && self.real_token < self.token_supply
            && self.max_list > 0 && self.max_list <= 2_000;
        if ok { Ok(()) } else { Err(E::BadParams.into()) }
    }
}

pub struct Global {
    pub authority: Pubkey,
    pub p: Params,
    pub bump: u8,
}

impl Global {
    pub fn load(a: &AccountInfo) -> Result<Self, ProgramError> {
        owned(a, &DISC_GLOBAL)?;
        let d = a.try_borrow_data()?;
        let mut r = Rd::new(&d, 8);
        let authority = r.key()?;
        let p = Params::read(&mut r)?;
        Ok(Global { authority, p, bump: r.u8()? })
    }
    pub fn store(&self, a: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = a.try_borrow_mut_data()?;
        let p = &self.p;
        Wr::new(&mut d).put(&DISC_GLOBAL).key(&self.authority).key(&p.fee_recipient).key(&p.cpmm_config).u16(p.fee_bps).u16(p.creator_fee_bps)
            .u64(p.virtual_sol).u64(p.virtual_token).u64(p.real_token).u64(p.token_supply).u64(p.migration_fee).u64(p.migration_reserve)
            .u32(p.max_list).bool(p.paused).u8(self.bump);
        Ok(())
    }
}

pub struct Curve {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub virtual_sol: u64,
    pub virtual_token: u64,
    pub real_sol: u64,
    pub real_token: u64,
    pub token_supply: u64,
    /// lamports owed to the creator, held in the vault until claimed
    pub creator_fees: u64,
    pub fee_bps: u16,
    pub creator_fee_bps: u16,
    pub migration_fee: u64,
    pub migration_reserve: u64,
    /// wallets on the sealed list, and the sha256 of their bytes in order
    pub blocked: u32,
    pub list_hash: [u8; 32],
    pub complete: bool,
    pub migrated: bool,
    pub bought_back: bool,
    pub pool: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub list_bump: u8,
    /// the snipe shield: 0 none, 1 linear, 2 exponential; how long it lasts
    pub shield_kind: u8,
    pub shield_secs: u16,
    /// the creator's wallet can't buy before it bonds
    pub no_dev_buy: bool,
    /// nothing can buy in the slot the coin was created in
    pub no_bundles: bool,
    pub created_slot: u64,
    /// no wallet can buy past this share of the supply before it bonds, in basis points (0: no cap)
    pub max_wallet_bps: u16,
    /// the dev pass: a Metaplex Core asset whose holder is paid the creator's fees (all zeros: locked to the creator)
    pub pass: Pubkey,
}

impl Curve {
    pub fn load(a: &AccountInfo) -> Result<Self, ProgramError> {
        owned(a, &DISC_CURVE)?;
        let d = a.try_borrow_data()?;
        let mut r = Rd::new(&d, 8);
        Ok(Curve {
            mint: r.key()?, creator: r.key()?, virtual_sol: r.u64()?, virtual_token: r.u64()?, real_sol: r.u64()?, real_token: r.u64()?,
            token_supply: r.u64()?, creator_fees: r.u64()?, fee_bps: r.u16()?, creator_fee_bps: r.u16()?, migration_fee: r.u64()?,
            migration_reserve: r.u64()?, blocked: r.u32()?, list_hash: r.bytes32()?, complete: r.bool()?, migrated: r.bool()?,
            bought_back: r.bool()?, pool: r.key()?, created_at: r.i64()?, bump: r.u8()?, vault_bump: r.u8()?, list_bump: r.u8()?,
            shield_kind: r.u8()?, shield_secs: r.u16()?, no_dev_buy: r.bool()?, no_bundles: r.bool()?, created_slot: r.u64()?,
            max_wallet_bps: r.u16()?, pass: r.key()?,
        })
    }
    pub fn store(&self, a: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = a.try_borrow_mut_data()?;
        Wr::new(&mut d).put(&DISC_CURVE).key(&self.mint).key(&self.creator).u64(self.virtual_sol).u64(self.virtual_token).u64(self.real_sol)
            .u64(self.real_token).u64(self.token_supply).u64(self.creator_fees).u16(self.fee_bps).u16(self.creator_fee_bps)
            .u64(self.migration_fee).u64(self.migration_reserve).u32(self.blocked).put(&self.list_hash).bool(self.complete)
            .bool(self.migrated).bool(self.bought_back).key(&self.pool).i64(self.created_at).u8(self.bump).u8(self.vault_bump)
            .u8(self.list_bump).u8(self.shield_kind).u16(self.shield_secs).bool(self.no_dev_buy).bool(self.no_bundles).u64(self.created_slot)
            .u16(self.max_wallet_bps).key(&self.pass);
        Ok(())
    }
}

pub struct List {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub count: u32,
    pub sealed: bool,
    pub bump: u8,
}

impl List {
    pub fn load(a: &AccountInfo) -> Result<Self, ProgramError> {
        owned(a, &DISC_LIST)?;
        let d = a.try_borrow_data()?;
        let mut r = Rd::new(&d, 8);
        Ok(List { mint: r.key()?, creator: r.key()?, count: r.u32()?, sealed: r.bool()?, bump: r.u8()? })
    }
    pub fn store(&self, a: &AccountInfo) -> Result<(), ProgramError> {
        let mut d = a.try_borrow_mut_data()?;
        Wr::new(&mut d[..LIST_HEADER]).put(&DISC_LIST).key(&self.mint).key(&self.creator).u32(self.count).bool(self.sealed).u8(self.bump);
        Ok(())
    }
}

/// An SPL token account's fields this program checks (the 165-byte layout).
pub struct TokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub clean: bool, // initialized, no delegate, no close authority
}

pub fn token_account(a: &AccountInfo) -> Result<TokenAccount, ProgramError> {
    if a.owner != &crate::cpi::TOKEN { return Err(E::BadAccount.into()); }
    let d = a.try_borrow_data()?;
    if d.len() != 165 { return Err(E::BadAccount.into()); }
    let mut r = Rd::new(&d, 0);
    let mint = r.key()?;
    let owner = r.key()?;
    let amount = r.u64()?;
    let delegate = r.u32()?;
    let clean = delegate == 0 && d[108] == 1 && d[129..133] == [0, 0, 0, 0];
    Ok(TokenAccount { mint, owner, amount, clean })
}

/// An SPL mint's fields this program checks (the 82-byte layout).
pub struct Mint {
    pub no_mint_authority: bool,
    pub supply: u64,
    pub decimals: u8,
    pub initialized: bool,
    pub no_freeze_authority: bool,
}

pub fn mint_account(a: &AccountInfo) -> Result<Mint, ProgramError> {
    if a.owner != &crate::cpi::TOKEN { return Err(E::BadAccount.into()); }
    let d = a.try_borrow_data()?;
    if d.len() != 82 { return Err(E::BadAccount.into()); }
    let mut r = Rd::new(&d, 0);
    let auth = r.u32()?;
    let _ = r.key()?;
    let supply = r.u64()?;
    let decimals = r.u8()?;
    let initialized = r.bool()?;
    let freeze = r.u32()?;
    Ok(Mint { no_mint_authority: auth == 0, supply, decimals, initialized, no_freeze_authority: freeze == 0 })
}
