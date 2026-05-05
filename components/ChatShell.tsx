"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import ChatSidebar from "@/components/ChatSidebar";
import { useAuthUser } from "@/lib/auth/use-auth-user";

interface Props {
  children: (ctx: {
    uid: string;
    newChatKey: number;
  }) => ReactNode;
  initialUid: string;
}

// Full-height shell used by /ask and /chats/[id]. The page-level server
// component is responsible for redirecting unauthenticated users to /sign-in
// and passes the resolved uid via initialUid. The client falls back to the
// Firebase auth state and bounces to /sign-in if the SDK reports signed out
// (e.g. user signed out in another tab).
export default function ChatShell({ children, initialUid }: Props) {
  const router = useRouter();
  const { user, loading } = useAuthUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newChatKey, setNewChatKey] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user || user.isAnonymous) {
      router.replace("/sign-in");
    }
  }, [loading, user, router]);

  const uid = user && !user.isAnonymous ? user.uid : initialUid;

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
          {children({ uid, newChatKey })}
        </div>
      </div>
    </div>
  );
}
