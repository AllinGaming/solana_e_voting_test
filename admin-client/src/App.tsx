import "./App.css";
import { useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import idl from "./idl/voting.json";

type VotingIdl = Idl & { address?: string; metadata?: { address?: string } };

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

function derivePollPda(authority: PublicKey, title: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("poll"), authority.toBuffer(), Buffer.from(title)],
    PROGRAM_ID
  );
  return pda;
}

function App() {
  const wallet = useAnchorWallet();
  const program = useVotingProgram();
  const [title, setTitle] = useState("Studentski parlament 2025");
  const [candidatesText, setCandidatesText] = useState("Ana\nMarko\nIvana");
  const [startInMinutes, setStartInMinutes] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollAddress, setPollAddress] = useState("");

  async function handleCreate() {
    if (!wallet || !program) {
      setStatus("Connect a wallet first.");
      return;
    }
    const candidates = candidatesText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (candidates.length < 2) {
      setStatus("Need at least 2 candidates.");
      return;
    }
    const startTs = Math.floor(Date.now() / 1000) + startInMinutes * 60;
    const endTs = startTs + durationMinutes * 60;
    const pollPda = derivePollPda(wallet.publicKey, title);
    setLoading(true);
    setStatus("Sending init_poll...");
    try {
      await program.methods
        .initPoll(title, candidates, new BN(startTs), new BN(endTs))
        .accounts({
          poll: pollPda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setPollAddress(pollPda.toBase58());
      setStatus(`Poll created at ${pollPda.toBase58()}`);
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
          <h1>Admin: Create Poll</h1>
          <p>Deploy program to the selected cluster and connect a wallet to create polls.</p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="card">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label>
          Candidates (one per line)
          <textarea
            value={candidatesText}
            onChange={(e) => setCandidatesText(e.target.value)}
            rows={4}
          />
        </label>

        <div className="row">
          <label>
            Start in minutes
            <input
              type="number"
              min={0}
              value={startInMinutes}
              onChange={(e) => setStartInMinutes(Number(e.target.value))}
            />
          </label>
          <label>
            Duration minutes
            <input
              type="number"
              min={1}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
          </label>
        </div>

        <button onClick={handleCreate} disabled={loading}>
          {loading ? "Creating..." : "Create poll"}
        </button>

        {pollAddress && (
          <p className="mono">
            Poll PDA: <span>{pollAddress}</span>
          </p>
        )}
        {status && <p className="status">{status}</p>}
      </div>
    </div>
  );
}

export default App;
