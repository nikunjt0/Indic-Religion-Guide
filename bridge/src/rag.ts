import { CHAT_MODEL, VISION_CHAT_MODEL, openai } from "../../lib/openai.ts";
import { logQuery } from "../../lib/rag/log.ts";
import {
  PROMPT_VERSION_SMS,
  SYSTEM_PROMPT_SMS,
  buildUserPrompt,
  compressPriorAssistantTurn,
  groupChunksBySource,
} from "../../lib/rag/prompt.ts";
import { withRiskAddendum } from "../../lib/answers/risk.ts";
import {
  embedQuery,
  findNearestChunks,
  matchGuides,
} from "../../lib/rag/retrieve.ts";
import type { MediaImage, MediaTranscript } from "./media.ts";
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

// One short framing sentence in front of attached images, so the model knows
// it's looking at photos / a sequence of video keyframes (mirrors the web
// app's buildMediaPreamble in app/api/ask/route.ts).
function buildMediaPreamble(images: MediaImage[]): string {
  const photos = images.filter((a) => a.kind === "image").length;
  const frames = images.filter((a) => a.kind === "video-frame").length;
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  if (frames > 0) parts.push(`${frames} keyframes sampled from a video (in chronological order)`);
  if (parts.length === 0) return "";
  return `The user attached ${parts.join(" and ")} with their question. FIRST name the specific things visible that bear on the question — be concrete, not generic (for a person: beard/moustache/hair length, śikhā or none, tilaka or none; for an altar/murti: which deity, the implements and arrangement; for a posture: hands, mudra, seat). THEN judge those specifics against the named dharmic norm using the retrieved sources below, with a concrete verdict and what to keep or change — never a generic "keep it tidy" answer.`;
}

// Fold transcribed audio/video soundtrack into a prompt block.
function buildTranscriptBlock(transcripts: MediaTranscript[]): string {
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

export async function askGuru(args: {
  handleId: string;
  question: string;
  profile: Partial<UserProfile>;
  history: ChatMessage[];
  attachments?: MediaImage[];
  transcripts?: MediaTranscript[];
}): Promise<RagResult> {
  const started = Date.now();
  const { handleId, question, profile, history } = args;
  const attachments = args.attachments ?? [];
  const transcripts = args.transcripts ?? [];
  const hasImages = attachments.length > 0;

  // The texted question may be empty (image-only message). Fall back to the
  // transcript, then to a generic identify-and-prescribe query, so retrieval
  // always has something to embed and match guides against.
  const transcriptText = transcripts.map((t) => t.text).join("\n\n").trim();
  const effectiveQuestion =
    question.trim() ||
    transcriptText ||
    (hasImages ? "Identify what is shown and the relevant Hindu practice." : "");

  const lastUserTurn = [...history].reverse().find((m) => m.role === "user");
  const retrievalQuery = lastUserTurn
    ? `${lastUserTurn.content}\n\n${effectiveQuestion}`
    : effectiveQuestion;

  const [queryVec, guides] = await Promise.all([
    embedQuery(retrievalQuery),
    matchGuides(effectiveQuestion, profile),
  ]);
  const chunks = await findNearestChunks(queryVec, 8, { question: effectiveQuestion });
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
    smsMode: true,
  });

  const priorMessages = history.map((m) =>
    m.role === "assistant"
      ? { role: "assistant" as const, content: compressPriorAssistantTurn(m.content) }
      : { role: "user" as const, content: m.content },
  );

  // Images must ride on the vision model as image_url content parts; the
  // SMS chat model is text-only. Transcripts are plain text either way.
  const transcriptBlock = buildTranscriptBlock(transcripts);
  let currentUserContent:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "auto" } }
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

  const model = hasImages ? VISION_CHAT_MODEL : CHAT_MODEL;

  const completion = await openai.chat.completions.create({
    model,
    // Low temperature: commit to one concrete prescription, don't hedge.
    temperature: 0.3,
    messages: [
      { role: "system", content: withRiskAddendum(SYSTEM_PROMPT_SMS, effectiveQuestion) },
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
    promptVersion: PROMPT_VERSION_SMS,
    model,
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
