"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import Link from "next/link";
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

export type AuthMode = "signin" | "signup";

interface Props {
  mode: AuthMode;
}

export default function SignInForm({ mode }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isSignUp = mode === "signup";

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setError(null);
    try {
      const auth = getClientAuth();
      const cred = isSignUp
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);
      await persistSession(await cred.user.getIdToken());
      router.push("/profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

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
      // Send guests through the profile page first so they pick a tradition
      // (Hindu / Jain / both) before asking — that selection drives retrieval
      // and prompt framing.
      router.push("/profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <form onSubmit={handleEmail} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-left">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border-warm bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-inner shadow-saffron-soft/30 transition focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-left">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
            Password
          </span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-border-warm bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-inner shadow-saffron-soft/30 transition focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30"
          />
        </label>
        <button
          type="submit"
          disabled={busy !== null}
          className="rounded-full bg-saffron px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark disabled:opacity-50"
        >
          {busy === "email"
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted">
        <span className="h-px flex-1 bg-border-warm" />
        or
        <span className="h-px flex-1 bg-border-warm" />
      </div>

      <button
        className="rounded-full border border-border-strong bg-surface px-5 py-2.5 text-sm font-semibold text-saffron-dark transition hover:bg-saffron-soft disabled:opacity-40"
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

      <p className="pt-1 text-center text-xs text-foreground/70">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-semibold text-saffron-dark hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href="/sign-up"
              className="font-semibold text-saffron-dark hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
