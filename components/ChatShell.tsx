"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ensureAnonUser } from "@/lib/auth/ensure-anon";
import ChatSidebar from "@/components/ChatSidebar";

interface Props {
  children: (ctx: {
    uid: string | null;
    isAnon: boolean;
    newChatKey: number;
  }) => ReactNode;
  initialUid?: string;
}

// Full-height shell used by /ask and /chats/[id]. Owns auth + sidebar toggle
// and hands the resolved uid to the inner chat content via a render prop so
// we only trigger anon sign-in once per mount.
export default function ChatShell({ children, initialUid }: Props) {
  const [uid, setUid] = useState<string | null>(initialUid ?? null);
  const [isAnon, setIsAnon] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newChatKey, setNewChatKey] = useState(0);

  useEffect(() => {
    if (initialUid) return;
    ensureAnonUser().then((user) => {
      setUid(user.uid);
      setIsAnon(user.isAnonymous);
    });
  }, [initialUid]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <ChatSidebar
        uid={uid}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={() => {
          setNewChatKey((k) => k + 1);
          setSidebarOpen(false);
        }}
      />

      <div className="flex min-h-screen flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-warm/60 bg-background/80 px-4 py-2.5 backdrop-blur sm:hidden">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md border border-border-strong p-1.5 text-saffron-dark"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="font-display text-base font-semibold text-maroon">
            Ask
          </span>
        </div>

        <div className="flex flex-1 flex-col">
          {children({ uid, isAnon, newChatKey })}
        </div>
      </div>
    </div>
  );
}
