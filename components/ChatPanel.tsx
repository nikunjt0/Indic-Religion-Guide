"use client";

import {
  collection,
  doc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CitationCard from "@/components/CitationCard";
import { ensureAnonUser } from "@/lib/auth/ensure-anon";
import { getClientDb } from "@/lib/firebase/client";
import type {
  ChatDoc,
  ChatMessage,
  ChunkCitation,
  MatchedGuideRef,
} from "@/lib/types/firestore";

interface ClarifyEvent {
  type: "clarify";
  field?: string;
  question: string;
  options?: { key: string; label: string }[];
}

interface Props {
  initialChat?: ChatDoc;
  initialUid?: string;
}

export default function ChatPanel({ initialChat, initialUid }: Props) {
  const [uid, setUid] = useState<string | null>(initialUid ?? null);
  const [isAnon, setIsAnon] = useState(true);

  const [chatId, setChatId] = useState<string | null>(initialChat?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialChat?.messages ?? [],
  );
  const [chatTitle, setChatTitle] = useState<string>(
    initialChat?.title ?? "",
  );

  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<{
    content: string;
    citations: ChunkCitation[];
    guides: MatchedGuideRef[];
  } | null>(null);
  const [clarify, setClarify] = useState<ClarifyEvent | null>(null);
  const [clarifications, setClarifications] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProfileNudge, setShowProfileNudge] = useState(false);
  const answeredOnce = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialUid) return;
    ensureAnonUser().then((user) => {
      setUid(user.uid);
      setIsAnon(user.isAnonymous);
    });
  }, [initialUid]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, clarify]);

  async function persistChat(nextMessages: ChatMessage[], titleHint?: string) {
    if (!uid) return null;
    const db = getClientDb();
    const now = Date.now();

    if (!chatId) {
      const newRef = doc(collection(db, "users", uid, "chats"));
      const title = (titleHint ?? nextMessages[0]?.content ?? "New chat")
        .slice(0, 80)
        .trim();
      const payload: ChatDoc = {
        id: newRef.id,
        uid,
        title,
        createdAt: now,
        updatedAt: now,
        messages: nextMessages,
      };
      await setDoc(newRef, payload);
      setChatId(newRef.id);
      setChatTitle(title);
      // Soft-update the URL without triggering a re-mount that would wipe
      // the in-memory chat state. Reloading the page re-hydrates from Firestore.
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/chats/${newRef.id}`);
      }
      return newRef.id;
    }

    await updateDoc(doc(db, "users", uid, "chats", chatId), {
      messages: nextMessages,
      updatedAt: now,
    });
    return chatId;
  }

  async function runAsk(
    question: string,
    convoMessages: ChatMessage[],
    effectiveClarifications: Record<string, string>,
  ) {
    setLoading(true);
    setError(null);
    setClarify(null);
    setStreaming({ content: "", citations: [], guides: [] });

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: uid,
          question,
          clarifications: effectiveClarifications,
        }),
      });

      if (!res.body) {
        setError("no response body");
        setStreaming(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let answerContent = "";
      let citations: ChunkCitation[] = [];
      let guides: MatchedGuideRef[] = [];
      let gotClarify = false;

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        while (true) {
          const idx = buf.indexOf("\n\n");
          if (idx === -1) break;
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const ev = JSON.parse(payload);
            if (ev.type === "clarify") {
              setClarify(ev as ClarifyEvent);
              gotClarify = true;
              setStreaming(null);
              break outer;
            } else if (ev.type === "context") {
              citations = ev.chunks ?? [];
              guides = ev.guides ?? [];
              setStreaming({ content: "", citations, guides });
            } else if (ev.type === "token") {
              answerContent += ev.content as string;
              setStreaming({ content: answerContent, citations, guides });
            } else if (ev.type === "error") {
              setError(ev.message as string);
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!gotClarify && answerContent) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: answerContent,
          citations,
          matchedGuides: guides,
          timestamp: Date.now(),
        };
        const finalMessages = [...convoMessages, assistantMsg];
        setMessages(finalMessages);
        setStreaming(null);
        setPendingQuestion(null);
        await persistChat(finalMessages, question);
      }

      if (!answeredOnce.current && isAnon && !gotClarify) {
        answeredOnce.current = true;
        setShowProfileNudge(true);
      }
    } catch (e) {
      setError((e as Error).message);
      setStreaming(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!uid) return;
    const question = input.trim();
    if (!question) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: question,
      timestamp: Date.now(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setPendingQuestion(question);
    await runAsk(question, nextMessages, clarifications);
  }

  async function resolveClarification(key: string) {
    if (!clarify?.field || !pendingQuestion) return;
    const next = { ...clarifications, [clarify.field]: key };
    setClarifications(next);
    await runAsk(pendingQuestion, messages, next);
  }

  return (
    <div className="flex flex-col gap-5">
      {chatTitle ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-warm bg-saffron-soft/50 px-4 py-2.5 text-sm">
          <span className="truncate font-semibold text-saffron-dark">
            {chatTitle}
          </span>
          <Link
            href="/chats"
            className="shrink-0 text-xs font-medium text-saffron-dark hover:text-maroon"
          >
            all chats →
          </Link>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex flex-col gap-4">
        {messages.length === 0 && !streaming && !clarify ? (
          <EmptyState />
        ) : null}

        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {streaming ? (
          <AssistantBubble
            content={streaming.content}
            citations={streaming.citations}
            guides={streaming.guides}
            streaming
          />
        ) : null}

        {clarify ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-gold/40 bg-saffron-soft/60 p-4">
            <p className="text-sm font-medium text-maroon">{clarify.question}</p>
            <div className="flex flex-wrap gap-2">
              {clarify.options?.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => resolveClarification(opt.key)}
                  className="rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-xs font-medium text-saffron-dark transition hover:bg-saffron hover:text-white"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <form
        className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-border-strong bg-surface p-3 shadow-lg shadow-saffron/5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <textarea
          className="min-h-[4.5rem] resize-none rounded-lg bg-transparent p-2 text-sm leading-relaxed text-foreground focus:outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            messages.length === 0
              ? "e.g. How do I perform daily puja at home as a beginner?"
              : "Ask a follow-up… (Shift+Enter for newline)"
          }
          disabled={loading}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">
            {uid ? `uid: ${uid.slice(0, 8)}…` : "signing in…"}
          </span>
          <button
            type="submit"
            disabled={!uid || loading || !input.trim()}
            className="rounded-full bg-saffron px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark disabled:opacity-50"
          >
            {loading ? "Thinking…" : "Send"}
          </button>
        </div>
      </form>

      {showProfileNudge ? (
        <aside className="flex items-center justify-between gap-3 rounded-2xl border border-border-warm bg-saffron-soft/60 p-4 text-sm">
          <span className="text-foreground/85">
            Set your sect, region, and level for more personalized answers.
          </span>
          <Link
            href="/sign-in"
            className="rounded-full bg-saffron px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-saffron-dark"
          >
            Set profile
          </Link>
        </aside>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface/60 px-6 py-10 text-center">
      <span className="devanagari text-3xl text-saffron">ॐ</span>
      <h2 className="font-display text-xl font-semibold text-maroon">
        Ask your first question
      </h2>
      <p className="max-w-md text-sm text-foreground/70">
        We cite primary texts where we can and fall back to curated ritual
        procedures for how-to questions.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-saffron px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <AssistantBubble
      content={message.content}
      citations={message.citations ?? []}
      guides={message.matchedGuides ?? []}
    />
  );
}

function AssistantBubble({
  content,
  citations,
  guides,
  streaming,
}: {
  content: string;
  citations: ChunkCitation[];
  guides: MatchedGuideRef[];
  streaming?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl rounded-bl-md border border-border-warm bg-surface px-5 py-4 shadow-sm">
      {content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {content}
          {streaming ? (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-saffron/70" />
          ) : null}
        </p>
      ) : streaming ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-saffron" />
          Consulting the texts…
        </p>
      ) : null}

      {guides.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
            Matched ritual guides
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="rounded-full border border-border-strong bg-saffron-soft px-3 py-0.5 text-xs font-medium text-saffron-dark transition hover:bg-saffron hover:text-white"
                >
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {citations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
            Sources
          </h3>
          <div className="flex flex-col gap-2">
            {citations.map((c) => (
              <CitationCard key={c.id} chunk={c} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
