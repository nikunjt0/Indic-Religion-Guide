"use client";

import ChatPanel from "@/components/ChatPanel";
import ChatShell from "@/components/ChatShell";

export default function AskClient() {
  return (
    <ChatShell>
      {({ uid, isAnon, newChatKey }) => (
        <ChatPanel key={newChatKey} uid={uid} isAnon={isAnon} />
      )}
    </ChatShell>
  );
}
