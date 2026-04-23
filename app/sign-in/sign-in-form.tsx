"use client";

import {
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";

async function persistSession(idToken: string): Promise<void> {
  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

export default function SignInForm() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy("google");
    setError(null);
    try {
      const auth = getClientAuth();
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await persistSession(await cred.user.getIdToken());
      router.push("/profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleGuest() {
    setBusy("guest");
    setError(null);
    try {
      const auth = getClientAuth();
      const cred = await signInAnonymously(auth);
      await persistSession(await cred.user.getIdToken());
      router.push("/ask");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        className="rounded-full bg-saffron px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark disabled:opacity-50"
        disabled={busy !== null}
        onClick={handleGoogle}
      >
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </button>
      <button
        className="rounded-full border border-border-strong bg-surface px-5 py-2.5 text-sm font-semibold text-saffron-dark transition hover:bg-saffron-soft disabled:opacity-40"
        disabled={busy !== null}
        onClick={handleGuest}
      >
        {busy === "guest" ? "Entering…" : "Continue as guest"}
      </button>
      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
