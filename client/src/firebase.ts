import dotenv from "dotenv"; // Loads environment variables for Firebase config when in Node.
import { FirebaseApp, FirebaseOptions, initializeApp } from "firebase/app"; // Core Firebase app functions.
import { Auth, getAuth } from "firebase/auth"; // Firebase Auth SDK.
import {
  DocumentReference,
  Firestore,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "firebase/firestore"; // Firestore SDK for reads/writes.

// Load env vars when running under ts-node / Node. In the browser, rely on bundler env support.
dotenv.config();

let firebaseApp: FirebaseApp | null = null; // Singleton Firebase app instance to avoid double init.

/**
 * Pull Firebase config from env vars to avoid hard-coding secrets.
 * Required keys mirror Firebase console values.
 */
function readFirebaseConfig(): FirebaseOptions {
  const requiredKeys = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
  ] as const; // List of mandatory env keys.

  const missing = requiredKeys.filter((key) => !process.env[key] || process.env[key]?.length === 0); // Collect missing keys.
  if (missing.length > 0) {
    throw new Error(`Missing Firebase env vars: ${missing.join(", ")}`); // Fail fast if any key is absent.
  }

  const config: FirebaseOptions = {
    apiKey: process.env.FIREBASE_API_KEY, // Public API key (still keep out of git).
    authDomain: process.env.FIREBASE_AUTH_DOMAIN, // Auth domain from Firebase console.
    projectId: process.env.FIREBASE_PROJECT_ID, // Project ID.
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // Storage bucket.
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, // Messaging sender ID.
    appId: process.env.FIREBASE_APP_ID, // App ID.
  };

  if (process.env.FIREBASE_MEASUREMENT_ID) {
    config.measurementId = process.env.FIREBASE_MEASUREMENT_ID; // Optional analytics measurement ID.
  }

  return config; // Return the assembled config for initializeApp.
}

/**
 * Initialize Firebase once and return app/auth/db handles.
 * Call this from your UI bootstrap before rendering.
 */
export function initFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!firebaseApp) {
    firebaseApp = initializeApp(readFirebaseConfig()); // Create the Firebase app if not already created.
  }
  const app = firebaseApp; // Safe to assert non-null after init.
  const auth = getAuth(app); // Auth instance bound to this app.
  const db = getFirestore(app); // Firestore instance bound to this app.
  return { app, auth, db }; // Hand back handles for use in the UI.
}

/**
 * Fetch the wallet bound to a Firebase user. Returns null if not yet set.
 */
export async function getBoundWallet(
  db: Firestore, // Firestore instance.
  uid: string // Firebase auth user ID.
): Promise<{ wallet: string; ref: DocumentReference } | null> {
  const ref = doc(db, "user_wallets", uid); // Document path for the user.
  const snap = await getDoc(ref); // Fetch the doc.
  if (!snap.exists()) return null; // No record means no wallet bound yet.
  const data = snap.data() as { wallet?: string }; // Narrow the type of the payload.
  if (!data.wallet) return null; // Missing wallet field means treat as unbound.
  return { wallet: data.wallet, ref }; // Return wallet and its doc ref.
}

/**
 * Write a wallet binding for the current Firebase user if not already set.
 * The Firestore rule should also prevent overrides; this check gives a better error in UI.
 */
export async function bindWalletOnce(
  db: Firestore, // Firestore instance.
  uid: string, // Firebase auth user ID.
  email: string, // Email to store alongside the wallet.
  wallet: string // Wallet public key as base58 string.
): Promise<void> {
  const existing = await getBoundWallet(db, uid); // See if a wallet is already set.
  if (existing) {
    throw new Error("Wallet already bound for this user; aborting update."); // Stop if already bound.
  }
  const ref = doc(db, "user_wallets", uid); // Destination doc reference.
  await setDoc(ref, { email, wallet }); // Write once; subsequent writes should be blocked by rules.
}
