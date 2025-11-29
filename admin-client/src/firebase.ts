import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type Auth, type User } from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc, type DocumentReference, type Firestore } from "firebase/firestore";
import type { FirebaseApp, FirebaseOptions } from "firebase/app";

let firebaseApp: FirebaseApp | null = null;

function readConfig(): FirebaseOptions {
  const required = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ] as const;
  const missing = required.filter((k) => !(import.meta.env as any)[k]);
  if (missing.length) throw new Error(`Missing Firebase env: ${missing.join(", ")}`);
  const cfg: FirebaseOptions = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) {
    cfg.measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;
  }
  return cfg;
}

export function initFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!firebaseApp) {
    firebaseApp = initializeApp(readConfig());
  }
  const app = firebaseApp;
  const auth = getAuth(app);
  const db = getFirestore(app);
  return { app, auth, db };
}

export async function fetchBoundWallet(db: Firestore, uid: string): Promise<{ wallet: string; ref: DocumentReference } | null> {
  const ref = doc(db, "user_wallets", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as { wallet?: string };
  if (!data.wallet) return null;
  return { wallet: data.wallet, ref };
}

export async function bindWallet(db: Firestore, uid: string, email: string, wallet: string) {
  const existing = await fetchBoundWallet(db, uid);
  if (existing) throw new Error("Wallet already bound for this user.");
  const ref = doc(db, "user_wallets", uid);
  await setDoc(ref, { email, wallet });
}

export function watchAuth(auth: Auth, cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export const authApi = { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };
