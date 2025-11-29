# Solana E-Voting – Architecture & Flow

## Purpose
An on-chain voting system for a student parliament. Polls and votes live on Solana; Firebase Auth + wallet binding guard the UI so each Firebase user is tied to exactly one wallet and can vote once per poll.

## Components
- **Anchor program** (`programs/voting`): Smart contract enforcing poll creation, schedule, candidate bounds, and one-vote-per-wallet via PDAs.
- **CLI helper** (`client/`): Node/ts-node script for quick init/vote calls and integration checks; loads keypairs from env or `~/.config/solana/id.json`.
- **Admin web app** (`admin-client/`): React/Vite UI with Solana wallet adapter and Anchor client to create polls. Produces the poll PDA to share.
- **User web app** (`user-client/`): React/Vite UI to load a poll PDA, display candidates/results, and cast a vote with a connected wallet.
- **Firebase helpers** (`client/src/firebase.ts`): Auth/Firestore bootstrap + wallet-binding utilities (UID → wallet, write-once).

## High-level flow
1) **Deploy program**: `anchor build && anchor deploy` (localnet by default). Update `declare_id!`, `Anchor.toml`, and web env `VITE_PROGRAM_ID`.
2) **Admin creates poll**:
   - Opens `admin-client`, connects wallet (Phantom/Solflare), fills title/candidates/start/end, and submits.
   - Derives poll PDA with seeds `[ "poll", authority, title ]`; sends `init_poll`; shares poll PDA.
3) **User votes**:
   - Opens `user-client`, connects wallet, enters poll PDA, loads poll data.
   - Selects candidate, derives voter PDA with seeds `[ "voter", poll, wallet ]`, sends `vote`.
4) **Wallet binding (optional but recommended)**:
   - Frontend enforces Firebase UID → wallet write-once via Firestore rules; prevents swapping wallets to double-vote across accounts.

## On-chain guarantees
- One vote per wallet per poll: voter PDA init fails on second attempt.
- Schedule enforced: `TooEarly`/`Closed` errors.
- Candidate/title size bounds: title ≤ 64 chars; candidates 2–8, each 1–32 chars.
- Overflow checks on vote increments.

## Off-chain assumptions & limitations
- No on-chain allowlist: anyone can call `init_poll`/`vote` on the cluster you deploy to. App-level auth must restrict UI access if needed.
- No on-chain tally visibility gating: anyone can read Poll accounts. Privacy is out of scope.
- Poll mutation: no instruction to close/reclaim rent or edit polls; only create/vote.
- Time trust: uses cluster time (`Clock`). Ensure validator/cluster time is sane.
- Frontend wallet binding is client-enforced + Firestore rules; a malicious client bypassing UI could still vote on-chain with another wallet unless further on-chain checks are added.

## Environments
- **Localnet default**: `Anchor.toml` provider is Localnet; web apps default RPC `http://127.0.0.1:8899`. Override with `VITE_RPC_URL`/`SOLANA_RPC_URL`.
- **Devnet**: set provider to Devnet, redeploy, and update `VITE_PROGRAM_ID`/`PROGRAM_ID` to the deployed address.

## Setup quickstart
- Program: `anchor build && anchor deploy`; copy generated `target/idl/voting.json` into `admin-client/src/idl/` and `user-client/src/idl/`.
- Admin app: `cd admin-client && cp .env.example .env.local` → set `VITE_PROGRAM_ID`/`VITE_RPC_URL` → `npm run dev`.
- User app: `cd user-client && cp .env.example .env.local` → same env values → `npm run dev`.
- CLI script: `cd client && cp .env.example .env.local` → set `PRIVATE_KEY` (base58) and optional `SOLANA_RPC_URL` → `npm start`.

## Future enhancements
- Add admin-only close/reclaim lamports instruction.
- Add on-chain admin allowlist or role-based access.
- Add result pagination/indexing service for large numbers of polls.
- Improve frontend error handling and display partial tallies with live account subscriptions.
