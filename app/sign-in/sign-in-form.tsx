"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type UserCredential,
} from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";
import { useAuthUser } from "@/lib/auth/use-auth-user";

async function persistSession(idToken: string): Promise<void> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    // Surface the failure to the caller so the user sees an error instead of
    // a silent half-state where Firebase client is signed in but the server
    // cookie is missing — which would loop them back to /sign-in on every
    // protected route.
    let detail = "";
    try {
      detail = (await res.json()).error ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(
      `Could not establish a session (${res.status}). ${detail}`.trim(),
    );
  }
}

// Sanitize the post-auth redirect target so we only ever send the user back
// to a same-origin path (no `//evil.com` or full URLs). Falls back to
// /profile so first-time users still pick a tradition.
function safeNext(raw: string | null): string {
  if (!raw) return "/profile";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/profile";
  return raw;
}

export type AuthMode = "signin" | "signup";

interface Props {
  mode: AuthMode;
}

export default function SignInForm({ mode }: Props) {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { user, loading } = useAuthUser();

  const isSignUp = mode === "signup";

  // If Firebase already has a non-anonymous client-side user but the server
  // cookie is missing (e.g. a previous sign-in succeeded client-side but the
  // session cookie write failed), recover by minting the cookie now and
  // bouncing them onward instead of making them re-enter credentials.
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (loading || recoveredRef.current) return;
    if (!user || user.isAnonymous) return;
    recoveredRef.current = true;
    setBusy("recover");
    (async () => {
      try {
        await persistSession(await user.getIdToken(true));
        window.location.assign(next);
      } catch (err) {
        await signOut(getClientAuth()).catch(() => {});
        setError((err as Error).message);
        setBusy(null);
      }
    })();
  }, [loading, user, next]);

  async function finalizeSignIn(cred: UserCredential) {
    try {
      await persistSession(await cred.user.getIdToken());
    } catch (err) {
      // The Firebase client signed us in but the server cookie write failed.
      // Roll the client back so the navbar doesn't claim we're signed in
      // while every server route bounces us to /sign-in.
      await signOut(getClientAuth()).catch(() => {});
      throw err;
    }
    // Hard redirect so the freshly-set session cookie is definitely included
    // in the next request — a soft router.push can race with the RSC cache
    // and land on a server-rendered "no session" redirect loop.
    window.location.assign(next);
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy("email");
    setError(null);
    try {
      const auth = getClientAuth();
      const cred = isSignUp
        ? await createUserWithEmailAndPassword(auth, email, password)
        : await signInWithEmailAndPassword(auth, email, password);
      await finalizeSignIn(cred);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function handleGoogle() {
    setBusy("google");
    setError(null);
    try {
      const cred = await signInWithPopup(
        getClientAuth(),
        new GoogleAuthProvider(),
      );
      await finalizeSignIn(cred);
    } catch (e) {
      setError((e as Error).message);
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
              href={`/sign-in${nextQuery(searchParams.get("next"))}`}
              className="font-semibold text-saffron-dark hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href={`/sign-up${nextQuery(searchParams.get("next"))}`}
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

function nextQuery(raw: string | null): string {
  if (!raw) return "";
  return `?next=${encodeURIComponent(raw)}`;
}
