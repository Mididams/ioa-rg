import { getApp, getApps, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { parseServerDate } from "./server-clock";

const firebaseConfig = {
  apiKey: "AIzaSyCElRJ3hxdVbPqPNGEyk9k4Mk9oYT_C9Nw",
  authDomain: "ioa-rang.firebaseapp.com",
  projectId: "ioa-rang",
  storageBucket: "ioa-rang.firebasestorage.app",
  messagingSenderId: "1083842401562",
  appId: "1:1083842401562:web:0ba9adb1b3b9d0b25d08a3",
};

const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true";
const app = getApps().length ? getApp() : initializeApp({ ...firebaseConfig, projectId: useEmulator ? "demo-ioa-rang" : firebaseConfig.projectId });
export const db = getFirestore(app);
export const projectId = app.options.projectId!;

export async function readServerTime(): Promise<number> {
  const base = useEmulator ? "http://127.0.0.1:8080" : "https://firestore.googleapis.com";
  const database = `projects/${projectId}/databases/(default)`;
  const response = await fetch(`${base}/v1/${database}/documents:batchGet?key=${firebaseConfig.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents: [`${database}/documents/runtime/current`], mask: { fieldPaths: ["seq"] } }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`server_time_${response.status}`);
  return parseServerDate(response.headers.get("date"));
}

if (useEmulator) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
