"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logOut } from "@/lib/auth/sign-out";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatDoc } from "@/lib/types/firestore";

interface Props {
  uid: string | null;
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}

export default function ChatSidebar({ uid, open, onClose, onNewChat }: Props) {
  const pathname = usePathname();
  const [chats, setChats] = useState<ChatDoc[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await logOut();
    } catch {
      setSigningOut(false);
    }
  }

  useEffect(() => {
    if (!uid) return;
    const db = getClientDb();
    const q = query(
      collection(db, "users", uid, "chats"),
      orderBy("updatedAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setChats(snap.docs.map((d) => d.data() as ChatDoc));
    });
  }, [uid]);

  async function handleDelete(id: string) {
    if (!uid) return;
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    await deleteDoc(doc(getClientDb(), "users", uid, "chats", id));
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/30 sm:hidden"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border-warm bg-surface/95 backdrop-blur transition-transform sm:sticky sm:top-0 sm:h-screen sm:translate-x-0 " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-center justify-between gap-2 border-b border-border-warm/60 px-4 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-foreground"
            aria-label="Indic Religion Guide home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-saffron-soft ring-1 ring-border-strong">
              <Image
                src="/Ornate-Dharma-Wheel.svg"
                alt=""
                width={22}
                height={22}
              />
            </span>
            <span className="font-display text-lg font-semibold text-maroon">
              Indic Guide
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-md p-1.5 text-muted hover:bg-saffron-soft hover:text-saffron-dark sm:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M6 6l8 8M14 6l-8 8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-3 pt-3">
          <Link
            href="/ask"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-lg border border-border-warm bg-background px-3 py-2 text-sm font-medium text-foreground/90 transition hover:border-saffron hover:bg-saffron-soft/40 hover:text-saffron-dark"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            New chat
          </Link>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto px-3 pb-3">
          <h2 className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
            Recents
          </h2>
          {!uid || chats === null ? (
            <p className="px-2 text-xs text-muted">Loading…</p>
          ) : chats.length === 0 ? (
            <p className="px-2 text-xs text-muted">No chats yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {chats.map((c) => {
                const active = pathname === `/chats/${c.id}`;
                return (
                  <li key={c.id} className="group relative">
                    <Link
                      href={`/chats/${c.id}`}
                      className={
                        "block truncate rounded-md px-2 py-1.5 pr-8 text-sm transition " +
                        (active
                          ? "bg-saffron-soft text-saffron-dark"
                          : "text-foreground/75 hover:bg-saffron-soft/60 hover:text-saffron-dark")
                      }
                    >
                      {c.title || "Untitled chat"}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      aria-label="Delete chat"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted opacity-0 transition hover:bg-saffron-soft hover:text-saffron-dark group-hover:opacity-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
                        <path
                          d="M6 6l8 8M14 6l-8 8"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1 border-t border-border-warm/60 px-3 py-3">
          <Link
            href="/profile"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-saffron-soft/60 hover:text-saffron-dark"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-saffron-soft text-[11px] font-semibold text-saffron-dark ring-1 ring-border-strong">
              ॐ
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-medium">Profile</span>
              {uid ? null : (
                <span className="text-[10px] text-muted">signing in…</span>
              )}
            </span>
          </Link>
          {uid ? (
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/70 hover:bg-saffron-soft/60 hover:text-saffron-dark disabled:opacity-50"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-warm text-saffron-dark">
                <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden>
                  <path
                    d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M12 7l3 3-3 3M15 10H8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </span>
              <span className="font-medium">
                {signingOut ? "Logging out…" : "Log out"}
              </span>
            </button>
          ) : null}
        </div>
      </aside>
    </>
  );
}
