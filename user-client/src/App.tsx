import "./App.css";
import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Buffer } from "buffer";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "./idl/voting.json";
import { authApi, bindWallet, fetchBoundWallet, initFirebase, watchAuth } from "./firebase";
import type { User } from "firebase/auth";

type VotingIdl = Idl;
type PollAccount = {
  pubkey: PublicKey;
  authority: PublicKey;
  title: string;
  candidates: string[];
  votes: number[];
  startTs: number;
  endTs: number;
};

const parsedIdl = idl as unknown as VotingIdl;
const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID || parsedIdl.address || "DddwKhB21GsneUinJyEN7Uax3BoePhCgqcU68FTWX7bi"
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
  const { auth, db } = useMemo(() => initFirebase(), []);
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [boundWallet, setBoundWallet] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState("");
  const isReady =
    !!authUser &&
    !!wallet &&
    !!boundWallet &&
    boundWallet === wallet.publicKey.toBase58();

  useEffect(() => {
    const unsub = watchAuth(auth, async (u) => {
      setAuthUser(u);
      setAuthStatus(u ? `Signed in as ${u.email}` : "Not signed in");
      setBoundWallet(null);
      if (u) {
        try {
          const existing = await fetchBoundWallet(db, u.uid);
          if (existing) setBoundWallet(existing.wallet);
        } catch (e) {
          console.error(e);
          setAuthStatus(String(e));
        }
      }
    });
    return () => unsub();
  }, [auth, db]);

  async function fetchPoll(requested?: string) {
    if (!program) {
      setStatus("Connect a wallet first.");
      return;
    }
    try {
      setLoading(true);
      const addr = requested ?? pollAddress;
      if (!addr) {
        setStatus("Enter a poll PDA or load the latest.");
        return;
      }
      setStatus("Fetching poll...");
      const pubkey = new PublicKey(addr);
      const account = await (program.account as any).poll.fetch(pubkey);
      const parsed: PollAccount = {
        pubkey,
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

  async function fetchLatestPoll() {
    if (!program) {
      setStatus("Connect a wallet first.");
      return;
    }
    try {
      setLoading(true);
      setStatus("Looking up latest poll...");
      const all = await (program.account as any).poll.all();
      if (!all.length) {
        setStatus("No polls found on this cluster.");
        setPoll(null);
        setPollAddress("");
        return;
      }
      // Pick the poll with the most recent start timestamp; tie-break by lamports (newest).
      const sorted = all
        .map((item: any) => ({
          pubkey: item.publicKey as PublicKey,
          authority: item.account.authority as PublicKey,
          title: item.account.title as string,
          candidates: item.account.candidates as string[],
          votes: (item.account.votes as any[]).map((v) => Number(v)),
          startTs: Number(item.account.startTs),
          endTs: Number(item.account.endTs),
        }))
        .sort((a: PollAccount, b: PollAccount) => b.startTs - a.startTs);
      const latest = sorted[0];
      setPollAddress(latest.pubkey.toBase58());
      setPoll(latest);
      setStatus(`Loaded latest poll: ${latest.pubkey.toBase58()}`);
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
    if (!authUser) {
      setStatus("Sign in first.");
      return;
    }
    if (!boundWallet) {
      setStatus("Bind your wallet before voting.");
      return;
    }
    if (boundWallet !== wallet.publicKey.toBase58()) {
      setStatus(`Wallet mismatch. Bound: ${boundWallet}, connected: ${wallet.publicKey.toBase58()}`);
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
      setStatus("Vote submitted. Refreshing poll...");
      await fetchPoll(pollAddress); // Refresh to show updated counts.
    } catch (err) {
      console.error(err);
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    try {
      setAuthStatus("Signing in...");
      await authApi.signInWithEmailAndPassword(auth, userEmail, userPassword);
      setAuthStatus("Signed in.");
    } catch (e) {
      console.error(e);
      setAuthStatus(String(e));
    }
  }

  async function handleRegister() {
    try {
      setAuthStatus("Registering...");
      await authApi.createUserWithEmailAndPassword(auth, userEmail, userPassword);
      setAuthStatus("Registered and signed in.");
    } catch (e) {
      console.error(e);
      setAuthStatus(String(e));
    }
  }

  async function handleLogout() {
    try {
      await authApi.signOut(auth);
      setAuthStatus("Signed out.");
      setBoundWallet(null);
    } catch (e) {
      console.error(e);
      setAuthStatus(String(e));
    }
  }

  async function handleBindWallet() {
    if (!authUser) {
      setStatus("Sign in first.");
      return;
    }
    if (!wallet) {
      setStatus("Connect wallet first.");
      return;
    }
    try {
      setStatus("Binding wallet...");
      await bindWallet(db, authUser.uid, authUser.email ?? "", wallet.publicKey.toBase58());
      setBoundWallet(wallet.publicKey.toBase58());
      setStatus("Wallet bound.");
    } catch (e) {
      console.error(e);
      setStatus(String(e));
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>User: Vote</h1>
          <p>Sign in, bind your wallet, load a poll, and cast a single vote.</p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="card">
        <h3>Login / Register</h3>
        <div className="row">
          <input
            type="email"
            placeholder="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="password"
            value={userPassword}
            onChange={(e) => setUserPassword(e.target.value)}
          />
        </div>
        <div className="row">
          {!authUser && (
            <>
              <button onClick={handleLogin}>Login</button>
              <button onClick={handleRegister}>Register</button>
            </>
          )}
          {authUser && <button onClick={handleLogout}>Logout</button>}
        </div>
        <p className="status">{authStatus}</p>
        <div className="row">
          <button onClick={handleBindWallet} disabled={!wallet}>
            Bind connected wallet
          </button>
          {boundWallet && <span className="mono">Bound: {boundWallet}</span>}
        </div>
      </div>

      {!isReady ? (
        <div className="card">
          <h3>Bind before voting</h3>
          <p>
            Sign in, connect your wallet, and bind it. Voting appears once bound.
          </p>
        </div>
      ) : (
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
            <button onClick={() => fetchPoll()} disabled={loading || !pollAddress}>
              {loading ? "Loading..." : "Load poll"}
            </button>
            <button onClick={fetchLatestPoll} disabled={loading}>
              {loading ? "Loading..." : "Load latest poll"}
            </button>
            {poll && (
              <button onClick={castVote} disabled={loading}>
                {loading ? "Submitting..." : "Cast vote"}
              </button>
            )}
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
      )}
    </div>
  );
}

export default App;
