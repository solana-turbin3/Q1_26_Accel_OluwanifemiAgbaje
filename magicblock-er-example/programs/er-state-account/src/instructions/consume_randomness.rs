use anchor_lang::prelude::*;

use crate::state::UserAccount;

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(mut)]
    pub user: Account<'info, UserAccount>,

    #[account(
        address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY
    )]
    pub vrf_program_identity: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> ConsumeRandomness<'info> {
pub fn consume(&mut self, randomness: [u8; 32]) -> Result<()> {
    let random_no = ephemeral_vrf_sdk::rnd::random_u64(&randomness);
     msg!("Consuming random number: {:?}", random_no);
        self.user.data = random_no;
    Ok(())
}}
