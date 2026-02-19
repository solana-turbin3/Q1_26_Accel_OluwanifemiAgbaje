use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::state::UserAccount;

#[vrf]
#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [b"user", user.key().as_ref()], 
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: The oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}
impl<'info> RequestRandomness<'info> {
pub fn request(&mut self, client_seed: u8, discriminator: &'static [u8]) -> Result<()> {

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: self.user.key(),
            oracle_queue: self.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: discriminator.to_vec(),
            caller_seed: [client_seed; 32],

            // Specify any account that is required by the callback
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: self.user.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        self.invoke_signed_vrf(&self.user.to_account_info(), &ix)?;
    Ok(())
}
}