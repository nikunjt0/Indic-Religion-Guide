import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { CHAT_MODEL, VISION_CHAT_MODEL, openai } from "@/lib/openai";
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

// Client-prepared media. Photos are downscaled in the browser; videos are
// reduced to a handful of JPEG keyframes. Either way, what arrives here is a
// list of image data URLs the vision model can ingest directly.
const AttachmentSchema = z.object({
  // Tag so the prompt can hint to the model whether a frame came from a video.
  kind: z.enum(["image", "video-frame"]),
  // data:image/<jpeg|png|webp|gif>;base64,...
  dataUrl: z
    .string()
    .startsWith("data:image/")
    .max(8_000_000),
  // Optional position info for video frames (1-indexed within their source).
  frameIndex: z.number().int().min(1).optional(),
  frameTotal: z.number().int().min(1).optional(),
});

const MAX_ATTACHMENTS = 12;

// Transcribed audio/video the client extracted and sent to /api/transcribe.
// Arrives here as plain text we weave into the prompt and retrieval query.
const TranscriptSchema = z.object({
  sourceName: z.string().max(300),
  text: z.string().max(50_000),
  truncated: z.boolean().optional(),
});

const MAX_TRANSCRIPTS = 12;

const BodySchema = z.object({
  userId: z.string().min(1),
  question: z.string().min(1).max(4000),
  clarifications: z.record(z.string(), z.string()).optional(),
  history: z.array(HistoryMessageSchema).optional(),
  attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional(),
  transcripts: z.array(TranscriptSchema).max(MAX_TRANSCRIPTS).optional(),
});

function sse(data: unknown): Uint8Array {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

// One short framing sentence that goes in front of the images. Tells the
// model what it's looking at so it doesn't get confused when video frames
// arrive as a sequence — they're frames sampled from one video, not separate
// photos. Photos are noted by count for the same reason.
function buildMediaPreamble(
  attachments: Array<{ kind: "image" | "video-frame" }>,
): string {
  const photos = attachments.filter((a) => a.kind === "image").length;
  const frames = attachments.filter((a) => a.kind === "video-frame").length;
  const parts: string[] = [];
  if (photos > 0) {
    parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  }
  if (frames > 0) {
    parts.push(
      `${frames} keyframes sampled from a video (in chronological order)`,
    );
  }
  return `The user attached ${parts.join(" and ")} with their question. Use them to identify deities, symbols, ritual implements, gestures, postures, manuscript pages, temple architecture, or other visual context relevant to the question. Then answer in the required ### PRACTICE / ### SOURCE format using the retrieved sources below.`;
}

// Fold transcribed audio/video into a prompt block. Spoken questions, chanted
// mantras, and named deities in the soundtrack become text the model can act
// on alongside any frames.
function buildTranscriptBlock(
  transcripts: Array<{ sourceName: string; text: string; truncated?: boolean }>,
): string {
  if (transcripts.length === 0) return "";
  const items = transcripts
    .map(
      (t) =>
        `Transcript of "${t.sourceName}"${
          t.truncated ? " (partial — only the opening portion was transcribed)" : ""
        }:\n${t.text.trim()}`,
    )
    .join("\n\n");
  return `The user attached audio (or a video with sound). Below is the transcribed speech and chanting — treat it as part of the question, and use it to identify the mantra, deity, or practice being asked about:\n\n${items}`;
}

export async function POST(req: Request) {
  const started = Date.now();
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { userId, question, clarifications } = parsed.data;
  const history = (parsed.data.history ?? []).slice(-MAX_HISTORY_MESSAGES);
  const attachments = parsed.data.attachments ?? [];
  const transcripts = parsed.data.transcripts ?? [];
  const hasImages = attachments.length > 0;
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
  // puja-relevant chunks because the prior turn anchored the topic). When the
  // turn carries transcribed audio, fold a slice of it in too so spoken mantra
  // lines or deity names steer retrieval even if the typed question is terse.
  const transcriptForRetrieval = transcripts
    .map((t) => t.text)
    .join("\n")
    .slice(0, 2000);
  const retrievalQuery = [
    lastUserTurn?.content,
    question,
    transcriptForRetrieval,
  ]
    .filter(Boolean)
    .join("\n\n");
  const [queryVec, guides] = await Promise.all([
    embedQuery(retrievalQuery),
    matchGuides(question, profile),
  ]);
  const chunks = await findNearestChunks(queryVec, 8);
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

      // Build the current user turn.
      //  - Image turns become a content-parts array: a framing note (plus any
      //    audio transcript), the images, then the RAG-built user prompt.
      //  - Audio-only turns stay a plain string: the transcript block prepended
      //    to the user prompt.
      //  - Pure text turns are just the user prompt.
      const transcriptBlock = buildTranscriptBlock(transcripts);

      let currentUserContent:
        | string
        | Array<
            | { type: "text"; text: string }
            | {
                type: "image_url";
                image_url: { url: string; detail: "auto" };
              }
          >;

      if (hasImages) {
        const framing = [buildMediaPreamble(attachments), transcriptBlock]
          .filter(Boolean)
          .join("\n\n");
        currentUserContent = [
          { type: "text", text: framing },
          ...attachments.map((a) => ({
            type: "image_url" as const,
            image_url: { url: a.dataUrl, detail: "auto" as const },
          })),
          { type: "text", text: userPrompt },
        ];
      } else if (transcriptBlock) {
        currentUserContent = `${transcriptBlock}\n\n${userPrompt}`;
      } else {
        currentUserContent = userPrompt;
      }

      // Only image content needs the vision model; transcripts are plain text.
      const modelToUse = hasImages ? VISION_CHAT_MODEL : CHAT_MODEL;

      try {
        const completion = await openai.chat.completions.create({
          model: modelToUse,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...priorMessages,
            { role: "user", content: currentUserContent },
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
        model: modelToUse,
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
