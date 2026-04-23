import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | null = null;

function getApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase admin env vars missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY",
    );
  }

  cachedApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return cachedApp;
}

// Proxy-based lazy exports — the Firestore/Auth instances are only constructed
// on first property access, not at module import. Keeps `next build` from
// crashing when env vars aren't loaded during static analysis passes.
function lazy<T extends object>(get: () => T): T {
  let instance: T | null = null;
  return new Proxy({} as T, {
    get(_, prop, receiver) {
      if (!instance) instance = get();
      return Reflect.get(instance as object, prop, receiver);
    },
    has(_, prop) {
      if (!instance) instance = get();
      return Reflect.has(instance as object, prop);
    },
  });
}

export const adminDb: Firestore = lazy(() => getFirestore(getApp()));
export const adminAuth: Auth = lazy(() => getAuth(getApp()));
