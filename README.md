## Solana e-voting

Anchor program + simple TypeScript client. Votes and results live fully on-chain; Firebase Auth (UI-side) gates access. Firestore is optional but recommended to bind a Firebase user to a single wallet.

### Project structure
- `Anchor.toml` / `Cargo.toml`: Anchor workspace config.
- `programs/voting/src/lib.rs`: Rust smart contract (heavily commented).
- `client/`: Minimal TS script to init a poll and vote (for demos or integration tests), plus Firebase bootstrap helpers.
- `admin-client/`: Vite + React admin UI to create polls (wallet adapter + Anchor).
- `user-client/`: Vite + React voter UI to load a poll PDA and cast a vote (wallet adapter + Anchor).

### Prereqs
- Rust + Solana CLI + Anchor CLI installed.
- Localnet by default: Anchor provider is set to `Localnet` and the TS client defaults to `http://127.0.0.1:8899`. Run `solana-test-validator --reset` in a separate shell (or let `anchor test` manage it).
- Keypair: `solana-keygen new -o ~/.config/solana/id.json`. Localnet airdrops are free.
- Node 18+ for the client script.

### Environment files
- Copy `client/.env.example` to `client/.env.local` and fill in:
  - `PRIVATE_KEY` (base58 array from your Solana keypair; never commit this).
  - Firebase web config keys (`FIREBASE_*` from Firebase console).

### Configure program id
1) Run `anchor keys list` to generate the program key.
2) Update both `Anchor.toml` and `programs/voting/src/lib.rs` `declare_id!` with that value.

### Build, test, deploy
```bash
# Build
anchor build

# (Optional) Localnet test
anchor test

# Deploy (localnet by default; ensure validator is running)
anchor deploy
# To deploy to devnet instead, set provider cluster to Devnet (or override via ANCHOR_PROVIDER_URL/SOLANA_URL) and rerun:
# anchor deploy --provider.cluster devnet
```

### Client script (for quick manual calls)
```bash
cd client
npm install
# Uses .env.local if present; otherwise set PRIVATE_KEY inline
npm start
```
- Script uses `client/src/index.ts` to:
  - Derive PDAs like the program.
  - Call `init_poll` with sample data.
  - Call `vote` for candidate 0.
- Swap the title/candidates/time window and the private key to fit your test.
  - Defaults to localnet. To target devnet instead, set `SOLANA_RPC_URL=https://api.devnet.solana.com` and deploy your program there (update `Anchor.toml`/`declare_id!`).

### Web clients (admin + user)
- Admin (create polls): `cd admin-client && cp .env.example .env.local && npm install && npm run dev`
  - Fill `VITE_PROGRAM_ID` and `VITE_RPC_URL` to match your deployment.
  - Connect a wallet (Phantom/Solflare supported out of the box), enter title/candidates/start/duration, and create the poll. The UI shows the poll PDA to share.
- User (vote): `cd user-client && cp .env.example .env.local && npm install && npm run dev`
  - Fill the same env vars; enter the poll PDA from the admin and load the poll, then pick a candidate and vote.
  - Uses the same wallet adapter setup; ensure the poll exists on the cluster you point to.

### Firebase + Firestore (bind email -> wallet)
- Client bootstrap helper: `client/src/firebase.ts` exports `initFirebase()` (returns `{ app, auth, db }`), `getBoundWallet`, and `bindWalletOnce`.
- Enable Firebase Auth (email/password or your preferred providers).
- Firestore: collection `user_wallets` with doc id = Firebase UID, fields: `email`, `wallet`.
- Frontend flow to prevent wallet swapping:
  1) User signs in; client fetches `user_wallets/{uid}` (`getBoundWallet` helper).
  2) If missing, prompt to connect wallet, then `signMessage` proving ownership, then call `bindWalletOnce(db, uid, email, wallet)`. Reject further changes once set.
  3) If present, require the same wallet public key; block UI if a different wallet is connected.
- This binds a Firebase identity to exactly one wallet (client-enforced + Firestore rule).

### Firebase rules (sketch)
```jsonc
// Allow user to write their wallet only if not yet set; allow read to the owner.
{
  "rules": {
    "user_wallets": {
      "$uid": {
        ".read": "request.auth != null && request.auth.uid == $uid",
        ".write": "request.auth != null && request.auth.uid == $uid && !('wallet' in resource.data)"
      }
    }
  }
}
```

### Double-vote protection
- On-chain: `Voter` PDA is unique per `(poll, wallet)`. The `vote` instruction `init`s the PDA; any second attempt with the same wallet/poll fails at account creation, preventing double-votes even if the frontend is bypassed.
- Frontend: also check Firestore binding so a user cannot switch to a second wallet (one-user-one-wallet).

### Program design (key points)
- `Poll` account: title, candidates, vote counts, start/end timestamps, authority. Enforced limits: 2–8 candidates, each name 1–32 chars, title up to 64 chars.
- `Voter` PDA: unique per (poll, wallet); creation blocks double-voting.
- Schedule enforced on-chain (`TooEarly`/`Closed` errors).
- Storage bounds: up to ~8 candidates of ~32 chars each by default (`MAX_SIZE`).

### Notes / next steps
- Add an admin instruction if you need to close polls early or reclaim lamports.
- If you require a hard allowlist, add an on-chain whitelist PDA or reintroduce a Firestore allowlist check in the UI.
- Keep comments/docstrings in sync as you evolve the program for your finals.
- Quick manual test checklist:
  - `anchor build && anchor deploy` (devnet).
  - Run `client` script with your keypair to create a poll and cast one vote.
  - Try voting again with the same wallet on the same poll → should fail (PDA already exists).
  - Connect a different wallet → should be able to cast once (unless blocked by your Firestore binding).
  - Toggle `start_ts/end_ts` to ensure `TooEarly` and `Closed` errors trigger when expected.

### Moving to GitHub / another machine
- Commit everything except secrets (env files, keypairs). `.gitignore` already covers common cases.
- Push to GitHub, then on the new machine:
  1) Clone the repo.
  2) Install Rust/Solana/Anchor CLI as usual.
  3) `cd client && npm install`.
  4) Copy `.env.example` → `.env.local` and fill in `PRIVATE_KEY` + `FIREBASE_*`.
  5) `anchor build && anchor deploy` or point to your existing deployed program id in `Anchor.toml` and `programs/voting/src/lib.rs`.
