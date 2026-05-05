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
import { getClientDb } from "@/lib/firebase/client";
import type {
  ChatDoc,
  ChatMessage,
  ChunkCitation,
  MatchedGuideRef,
  SourceGroup,
} from "@/lib/types/firestore";

interface Props {
  uid: string;
  initialChat?: ChatDoc;
}

interface ClarifyEvent {
  type: "clarify";
  field?: string;
  question: string;
  options?: { key: string; label: string }[];
}

interface StreamingState {
  content: string;
  sources: SourceGroup[];
  guides: MatchedGuideRef[];
}

const SUGGESTIONS = [
  "How do I perform daily puja at home as a beginner?",
  "What does the Gita say about karma yoga?",
  "Walk me through a simple aarti at the end of puja.",
  "Which fasting days apply to a Vaishnava householder?",
];

export default function ChatPanel({ uid, initialChat }: Props) {
  const [chatId, setChatId] = useState<string | null>(initialChat?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialChat?.messages ?? [],
  );

  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [clarify, setClarify] = useState<ClarifyEvent | null>(null);
  const [clarifications, setClarifications] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, clarify]);

  const isEmpty = messages.length === 0 && !streaming && !clarify;

  async function persistChat(nextMessages: ChatMessage[], titleHint?: string) {
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
    setStreaming({ content: "", sources: [], guides: [] });

    // Prior turns = everything in convoMessages before the user turn we're
    // about to ask about. The current question itself is sent as `question`,
    // so drop the trailing user message before forwarding history.
    const priorTurns = convoMessages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: uid,
          question,
          clarifications: effectiveClarifications,
          history: priorTurns,
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
      let sources: SourceGroup[] = [];
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
              sources = ev.sources ?? [];
              guides = ev.guides ?? [];
              setStreaming({ content: "", sources, guides });
            } else if (ev.type === "token") {
              answerContent += ev.content as string;
              setStreaming({ content: answerContent, sources, guides });
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
          sources,
          matchedGuides: guides,
          timestamp: Date.now(),
        };
        const finalMessages = [...convoMessages, assistantMsg];
        setMessages(finalMessages);
        setStreaming(null);
        setPendingQuestion(null);
        await persistChat(finalMessages, question);
      }
    } catch (e) {
      setError((e as Error).message);
      setStreaming(null);
    } finally {
      setLoading(false);
    }
  }

  async function sendQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setPendingQuestion(trimmed);
    await runAsk(trimmed, nextMessages, clarifications);
  }

  async function resolveClarification(key: string) {
    if (!clarify?.field || !pendingQuestion) return;
    const next = { ...clarifications, [clarify.field]: key };
    setClarifications(next);
    await runAsk(pendingQuestion, messages, next);
  }

  const composer = (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-border-strong bg-surface p-3 shadow-lg shadow-saffron/5"
      onSubmit={(e) => {
        e.preventDefault();
        sendQuestion(input);
      }}
    >
      <textarea
        className="min-h-[4.5rem] resize-none rounded-lg bg-transparent p-2 text-sm leading-relaxed text-foreground focus:outline-none"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendQuestion(input);
          }
        }}
        placeholder={
          isEmpty
            ? "Ask a question…"
            : "Ask a follow-up… (Shift+Enter for newline)"
        }
        disabled={loading}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-full bg-saffron px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Send"}
        </button>
      </div>
    </form>
  );

  if (isEmpty) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-5 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="devanagari text-4xl text-saffron">ॐ</span>
          <h1 className="font-display text-3xl font-semibold text-maroon sm:text-4xl">
            Ask a question
          </h1>
          <p className="max-w-md text-sm text-foreground/70">
            We cite primary texts where we can and fall back to curated ritual
            procedures for how-to questions.
          </p>
        </div>

        {composer}

        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => sendQuestion(s)}
              disabled={loading}
              className="rounded-full border border-border-warm bg-surface/80 px-3.5 py-1.5 text-xs text-foreground/75 transition hover:border-saffron hover:bg-saffron-soft hover:text-saffron-dark disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {error ? (
          <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 py-6">
      <div ref={scrollRef} className="flex flex-col gap-4">
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {streaming ? (
          <AssistantBubble
            content={streaming.content}
            sources={streaming.sources}
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

      <div className="sticky bottom-4 z-10">{composer}</div>
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

  // Legacy messages (pre source-first rework) only have flat `citations`.
  if (!message.sources && message.citations) {
    return (
      <LegacyAssistantBubble
        content={message.content}
        citations={message.citations}
        guides={message.matchedGuides ?? []}
      />
    );
  }

  return (
    <AssistantBubble
      content={message.content}
      sources={message.sources ?? []}
      guides={message.matchedGuides ?? []}
    />
  );
}

interface ParsedSections {
  bySourceIndex: Record<number, string>;
  practice: string | null;
}

// Split streamed model output into ### SOURCE <N> and ### PRACTICE sections.
// Re-run on every token update; the last section is still growing mid-stream.
function parseSections(text: string): ParsedSections {
  const re = /###\s+(SOURCE\s+(\d+)|PRACTICE)\b[^\n]*\n?/gi;
  const marks: {
    start: number;
    end: number;
    kind: "source" | "practice";
    sourceIdx?: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const isSource = /^SOURCE/i.test(m[1]);
    marks.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: isSource ? "source" : "practice",
      sourceIdx: isSource ? Number(m[2]) : undefined,
    });
  }
  const bySourceIndex: Record<number, string> = {};
  let practice: string | null = null;
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const nextStart = marks[i + 1]?.start ?? text.length;
    const body = text.slice(cur.end, nextStart).trim();
    if (cur.kind === "source" && cur.sourceIdx != null) {
      bySourceIndex[cur.sourceIdx] = body;
    } else if (cur.kind === "practice") {
      practice = body;
    }
  }
  return { bySourceIndex, practice };
}

