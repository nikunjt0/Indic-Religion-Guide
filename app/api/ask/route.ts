import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { CHAT_MODEL, openai } from "@/lib/openai";
import { decideClarification } from "@/lib/rag/clarify";
import { logQuery } from "@/lib/rag/log";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "@/lib/rag/prompt";
import { embedQuery, findNearestChunks, matchGuides } from "@/lib/rag/retrieve";
import type { UserProfile } from "@/lib/types/firestore";

const BodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(4000),
  clarifications: z.record(z.string(), z.string()).optional(),
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

  // Retrieve.
  const [queryVec, guides] = await Promise.all([
    embedQuery(question),
    matchGuides(question, profile),
  ]);
  const chunks = await findNearestChunks(queryVec, 8);

  // Send the retrieval envelope up front so the client can render the citations pane immediately.
  const citationsPayload = {
    type: "context",
    chunks: chunks.map((c) => ({
      id: c.id,
      source_title: c.source_title,
      chapter: c.chapter,
      verse: c.verse,
      page: c.page,
      text: c.text.slice(0, 500),
    })),
    guides: guides.map((g) => ({ slug: g.slug, title: g.title })),
  };

  const userPrompt = buildUserPrompt({
    question,
    profile,
    clarifications,
    chunks,
    guides,
  });

  let fullAnswer = "";

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse(citationsPayload));

      try {
        const completion = await openai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
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
