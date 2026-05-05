"use client";

import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
  type UserCredential,
} from "firebase/auth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";

async function persistSession(idToken: string): Promise<void> {
  await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
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
      const anon = currentAnon(auth.currentUser);
      let cred: UserCredential;
      if (anon && isSignUp) {
        // Upgrade the anonymous user in place so their pending chat (saved
        // under the anon UID) carries over to the real account.
        cred = await linkWithCredential(
          anon,
          EmailAuthProvider.credential(email, password),
        );
      } else if (isSignUp) {
        cred = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        cred = await signInWithEmailAndPassword(auth, email, password);
      }
      await persistSession(await cred.user.getIdToken());
      router.push(next);
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
      const anon = currentAnon(auth.currentUser);
      const cred = anon
        ? await linkWithPopup(anon, new GoogleAuthProvider())
        : await signInWithPopup(auth, new GoogleAuthProvider());
      await persistSession(await cred.user.getIdToken());
      router.push(next);
    } catch (e) {
      // If the Google account is already linked to another Firebase user,
      // linkWithPopup throws `auth/credential-already-in-use`. Fall back to a
      // plain sign-in so the user can still get into their existing account
      // (the anon chat is lost in that case, which is unavoidable).
      const code = (e as { code?: string }).code;
      if (code === "auth/credential-already-in-use") {
        try {
          const cred = await signInWithPopup(
            getClientAuth(),
            new GoogleAuthProvider(),
          );
          await persistSession(await cred.user.getIdToken());
          router.push(next);
          return;
        } catch (e2) {
          setError((e2 as Error).message);
          return;
        }
      }
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

function currentAnon(user: User | null): User | null {
  return user && user.isAnonymous ? user : null;
}

function nextQuery(raw: string | null): string {
  if (!raw) return "";
  return `?next=${encodeURIComponent(raw)}`;
}
