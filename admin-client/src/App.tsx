import "./App.css";
import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Buffer } from "buffer";
import idl from "./idl/voting.json";
import { authApi, bindWallet, fetchBoundWallet, initFirebase, watchAuth } from "./firebase";
import type { User } from "firebase/auth";

type VotingIdl = Idl;

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
    const hydratedIdl: VotingIdl = {
      ...parsedIdl,
      address: PROGRAM_ID.toBase58(),
    };
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
  const { auth, db } = useMemo(() => initFirebase(), []);
  const [title, setTitle] = useState("Studentski parlament 2025");
  const [candidatesText, setCandidatesText] = useState("Ana\nMarko\nIvana");
  const [startInMinutes, setStartInMinutes] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollAddress, setPollAddress] = useState("");
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

  async function handleCreate() {
    if (!wallet || !program) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!authUser) {
      setStatus("Sign in first.");
      return;
    }
    const walletPk = wallet.publicKey.toBase58();
    if (!boundWallet) {
      setStatus("Bind your wallet before creating a poll.");
      return;
    }
    if (boundWallet !== walletPk) {
      setStatus(`Wallet mismatch. Bound: ${boundWallet}, connected: ${walletPk}`);
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
      // If a poll already exists for the same authority + title, surface a helpful message.
      const existing = await program.provider.connection.getAccountInfo(pollPda);
      if (existing) {
        setStatus("A poll with this title already exists for this wallet. Change the title to create a new one.");
        setLoading(false);
        return;
      }
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
      setStatus("Wallet bound to this user.");
    } catch (e) {
      console.error(e);
      setStatus(String(e));
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Admin: Create Poll</h1>
          <p>Sign in, bind your wallet, and create polls on the selected cluster.</p>
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
          <h3>Bind before creating</h3>
          <p>
            Sign in with Firebase, connect your wallet, and bind it. Poll creation appears once bound.
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}

export default App;
