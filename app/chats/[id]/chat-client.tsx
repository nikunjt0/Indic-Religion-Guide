"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import ChatShell from "@/components/ChatShell";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatDoc } from "@/lib/types/firestore";

export default function ChatClient({
  chatId,
  uid,
}: {
  chatId: string;
  uid: string;
}) {
  return (
    <ChatShell initialUid={uid}>
      {({ uid }) => <ChatBody uid={uid} chatId={chatId} />}
    </ChatShell>
  );
}

function ChatBody({ uid, chatId }: { uid: string; chatId: string }) {
  const [chat, setChat] = useState<ChatDoc | null | "missing">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
      <div className="mx-auto w-full max-w-3xl px-5 py-6">
        <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      </div>
    );
  }

  if (chat === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-6">
        <p className="text-sm text-muted">Loading chat…</p>
      </div>
    );
  }

  if (chat === "missing") {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-6">
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface/60 p-8 text-center">
          <p className="text-sm text-foreground/75">
            This chat doesn&apos;t exist or you don&apos;t have access to it.
          </p>
        </div>
      </div>
    );
  }

  return <ChatPanel uid={uid} initialChat={chat} />;
}
