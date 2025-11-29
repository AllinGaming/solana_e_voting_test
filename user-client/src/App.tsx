import "./App.css";
import { useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Buffer } from "buffer";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "./idl/voting.json";

type VotingIdl = Idl & { address?: string; metadata?: { address?: string } };
type PollAccount = {
  authority: PublicKey;
  title: string;
  candidates: string[];
  votes: number[];
  startTs: number;
  endTs: number;
};

const parsedIdl = idl as unknown as VotingIdl;
const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ||
    parsedIdl.address ||
    parsedIdl.metadata?.address ||
    "Vote111111111111111111111111111111111111111"
);

function useVotingProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const hydratedIdl: VotingIdl = { ...parsedIdl, address: PROGRAM_ID.toBase58() };
    return new Program<VotingIdl>(hydratedIdl, provider);
  }, [connection, wallet]);
}

function deriveVoterPda(poll: PublicKey, wallet: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("voter"), poll.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function App() {
  const wallet = useAnchorWallet();
  const program = useVotingProgram();
  const [pollAddress, setPollAddress] = useState("");
  const [poll, setPoll] = useState<PollAccount | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchPoll() {
    if (!program) {
      setStatus("Connect a wallet first.");
      return;
    }
    try {
      setLoading(true);
      setStatus("Fetching poll...");
      const account = await (program.account as any).poll.fetch(new PublicKey(pollAddress));
      const parsed: PollAccount = {
        authority: account.authority,
        title: account.title,
        candidates: account.candidates,
        votes: account.votes.map((v: any) => Number(v)),
        startTs: Number(account.startTs),
        endTs: Number(account.endTs),
      };
      setPoll(parsed);
      setStatus("Poll loaded.");
    } catch (err) {
      console.error(err);
      setStatus(String(err));
      setPoll(null);
    } finally {
      setLoading(false);
    }
  }

  async function castVote() {
    if (!wallet || !program) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!poll) {
      setStatus("Load a poll first.");
      return;
    }
    if (selectedIdx === null || selectedIdx < 0 || selectedIdx >= poll.candidates.length) {
      setStatus("Select a candidate.");
      return;
    }
    try {
      setLoading(true);
      setStatus("Sending vote...");
      const pollPk = new PublicKey(pollAddress);
      const voterPda = deriveVoterPda(pollPk, wallet.publicKey);
      await program.methods
        .vote(selectedIdx)
        .accounts({
          poll: pollPk,
          authority: poll.authority,
          voter: voterPda,
          wallet: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus("Vote submitted.");
    } catch (err) {
      console.error(err);
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>User: Vote</h1>
          <p>Enter a poll PDA, load it, pick a candidate, and send a vote.</p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="card">
        <label>
          Poll PDA
          <input
            value={pollAddress}
            onChange={(e) => setPollAddress(e.target.value.trim())}
            placeholder="Poll account address"
          />
        </label>
        <div className="row">
          <button onClick={fetchPoll} disabled={loading || !pollAddress}>
            {loading ? "Loading..." : "Load poll"}
          </button>
          <button onClick={castVote} disabled={loading || !poll}>
            {loading ? "Submitting..." : "Cast vote"}
          </button>
        </div>

        {poll && (
          <div className="poll">
            <p className="mono">Authority: {poll.authority.toBase58()}</p>
            <h3>{poll.title}</h3>
            <ul>
              {poll.candidates.map((name, idx) => (
                <li key={idx}>
                  <label className="option">
                    <input
                      type="radio"
                      name="candidate"
                      value={idx}
                      checked={selectedIdx === idx}
                      onChange={() => setSelectedIdx(idx)}
                    />
                    <span>
                      {name} ({poll.votes[idx] ?? 0} votes)
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="mono">
              Window: {new Date(poll.startTs * 1000).toLocaleString()} →{" "}
              {new Date(poll.endTs * 1000).toLocaleString()}
            </p>
          </div>
        )}

        {status && <p className="status">{status}</p>}
      </div>
    </div>
  );
}

export default App;
