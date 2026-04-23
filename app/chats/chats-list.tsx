"use client";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ensureAnonUser } from "@/lib/auth/ensure-anon";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatDoc } from "@/lib/types/firestore";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatsList() {
  const [uid, setUid] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonUser().then((user) => setUid(user.uid));
  }, []);

  useEffect(() => {
    if (!uid) return;
    const db = getClientDb();
    const q = query(
      collection(db, "users", uid, "chats"),
      orderBy("updatedAt", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setChats(snap.docs.map((d) => d.data() as ChatDoc));
        setError(null);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid]);

  async function handleDelete(id: string) {
    if (!uid) return;
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    await deleteDoc(doc(getClientDb(), "users", uid, "chats", id));
  }

  if (!uid || chats === null) {
    return <p className="text-sm text-muted">Loading your chats…</p>;
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface/60 p-10 text-center">
        <span className="devanagari text-2xl text-saffron">ॐ</span>
        <h2 className="font-display text-xl font-semibold text-maroon">
          No chats yet
        </h2>
        <p className="max-w-md text-sm text-foreground/70">
          Ask your first question and we&apos;ll keep the conversation here so
          you can revisit it.
        </p>
        <Link
          href="/ask"
          className="mt-2 rounded-full bg-saffron px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark"
        >
          Start a new chat
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {chats.map((c) => {
        const preview =
          c.messages[c.messages.length - 1]?.content?.slice(0, 120) ?? "";
        return (
          <li
            key={c.id}
            className="group flex items-start justify-between gap-3 rounded-2xl border border-border-warm bg-surface p-4 shadow-sm transition hover:border-saffron"
          >
            <Link
              href={`/chats/${c.id}`}
              className="flex flex-1 flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-maroon">
                  {c.title || "Untitled chat"}
                </h2>
                <span className="shrink-0 text-xs text-muted">
                  {formatTime(c.updatedAt)}
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-foreground/70">
                {preview}
              </p>
              <span className="text-xs text-muted">
                {c.messages.length} message{c.messages.length === 1 ? "" : "s"}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(c.id)}
              aria-label="Delete chat"
              className="shrink-0 rounded-full p-2 text-muted opacity-0 transition hover:bg-saffron-soft hover:text-saffron-dark group-hover:opacity-100"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
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
  );
}