function AssistantBubble({
  content,
  sources,
  guides,
  streaming,
}: {
  content: string;
  sources: SourceGroup[];
  guides: MatchedGuideRef[];
  streaming?: boolean;
}) {
  const parsed = parseSections(content);
  const anyContent = content.length > 0;
  const hasAnySectionOutput =
    Object.keys(parsed.bySourceIndex).length > 0 || parsed.practice;

  return (
    <div className="flex flex-col gap-3">
      {sources.length === 0 && streaming && !anyContent ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border-warm bg-surface px-4 py-3 text-sm text-muted">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-saffron" />
          Searching the texts…
        </p>
      ) : null}

      {sources.length === 0 && !streaming && anyContent && !hasAnySectionOutput ? (
        // Model didn't emit sections (shouldn't happen, but graceful fallback).
        <div className="rounded-2xl border border-border-warm bg-surface px-5 py-4 text-sm leading-relaxed text-foreground/90">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      ) : null}

      {parsed.practice ? (
        <PracticeSection content={parsed.practice} streaming={streaming} />
      ) : null}

      {sources.length > 0 ? (
        <div className="flex flex-col gap-3">
          {sources
            .filter((s) => {
              // Hide sources the model marked NOT_RELEVANT — but only once the
              // section's body has finished streaming, so we don't flicker the
              // card out before the model has actually written its summary.
              const summary = (parsed.bySourceIndex[s.index] ?? "").trim();
              if (summary.toUpperCase() !== "NOT_RELEVANT") return true;
              const nextSourcePresent =
                parsed.bySourceIndex[s.index + 1] !== undefined;
              const sectionDone = !streaming || nextSourcePresent;
              return !sectionDone;
            })
            .map((s) => (
              <SourceSection
                key={`${s.index}-${s.source_title}`}
                source={s}
                summary={parsed.bySourceIndex[s.index] ?? ""}
                streaming={streaming}
              />
            ))}
        </div>
      ) : null}

      {guides.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-border-warm bg-saffron-soft/30 px-4 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
            Related ritual guides
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/guides/${g.slug}`}
                  className="rounded-full border border-border-strong bg-surface px-3 py-0.5 text-xs font-medium text-saffron-dark transition hover:bg-saffron hover:text-white"
                >
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SourceSection({
  source,
  summary,
  streaming,
}: {
  source: SourceGroup;
  summary: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trimmed = summary.trim();
  const isNotRelevant = trimmed.toUpperCase() === "NOT_RELEVANT";
  const waitingForSummary = streaming && !trimmed;

  return (
    <article className="overflow-hidden rounded-2xl border border-border-warm bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-saffron-soft/30"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
            Source
          </span>
          <span className="font-display text-base font-semibold text-maroon">
            {source.source_title}
          </span>
          <span className="text-[11px] text-muted">
            {source.quotes.length} {source.quotes.length === 1 ? "quote" : "quotes"}
          </span>
        </div>
        <span
          className={`text-saffron-dark transition ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border-warm bg-saffron-soft/20 px-5 py-4">
          {source.quotes.map((q) => (
            <CitationCard key={q.id} chunk={q} />
          ))}
        </div>
      ) : null}

      <div className="border-t border-border-warm px-5 py-4 text-sm leading-relaxed">
        {isNotRelevant ? (
          <p className="text-muted italic">
            This source does not directly address the question.
          </p>
        ) : trimmed ? (
          <p className="whitespace-pre-wrap text-foreground/90">
            {trimmed}
            {streaming ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-saffron/70" />
            ) : null}
          </p>
        ) : waitingForSummary ? (
          <p className="flex items-center gap-2 text-muted">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-saffron" />
            Reading…
          </p>
        ) : (
          <p className="text-muted italic">No summary generated.</p>
        )}
      </div>
    </article>
  );
}

function PracticeSection({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gold/50 bg-saffron-soft/40 px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
        In practice
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {content}
        {streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-saffron/70" />
        ) : null}
      </p>
    </section>
  );
}

// Pre-rework messages: keep the old flat layout for chat history.
function LegacyAssistantBubble({
  content,
  citations,
  guides,
}: {
  content: string;
  citations: ChunkCitation[];
  guides: MatchedGuideRef[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl rounded-bl-md border border-border-warm bg-surface px-5 py-4 shadow-sm">
      {content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {content}
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
