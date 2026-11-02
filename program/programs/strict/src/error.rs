//! The program's errors. Codes start at 6000 (where Anchor's would), so clients read them the same way; each one logs its
//! name first, so a failed transaction's logs say what went wrong.
use solana_program::{msg, program_error::ProgramError};

#[derive(Clone, Copy)]
pub enum E {
    Bounced = 6000,
    Complete,
    NotComplete,
    Slippage,
    Zero,
    Sealed,
    ListFull,
    ListOrder,
    ListChunk,
    ListMismatch,
    MintAuthority,
    MintSupply,
    Paused,
    BadParams,
    PoolMismatch,
    Math,
    Unauthorized,
    BadAccount,
    DevBuy,
    BadShield,
    NotSigner,
    NotWritable,
    AlreadyInitialized,
    Bundled,
    OverCap,
    BadMaxWallet,
    BadPass,
    NotHolder,
}

impl From<E> for ProgramError {
    fn from(e: E) -> Self {
        // literal logs only: formatting would pull core::fmt into the binary
        match e {
            E::Bounced => msg!("Error Code: Bounced. Error Number: 6000. This wallet is bounced from this coin until it bonds."),
            E::Complete => msg!("Error Code: Complete. The curve is complete: it trades on its pool now."),
            E::NotComplete => msg!("Error Code: NotComplete. The curve hasn't completed."),
            E::Slippage => msg!("Error Code: Slippage. Price moved past your slippage."),
            E::Zero => msg!("Error Code: Zero. Amount is zero."),
            E::Sealed => msg!("Error Code: Sealed. The list is sealed."),
            E::ListFull => msg!("Error Code: ListFull. The list is full."),
            E::ListOrder => msg!("Error Code: ListOrder. Wallets must be sorted, after the last one on the list."),
            E::ListChunk => msg!("Error Code: ListChunk. Between 1 and 28 wallets at a time."),
            E::ListMismatch => msg!("Error Code: ListMismatch. That list isn't this coin's."),
            E::MintAuthority => msg!("Error Code: MintAuthority. The mint still has a mint or freeze authority."),
            E::MintSupply => msg!("Error Code: MintSupply. The mint's supply isn't all in the curve."),
            E::Paused => msg!("Error Code: Paused. New coins are paused."),
            E::BadParams => msg!("Error Code: BadParams. Bad settings."),
            E::PoolMismatch => msg!("Error Code: PoolMismatch. That isn't this coin's pool."),
            E::Math => msg!("Error Code: Math. Math overflow."),
            E::Unauthorized => msg!("Error Code: Unauthorized. Only the admin can do that."),
            E::BadAccount => msg!("Error Code: BadAccount. An account isn't the one this instruction needs."),
            E::DevBuy => msg!("Error Code: DevBuy. This coin's creator can't buy it before it bonds."),
            E::BadShield => msg!("Error Code: BadShield. A snipe shield is 5-30 s exponential or 10-300 s linear."),
            E::NotSigner => msg!("Error Code: NotSigner. A required signature is missing."),
            E::NotWritable => msg!("Error Code: NotWritable. An account must be writable."),
            E::AlreadyInitialized => msg!("Error Code: AlreadyInitialized. That account already exists."),
            E::Bundled => msg!("Error Code: Bundled. Nothing can buy this coin in the block it was created in."),
            E::OverCap => msg!("Error Code: OverCap. This buy would take the wallet past the coin's max wallet."),
            E::BadMaxWallet => msg!("Error Code: BadMaxWallet. A max wallet is 0.5-10% of the supply."),
            E::BadPass => msg!("Error Code: BadPass. A dev pass is a plain Metaplex Core asset (no plugins) that only this coin's curve can update."),
            E::NotHolder => msg!("Error Code: NotHolder. Creator fees go to whoever holds the coin's dev pass."),
        }
        ProgramError::Custom(e as u32)
    }
}
