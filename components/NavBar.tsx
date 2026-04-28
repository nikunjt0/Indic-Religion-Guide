"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logOut } from "@/lib/auth/sign-out";
import { useAuthUser } from "@/lib/auth/use-auth-user";

const LINKS = [
  { href: "/ask", label: "Ask" },
  { href: "/profile", label: "Profile" },
];

// The chat pages render their own full-height shell with a sidebar — hide the
// global top nav there so it doesn't double up on navigation chrome.
function isChatPath(pathname: string) {
  return pathname === "/ask" || pathname.startsWith("/chats/");
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  if (isChatPath(pathname)) return null;

  const signedIn = Boolean(user);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-[1100] border-b border-border-warm/80 bg-background/90 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-foreground"
          aria-label="Indic Religion Guide home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron-soft ring-1 ring-border-strong">
            <Image
              src="/Ornate-Dharma-Wheel.svg"
              alt=""
              width={26}
              height={26}
              priority
            />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-semibold text-maroon">
              Indic Guide
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
              practice · grounded
            </span>
          </span>
        </Link>

        <ul className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={
                    "rounded-full px-4 py-1.5 text-sm font-medium transition " +
                    (active
                      ? "bg-saffron text-white shadow-sm"
                      : "text-foreground/80 hover:bg-saffron-soft hover:text-saffron-dark")
                  }
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
          {!loading ? (
            signedIn ? (
              <li>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="rounded-full border border-border-strong px-4 py-1.5 text-sm font-medium text-foreground/80 transition hover:bg-saffron-soft hover:text-saffron-dark disabled:opacity-50"
                >
                  {signingOut ? "Logging out…" : "Log out"}
                </button>
              </li>
            ) : (
              <>
                <li>
                  <Link
                    href="/sign-in"
                    className="rounded-full px-4 py-1.5 text-sm font-medium text-foreground/80 transition hover:bg-saffron-soft hover:text-saffron-dark"
                  >
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link
                    href="/sign-up"
                    className="rounded-full bg-saffron px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark"
                  >
                    Sign up
                  </Link>
                </li>
              </>
            )
          ) : null}
        </ul>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-border-strong p-2 text-saffron-dark sm:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </nav>

      {open ? (
        <ul className="flex flex-col gap-1 border-t border-border-warm bg-surface px-5 py-3 sm:hidden">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              (l.href !== "/" && pathname.startsWith(l.href));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={
                    "block rounded-md px-3 py-2 text-sm font-medium " +
                    (active
                      ? "bg-saffron text-white"
                      : "text-foreground/80 hover:bg-saffron-soft")
                  }
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
          {!loading ? (
            signedIn ? (
              <li>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={signingOut}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-foreground/80 hover:bg-saffron-soft disabled:opacity-50"
                >
                  {signingOut ? "Logging out…" : "Log out"}
                </button>
              </li>
            ) : (
              <>
                <li>
                  <Link
                    href="/sign-in"
                    className="block rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-saffron-soft"
                  >
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link
                    href="/sign-up"
                    className="block rounded-md bg-saffron px-3 py-2 text-sm font-semibold text-white"
                  >
                    Sign up
                  </Link>
                </li>
              </>
            )
          ) : null}
        </ul>
      ) : null}
    </header>
  );
}
