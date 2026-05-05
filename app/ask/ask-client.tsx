"use client";

import ChatPanel from "@/components/ChatPanel";
import ChatShell from "@/components/ChatShell";

export default function AskClient({ uid }: { uid: string }) {
  return (
    <ChatShell initialUid={uid}>
      {({ uid, newChatKey }) => (
        <ChatPanel key={newChatKey} uid={uid} />
      )}
    </ChatShell>
  );
}
