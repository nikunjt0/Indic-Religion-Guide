import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { CHAT_MODEL, openai } from "@/lib/openai";
import { decideClarification } from "@/lib/rag/clarify";
import { logQuery } from "@/lib/rag/log";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  compressPriorAssistantTurn,
  groupChunksBySource,
} from "@/lib/rag/prompt";
import {
  embedQuery,
  findNearestChunks,
  matchGuides,
  resolveRetrievalTraditions,
} from "@/lib/rag/retrieve";
import type { UserProfile } from "@/lib/types/firestore";

// Cap how many prior turns we replay to keep token cost bounded. Last 8
// messages = up to 4 user/assistant exchanges, which covers typical follow-up
// chains without ballooning the prompt.
const MAX_HISTORY_MESSAGES = 8;

const HistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

const BodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(4000),
  clarifications: z.record(z.string(), z.string()).optional(),
  history: z.array(HistoryMessageSchema).optional(),
});

function sse(data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

export async function POST(req: Request) {
  const started = Date.now();
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { userId, question, clarifications } = parsed.data;
  const history = (parsed.data.history ?? []).slice(-MAX_HISTORY_MESSAGES);
  const lastUserTurn = [...history].reverse().find((m) => m.role === "user");

  // Load profile (may not exist for fresh anonymous users).
  const profileSnap = await adminDb.collection("users").doc(userId).get();
  const profile = (profileSnap.exists ? profileSnap.data() : null) as
    | Partial<UserProfile>
    | null;

  // Clarification gate.
  const clar = decideClarification(question, profile, clarifications);
  if (clar.needed) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          sse({
            type: "clarify",
            field: clar.field,
            question: clar.question,
            options: clar.options,
          }),
        );
        controller.enqueue(sse("[DONE]"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Retrieve. For follow-ups, prepend the most recent prior user question to
  // the embedding input so the vector search captures the topic the user is
  // following up on (e.g., a terse "what about during Navaratri?" still pulls
  // puja-relevant chunks because the prior turn anchored the topic).
  const retrievalQuery = lastUserTurn
    ? `${lastUserTurn.content}\n\n${question}`
    : question;
  const [queryVec, guides] = await Promise.all([
    embedQuery(retrievalQuery),
    matchGuides(question, profile),
  ]);
  // Honor the user's tradition selection unless the question crosses traditions
  // (explicit comparison, or naming a tradition the user didn't select).
  const allowedTraditions = resolveRetrievalTraditions(profile, retrievalQuery);
  const chunks = await findNearestChunks(queryVec, 8, allowedTraditions);
  const grouped = groupChunksBySource(chunks);

  // Ship the grouped retrieval up front so the client can render source cards
  // immediately (with quotes collapsed) before the model starts generating.
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const contextPayload = {
    type: "context",
    sources: grouped.map((s) => ({
      index: s.index,
      source_title: s.source_title,
      quotes: s.quotes.map((q, i) => {
        // Find matching chunk to recover its id (quotes preserved rank order
        // per source, so we can zip by order against the per-source slice).
        const sameTitleChunks = chunks.filter(
          (c) => c.source_title === s.source_title,
        );
        const c = sameTitleChunks[i];
        return {
          id: c?.id ?? `${s.source_title}:${i}`,
          source_title: s.source_title,
          chapter: q.chapter,
          verse: q.verse,
          page: q.page,
          text: (chunkById.get(c?.id ?? "")?.text ?? q.text).slice(0, 800),
        };
      }),
    })),
    guides: guides.map((g) => ({ slug: g.slug, title: g.title })),
  };

  const userPrompt = buildUserPrompt({
    question,
    profile,
    clarifications,
    sources: grouped,
    guides,
  });

  let fullAnswer = "";

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse(contextPayload));

      const priorMessages = history.map((m) =>
        m.role === "assistant"
          ? {
              role: "assistant" as const,
              content: compressPriorAssistantTurn(m.content),
            }
          : { role: "user" as const, content: m.content },
      );

      try {
        const completion = await openai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...priorMessages,
            { role: "user", content: userPrompt },
          ],
          stream: true,
        });

        for await (const part of completion) {
          const delta = part.choices[0]?.delta?.content ?? "";
          if (!delta) continue;
          fullAnswer += delta;
          controller.enqueue(sse({ type: "token", content: delta }));
        }

        controller.enqueue(sse("[DONE]"));
        controller.close();
      } catch (err) {
        controller.enqueue(
          sse({ type: "error", message: (err as Error).message }),
        );
        controller.close();
        return;
      }

      // Fire-and-forget audit log.
      logQuery({
        userId,
        question,
        clarifications,
        retrievedChunkIds: chunks.map((c) => c.id),
        retrievedGuideSlugs: guides.map((g) => g.slug),
        answer: fullAnswer,
        promptVersion: PROMPT_VERSION,
        model: CHAT_MODEL,
        latencyMs: Date.now() - started,
      }).catch((err) => console.error("query log failed:", err));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
