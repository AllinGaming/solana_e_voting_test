use anchor_lang::prelude::*; // Anchor prelude brings in common types/macros.

/// Public program id generated after `anchor keys list`.
/// Replace this with your actual program id and keep it in sync with Anchor.toml.
declare_id!("DddwKhB21GsneUinJyEN7Uax3BoePhCgqcU68FTWX7bi"); // Synced to deployed program ID.

#[program]
pub mod voting {
    use super::*; // Bring outer scope into module for easy access.

    /// Creates a new poll with a title, candidates, and schedule.
    /// Authority pays rent for the poll account and becomes the poll admin.
    pub fn init_poll(
        ctx: Context<InitPoll>,        // Accounts context for this instruction.
        title: String,                // Poll title string.
        candidates: Vec<String>,      // Candidate names.
        start_ts: i64,                // Unix start timestamp.
        end_ts: i64,                  // Unix end timestamp.
    ) -> Result<()> {
        require!(candidates.len() >= 2, VotingError::NotEnoughCandidates); // Need at least two choices.
        require!(candidates.len() <= 8, VotingError::TooManyCandidates); // Cap list size for account space.
        require!(title.len() <= 64, VotingError::TitleTooLong); // Title length bound.
        require!(start_ts < end_ts, VotingError::BadSchedule); // Start must precede end.
        for name in candidates.iter() {
            require!(!name.is_empty(), VotingError::EmptyCandidateName); // No empty candidate names.
            require!(name.len() <= 32, VotingError::CandidateNameTooLong); // Candidate length bound.
        }

        let poll = &mut ctx.accounts.poll; // Mutable handle to the poll account being created.
        poll.authority = ctx.accounts.authority.key(); // Store authority pubkey.
        poll.title = title; // Save title string.
        poll.candidates = candidates; // Save candidate list.
        poll.votes = vec![0; poll.candidates.len()]; // Initialize vote counts to zero.
        poll.start_ts = start_ts; // Save start time.
        poll.end_ts = end_ts; // Save end time.
        poll.bump = ctx.bumps.poll; // Record bump used for PDA derivation.
        Ok(())
    }

    /// Casts a single vote for a candidate index.
    /// Enforced rules:
    /// - Voting window open (start_ts <= now <= end_ts)
    /// - Candidate index in range
    /// - One vote per wallet per poll (enforced by a unique voter PDA)
    pub fn vote(ctx: Context<Vote>, candidate_idx: u8) -> Result<()> {
        let clock = Clock::get()?; // Read current cluster time.
        require!(
            clock.unix_timestamp >= ctx.accounts.poll.start_ts,
            VotingError::TooEarly
        );
        require!(
            clock.unix_timestamp <= ctx.accounts.poll.end_ts,
            VotingError::Closed
        );

        let poll = &mut ctx.accounts.poll; // Poll account to mutate.
        let idx = candidate_idx as usize; // Cast to usize for indexing.
        require!(idx < poll.candidates.len(), VotingError::BadCandidate); // Validate index in range.

        // Mark the voter PDA; creation fails if PDA already exists, preventing double-voting.
        let voter = &mut ctx.accounts.voter; // PDA unique to (poll, wallet).
        voter.has_voted = true; // Flag that this wallet voted.
        voter.poll = poll.key(); // Store poll reference.
        voter.wallet = ctx.accounts.wallet.key(); // Store voter wallet.
        voter.bump = ctx.bumps.voter; // Save bump for PDA recreation.

        // Increment selected candidate count with overflow protection.
        poll.votes[idx] = poll
            .votes[idx]
            .checked_add(1)
            .ok_or(VotingError::Overflow)?;
        Ok(())
    }
}

/// Accounts needed to initialize a poll.
#[derive(Accounts)]
#[instruction(title: String)]
pub struct InitPoll<'info> {
    #[account(
        init,
        payer = authority, // Authority funds account creation.
        space = 8 + Poll::MAX_SIZE, // Discriminator + max size for Poll.
        seeds = [b"poll", authority.key.as_ref(), title.as_bytes()], // PDA seeds.
        bump // PDA bump supplied by Anchor.
    )]
    pub poll: Account<'info, Poll>, // Poll account to create.
    #[account(mut)]
    pub authority: Signer<'info>, // Wallet paying for the poll account.
    pub system_program: Program<'info, System>, // Required for account creation.
}

/// Accounts needed to cast a vote.
#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut, has_one = authority)] // Must point to the correct authority; poll is mutable for vote counts.
    pub poll: Account<'info, Poll>, // Poll being voted on.
    /// CHECK: Read-only authority pubkey stored on the poll; no additional data is read or written.
    pub authority: AccountInfo<'info>, // Authority pubkey stored in the poll.
    #[account(
        init,
        payer = wallet, // Voter pays rent for their own record.
        seeds = [b"voter", poll.key().as_ref(), wallet.key().as_ref()], // PDA unique per (poll, wallet).
        bump,
        space = 8 + Voter::SIZE // Discriminator + size of Voter.
    )]
    pub voter: Account<'info, Voter>, // Voter record PDA to mark participation.
    #[account(mut)]
    pub wallet: Signer<'info>, // Wallet casting the vote; signs and funds the PDA.
    pub system_program: Program<'info, System>, // System program for account creation.
}

/// On-chain poll configuration and results.
#[account]
pub struct Poll {
    pub authority: Pubkey,      // Poll admin.
    pub title: String,          // Poll title.
    pub candidates: Vec<String>,// Candidate names.
    pub votes: Vec<u64>,        // Vote counts aligned with candidates.
    pub start_ts: i64,          // Start time (unix).
    pub end_ts: i64,            // End time (unix).
    pub bump: u8,               // PDA bump for poll account.
}
impl Poll {
    /// Rough sizing: authority (32) + title (4 + 64) + candidates (4 + n*(4+32))
    /// + votes (4 + n*8) + timestamps (8+8) + bump (1).
    /// Adjust upward if you allow more/longer candidates.
    pub const MAX_SIZE: usize = 32 + 4 + 64 + 4 + (8 * (4 + 32)) + 4 + (8 * 8) + 8 + 8 + 1;
}

/// Marks that a wallet has already voted in a poll.
#[account]
pub struct Voter {
    pub poll: Pubkey,    // Poll this record belongs to.
    pub wallet: Pubkey,  // Wallet that cast the vote.
    pub has_voted: bool, // Marker flag (always true once created).
    pub bump: u8,        // PDA bump for voter account.
}
impl Voter {
    /// Size calculation for the Voter account (without discriminator).
    pub const SIZE: usize = 32 + 32 + 1 + 1; // poll + wallet + has_voted + bump
}

/// Custom errors for clearer client UX.
#[error_code]
pub enum VotingError {
    #[msg("Not enough candidates")]
    NotEnoughCandidates,
    #[msg("Too many candidates")]
    TooManyCandidates,
    #[msg("Title too long")]
    TitleTooLong,
    #[msg("Start/end timestamps invalid")]
    BadSchedule,
    #[msg("Voting has not started")]
    TooEarly,
    #[msg("Voting is closed")]
    Closed,
    #[msg("Candidate index out of range")]
    BadCandidate,
    #[msg("Candidate name too long")]
    CandidateNameTooLong,
    #[msg("Candidate name cannot be empty")]
    EmptyCandidateName,
    #[msg("Arithmetic overflow")]
    Overflow,
}
