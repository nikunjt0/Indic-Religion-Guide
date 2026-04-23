"use client";

import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { getClientAuth } from "../firebase/client";

let ready: Promise<User> | null = null;

export function ensureAnonUser(): Promise<User> {
  if (ready) return ready;
  const auth = getClientAuth();

  ready = new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      async (user) => {
        unsub();
        try {
          if (user) {
            resolve(user);
            return;
          }
          const cred = await signInAnonymously(auth);
          resolve(cred.user);
        } catch (err) {
          reject(err);
        }
      },
      reject,
    );
  });

  ready.then(async (user) => {
    const token = await user.getIdToken();
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
  }).catch(() => {
    /* server-side session is nice-to-have; RAG route only needs the uid sent in the body */
  });

  return ready;
}
