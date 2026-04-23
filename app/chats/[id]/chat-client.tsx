"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import { ensureAnonUser } from "@/lib/auth/ensure-anon";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatDoc } from "@/lib/types/firestore";

export default function ChatClient({ chatId }: { chatId: string }) {
  const [uid, setUid] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatDoc | null | "missing">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAnonUser().then((user) => setUid(user.uid));
  }, []);

  useEffect(() => {
    if (!uid) return;
    const ref = doc(getClientDb(), "users", uid, "chats", chatId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setChat("missing");
          return;
        }
        setChat(snap.data() as ChatDoc);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [uid, chatId]);

  if (error) {
    return (
      <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!uid || chat === null) {
    return <p className="text-sm text-muted">Loading chat…</p>;
  }

  if (chat === "missing") {
    return (
      <div className="rounded-2xl border border-dashed border-border-strong bg-surface/60 p-8 text-center">
        <p className="text-sm text-foreground/75">
          This chat doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
    );
  }

  return <ChatPanel initialChat={chat} initialUid={uid} />;
}
