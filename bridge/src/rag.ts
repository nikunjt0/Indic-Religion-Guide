import { CHAT_MODEL, VISION_CHAT_MODEL, openai } from "../../lib/openai.ts";
import { logQuery } from "../../lib/rag/log.ts";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  compressPriorAssistantTurn,
  groupChunksBySource,
} from "../../lib/rag/prompt.ts";
import {
  embedQuery,
  findNearestChunks,
  matchGuides,
} from "../../lib/rag/retrieve.ts";
import {
  mediaPreamble,
  summarizeMedia,
  type BridgeMediaAttachment,
} from "./media.ts";
import type {
  ChatMessage,
  MatchedGuideRef,
  SourceGroup,
  UserProfile,
} from "../../lib/types/firestore.ts";

export interface RagResult {
  answer: string;
  matchedChunkIds: string[];
  matchedGuideSlugs: string[];
  sources: SourceGroup[];
  matchedGuides: MatchedGuideRef[];
}

export async function askGuru(args: {
  handleId: string;
  question: string;
  profile: Partial<UserProfile>;
  history: ChatMessage[];
  attachments?: BridgeMediaAttachment[];
}): Promise<RagResult> {
  const started = Date.now();
  const { handleId, question, profile, history } = args;
  const attachments = args.attachments ?? [];
  const hasImages = attachments.length > 0;
  const effectiveQuestion =
    question.trim() ||
    (hasImages
      ? "Please identify and explain the attached photo or video."
      : question);

  const lastUserTurn = [...history].reverse().find((m) => m.role === "user");
  const retrievalQuery = [
    lastUserTurn?.content,
    effectiveQuestion,
    summarizeMedia(attachments),
  ]
    .filter(Boolean)
    .join("\n\n");

  const [queryVec, guides] = await Promise.all([
    embedQuery(retrievalQuery),
    matchGuides(effectiveQuestion, profile),
  ]);
  const chunks = await findNearestChunks(queryVec, 8);
  const grouped = groupChunksBySource(chunks);

  // SourceGroup is the persisted/rendered shape: same grouping as `grouped`
  // but each quote carries its chunk `id` so the public quotes page can key
  // off it. Walk the chunks twice (cheap) instead of mutating `grouped`.
  const sources: SourceGroup[] = (() => {
    const byTitle = new Map<string, SourceGroup["quotes"]>();
    const order: string[] = [];
    for (const c of chunks) {
      if (!byTitle.has(c.source_title)) {
        byTitle.set(c.source_title, []);
        order.push(c.source_title);
      }
      byTitle.get(c.source_title)!.push({
        id: c.id,
        source_title: c.source_title,
        chapter: c.chapter ?? null,
        verse: c.verse ?? null,
        page: c.page,
        text: c.text,
      });
    }
    return order.map((title, i) => ({
      index: i + 1,
      source_title: title,
      quotes: byTitle.get(title)!,
    }));
  })();
  const matchedGuides: MatchedGuideRef[] = guides.map((g) => ({
    slug: g.slug,
    title: g.title,
  }));

  const userPrompt = buildUserPrompt({
    question: effectiveQuestion,
    profile,
    sources: grouped,
    guides,
  });

  const priorMessages = history.map((m) =>
    m.role === "assistant"
      ? { role: "assistant" as const, content: compressPriorAssistantTurn(m.content) }
      : { role: "user" as const, content: m.content },
  );

  const currentUserContent = hasImages
    ? [
        { type: "text" as const, text: mediaPreamble(attachments) },
        ...attachments.map((a) => ({
          type: "image_url" as const,
          image_url: { url: a.dataUrl, detail: "auto" as const },
        })),
        { type: "text" as const, text: userPrompt },
      ]
    : userPrompt;
  const modelToUse = hasImages ? VISION_CHAT_MODEL : CHAT_MODEL;

  const completion = await openai.chat.completions.create({
    model: modelToUse,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...priorMessages,
      { role: "user", content: currentUserContent },
    ],
  });

  const answer = completion.choices[0]?.message?.content ?? "";

  // Fire-and-forget — failure to log shouldn't fail the user reply.
  logQuery({
    userId: handleId,
    question: effectiveQuestion,
    retrievedChunkIds: chunks.map((c) => c.id),
    retrievedGuideSlugs: guides.map((g) => g.slug),
    answer,
    promptVersion: PROMPT_VERSION,
    model: modelToUse,
    latencyMs: Date.now() - started,
  }).catch((err) => console.error("query log failed:", err));

  return {
    answer,
    matchedChunkIds: chunks.map((c) => c.id),
    matchedGuideSlugs: guides.map((g) => g.slug),
    sources,
    matchedGuides,
  };
}
