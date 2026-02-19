#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;

mod state;
mod instructions;

use instructions::*;

declare_id!("3guFRQANk2kcU4LQVekbw7T8iF1jts85FDuz8JzQEjvp");

#[program]
pub mod tuktuk_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64, task_id: u16, expiry: i64,) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, expiry, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
         ctx.accounts.schedule(task_id, &ctx.bumps)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw_and_close_vault()
    }
}
