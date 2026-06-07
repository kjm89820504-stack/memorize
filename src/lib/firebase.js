import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "memorize-52974.firebaseapp.com",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    "https://memorize-52974-default-rtdb.firebaseio.com/",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "memorize-52974",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "memorize-52974.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredConfigKeys = ["apiKey", "authDomain", "databaseURL", "projectId"];

export const missingFirebaseConfigKeys = requiredConfigKeys.filter((key) => !firebaseConfig[key]);
export const isFirebaseConfigured = missingFirebaseConfigKeys.length === 0;

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getDatabase(app) : null;
