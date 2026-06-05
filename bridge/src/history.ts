import { imessageUsersCol } from "./firestore.ts";
import { config } from "./config.ts";
import type {
  ChatDoc,
  ChatMessage,
  ChunkCitation,
  MatchedGuideRef,
  SourceGroup,
} from "../../lib/types/firestore.ts";

const CHAT_ID = "imessage";

function chatRef(handleId: string) {
  return imessageUsersCol().doc(handleId).collection("chats").doc(CHAT_ID);
}

export async function loadRecentMessages(handleId: string): Promise<ChatMessage[]> {
  const snap = await chatRef(handleId).get();
  if (!snap.exists) return [];
  const data = snap.data() as ChatDoc | undefined;
  if (!data?.messages) return [];
  return data.messages.slice(-config.maxHistoryMessages);
}

export async function appendTurn(
  handleId: string,
  userTurn: { content: string; mediaSummary?: string },
  assistantTurn: {
    content: string;
    sources?: SourceGroup[];
    citations?: ChunkCitation[];
    matchedGuides?: MatchedGuideRef[];
  },
): Promise<void> {
  const now = Date.now();
  const ref = chatRef(handleId);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() as ChatDoc) : null;
  const next: ChatDoc = {
    id: CHAT_ID,
    uid: handleId,
    title: existing?.title ?? "iMessage",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: [
      ...(existing?.messages ?? []),
      {
        role: "user",
        content: userTurn.content,
        mediaSummary: userTurn.mediaSummary,
        timestamp: now,
      },
      {
        role: "assistant",
        content: assistantTurn.content,
        sources: assistantTurn.sources,
        citations: assistantTurn.citations,
        matchedGuides: assistantTurn.matchedGuides,
        timestamp: now,
      },
    ],
  };
  await ref.set(next, { merge: true });
}
