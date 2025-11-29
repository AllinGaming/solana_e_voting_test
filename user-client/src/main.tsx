import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import App from "./App.tsx";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { Buffer } from "buffer";

// Polyfill Buffer for browser use (required by web3/Anchor).
if (!window.Buffer) {
  window.Buffer = Buffer;
}

const endpoint = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8899";
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </StrictMode>
);
