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

export const adminDb: Firestore = lazy(() => {
  const db = getFirestore(getApp());
  // Match the client SDK's tolerance for undefined fields. Without this, any
  // assistant message that lacks `sources`/`citations` (e.g. SMS bridge turns
  // that don't persist source quotes) gets rejected at write time.
  //
  // The lazy wrapper caches per-module, but tsx (and Next's dev pipeline)
  // can evaluate this file under two distinct specifiers — e.g. the bridge
  // imports `../../lib/firebase/admin.ts` while lib code imports
  // `../firebase/admin`. That produces two `lazy()` closures pointing at the
  // same underlying Firestore singleton, so the second one's `settings()`
  // call hits "already initialized". The first call already applied the
  // setting; swallow the duplicate and proceed.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (err) {
    if (!/already (been )?initialized|settings\(\) once/i.test(String(err))) {
      throw err;
    }
  }
  return db;
});
export const adminAuth: Auth = lazy(() => getAuth(getApp()));
