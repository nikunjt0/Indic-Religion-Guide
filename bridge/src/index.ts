import { config } from "./config.ts";
import {
  connectBlueBubbles,
  sendSegments,
  type BBAttachment,
  type IncomingMessage,
} from "./bluebubbles.ts";
import {
  citationTailFromSources,
  citationTailWithUrl,
  splitForSms,
  stripSourceBlocks,
  toSmsPlainText,
} from "./format.ts";
import { handleIdFor, normalizeHandle } from "./handle.ts";
import { loadRecentMessages, appendTurn } from "./history.ts";
import { log } from "./logger.ts";
import { processAttachments, type ProcessedMedia } from "./media.ts";
import {
  advance,
  getOrCreate,
  PROMPTS,
  promptsFor,
  type IMessageUser,
} from "./onboarding.ts";
import { askGuru } from "./rag.ts";
import { createShare } from "./shares.ts";
import { imessageUsersCol } from "./firestore.ts";
import {
  beginOnboardingV2,
  dedupInbound,
  handleCompanionInbound,
  startDispatcher,
} from "./companion.ts";
import { parseCommand } from "../../lib/commands/router.ts";
import type { MatchedGuideRef, SourceGroup } from "../../lib/types/firestore.ts";

// iMessage chat.style: 45 = direct (1:1), 43 = group. We only engage in 1:1
// threads — group chats are noisy and out of scope.
const STYLE_DIRECT = 45;

// Per-handle serialization. BlueBubbles "new-message" events are not delivered
// one-at-a-time, so without this a person who fires two texts in quick
// succession would have both handlers run concurrently — their two history
// read-modify-writes (appendTurn) would race and one turn could be lost,
// silently corrupting THAT person's memory. We chain each handle's work onto
// the previous task for the SAME handleId, so a person's messages are always
// processed in arrival order. DIFFERENT people are keyed separately, so one
// slow reply never blocks anyone else's thread — cross-person threads stay
// fully concurrent and fully isolated.
const handleQueues = new Map<string, Promise<void>>();

function runSerial(handleId: string, task: () => Promise<void>): void {
  const prev = handleQueues.get(handleId) ?? Promise.resolve();
  const next = prev.then(() => task()).catch((err) => {
    log.error(`processing for ${handleId} failed:`, err);
  });
  handleQueues.set(handleId, next);
  // Drop the entry once this task is the tail and has settled, so the map
  // doesn't grow without bound across many one-off senders.
  void next.finally(() => {
    if (handleQueues.get(handleId) === next) handleQueues.delete(handleId);
  });
}

// In-memory duplicate shield, independent of Firestore: BlueBubbles can
// re-emit an event (reconnects, server restarts), and Firestore-based dedup
// can't help if the write itself fails. Remembers recent event GUIDs.
const seenEventGuids = new Set<string>();
const SEEN_GUIDS_MAX = 1000;

function alreadySeen(guid: string): boolean {
  if (seenEventGuids.has(guid)) return true;
  seenEventGuids.add(guid);
  if (seenEventGuids.size > SEEN_GUIDS_MAX) {
    const oldest = seenEventGuids.values().next().value;
    if (oldest !== undefined) seenEventGuids.delete(oldest);
  }
  return false;
}

function handleInbound(raw: IncomingMessage): void {
  if (raw.isFromMe) return;
  if (raw.guid && alreadySeen(raw.guid)) {
    log.info(`duplicate socket event ${raw.guid} ignored (in-memory)`);
    return;
  }
  const chat = raw.chats?.[0];
  if (!chat || chat.style !== STYLE_DIRECT) return;
  const text = (raw.text ?? "").trim();
  const attachments = raw.attachments ?? [];
  // Drop only when there's nothing to act on. Previously any text-less message
  // was discarded, which silently swallowed image/video-only texts.
  if (!text && attachments.length === 0) return;
  const handleRaw = raw.handle?.address ?? "";
  if (!handleRaw) return;
  const handle = normalizeHandle(handleRaw);
  const handleId = handleIdFor(handle);
  const chatGuid = chat.guid;

  // Serialize everything from here on per handleId (Firestore reads, onboarding,
  // RAG, and the history write) so a single person's turns never interleave.
  runSerial(handleId, () =>
    processInbound({ handle, handleId, chatGuid, text, attachments, eventGuid: raw.guid }),
  );
}

interface InboundContext {
  handle: string;
  handleId: string;
  chatGuid: string;
  text: string;
  attachments: BBAttachment[];
  eventGuid: string;
}

async function processInbound({
  handle,
  handleId,
  chatGuid,
  text,
  attachments,
  eventGuid,
}: InboundContext): Promise<void> {
  // Deduplicate: BlueBubbles can re-emit the same message event. The event
  // GUID is recorded exactly once in messageEvents; a duplicate is dropped
  // before it can double-process or double-reply.
  try {
    const first = await dedupInbound(eventGuid, handleId, text);
    if (!first) {
      log.info(`duplicate event ${eventGuid} ignored`);
      return;
    }
  } catch (err) {
    // Dedup bookkeeping must never take the bridge down; worst case we
    // process a duplicate like the legacy behavior did.
    log.error("dedupInbound failed (continuing):", err);
  }

  // Stranger gate: if this handle has no user doc yet, the trigger word or
  // START begins the consent-first onboarding. Everything else is dropped.
  const existingSnap = await imessageUsersCol().doc(handleId).get();
  if (!existingSnap.exists) {
    const opener = text.toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (opener !== config.triggerWord && opener !== "start") {
      log.info(`ignoring stranger ${handle}: "${text.slice(0, 60)}"`);
      return;
    }
    log.info(`activating new user ${handle}`);
    // Legacy onboarding is superseded by v2: mark it complete so the old
    // machine never runs for new users.
    await imessageUsersCol().doc(handleId).set(
      {
        handleId,
        handle,
        chatGuid,
        onboardingState: "complete",
        traditions: ["hindu"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    await beginOnboardingV2({ handleId, handle, chatGuid }, chatGuid, text);
    return;
  }

  const user = existingSnap.data() as IMessageUser;
  // Lazy-capture chatGuid in case a session existed without one (unlikely).
  if (!user.chatGuid) {
    await imessageUsersCol().doc(handleId).update({ chatGuid });
    user.chatGuid = chatGuid;
  }

  // Reset escape hatch.
  if (text.toLowerCase() === "/reset") {
    await imessageUsersCol().doc(handleId).set(
      {
        onboardingState: "intro",
        displayName: null,
        lastName: null,
        cities: [],
        regions: [],
        region: null,
        languages: [],
        language: "english",
        additionalInfo: null,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    const fresh = (await imessageUsersCol().doc(handleId).get()).data() as IMessageUser;
    await runOnboardingFromIntro(fresh, chatGuid);
    return;
  }

  // Companion layer: onboarding-v2 steps and deterministic commands
  // (STOP/PAUSE/DEEPER/…) are handled before anything reaches the LLM.
  try {
    const handled = await handleCompanionInbound(
      user as unknown as Parameters<typeof handleCompanionInbound>[0],
      chatGuid,
      text,
    );
    if (handled) return;
  } catch (err) {
    // A failed command/onboarding step must NEVER fall through to the LLM —
    // RAG-answering the literal word "START" or "STOP" is worse than silence.
    log.error("companion handling failed:", err);
    await sendUserMessages(chatGuid, [
      "Something went wrong on my end — please send that again in a moment.",
    ]);
    return;
  }

  // Belt and braces: a bare command that somehow wasn't handled above still
  // must not be sent to the answer engine as a question.
  if (parseCommand(text)) {
    log.warn(`unhandled command "${text.slice(0, 30)}" — suppressing RAG fallthrough`);
    return;
  }

  if (user.onboardingState !== "complete") {
    const result = await advance(user, text);
    await sendUserMessages(chatGuid, result.reply);
    return;
  }

  // Onboarded → RAG.
  await respondWithGuru(user, chatGuid, text, attachments);
}

async function runOnboardingFromIntro(user: IMessageUser, chatGuid: string): Promise<void> {
  // First send the intro message, then advance to ask_name and send that
  // prompt. Doing it as two separate messages keeps the intro from getting
  // wrapped together with the first question.
  await sendUserMessages(chatGuid, [PROMPTS.intro]);
  const result = await advance(user, "");
  await sendUserMessages(chatGuid, result.next === "ask_name" ? [PROMPTS.ask_name] : result.reply);
}

async function respondWithGuru(
  user: IMessageUser,
  chatGuid: string,
  question: string,
  rawAttachments: BBAttachment[] = [],
): Promise<void> {
  const history = await loadRecentMessages(user.handleId);

  // Download + process any image/video/audio the user texted in. One bad file
  // shouldn't sink the whole reply, so failures degrade to an empty result.
  let media: ProcessedMedia = { images: [], transcripts: [] };
  if (rawAttachments.length > 0) {
    try {
      media = await processAttachments(rawAttachments);
    } catch (err) {
      log.error("processAttachments failed:", err);
    }
  }

  let answer: string;
  let chunkIds: string[] = [];
  let sources: SourceGroup[] = [];
  let matchedGuides: MatchedGuideRef[] = [];
  try {
    const result = await askGuru({
      handleId: user.handleId,
      question,
      profile: user,
      history,
      attachments: media.images,
      transcripts: media.transcripts,
    });
    answer = result.answer;
    chunkIds = result.matchedChunkIds;
    sources = result.sources;
    matchedGuides = result.matchedGuides;
  } catch (err) {
    log.error("askGuru failed:", err);
    await sendUserMessages(chatGuid, [
      "Something broke on my end answering that. Please try again in a moment.",
    ]);
    return;
  }

  const stripped = stripSourceBlocks(answer);
  const body = toSmsPlainText(stripped) || answer.trim() || "(no answer)";

  // Prefer a single short URL to the quotes page over the inline title list.
  // If share creation fails (or APP_PUBLIC_URL isn't configured), fall back
  // to the legacy citation tail so SMS still carries citation info.
  let tail = "";
  if (sources.length > 0) {
    try {
      const share = await createShare({
        question,
        answer,
        sources,
        matchedGuides,
      });
      if (share) tail = citationTailWithUrl(sources, share.url);
    } catch (err) {
      log.error("createShare failed (falling back to citation tail):", err);
    }
  }
  if (!tail) tail = citationTailFromSources(sources);

  const final = `${body}${tail}`;
  const segments = splitForSms(final);
  await sendUserMessages(chatGuid, segments);
  // Persist a text record of the user's turn. We never store the image bytes,
  // but we note what was attached and keep any transcript so follow-up turns
  // ("what does that say?") still have the context.
  const storedQuestion =
    [question, mediaNote(media)].filter(Boolean).join("\n").trim() || "(media only)";
  await appendTurn(
    user.handleId,
    { content: storedQuestion },
    {
      content: answer,
      sources,
      matchedGuides,
    },
  );
  void chunkIds;
}

// A compact, text-only summary of attached media for chat history.
function mediaNote(media: ProcessedMedia): string {
  const photos = media.images.filter((i) => i.kind === "image").length;
  const frames = media.images.filter((i) => i.kind === "video-frame").length;
  const bits: string[] = [];
  if (photos) bits.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  if (frames) bits.push(`${frames} video frame${frames === 1 ? "" : "s"}`);
  let note = bits.length ? `[attached ${bits.join(", ")}]` : "";
  for (const t of media.transcripts) {
    note += `\n[transcript of ${t.sourceName}: ${t.text.slice(0, 500)}]`;
  }
  return note.trim();
}

async function sendUserMessages(chatGuid: string, messages: string[]): Promise<void> {
  const expanded: string[] = [];
  for (const m of messages) {
    for (const seg of splitForSms(m)) expanded.push(seg);
  }
  await sendSegments(chatGuid, expanded);
}

// --- bootstrap ----------------------------------------------------------------

function main(): void {
  log.info(`Indic Guide bridge starting (BB_URL=${config.bbUrl})`);
  connectBlueBubbles(handleInbound);
  startDispatcher();
  log.info("listening for new-message events");
}

main();

// Surface unhandled errors instead of silently crashing the daemon.
process.on("unhandledRejection", (err) => log.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => log.error("uncaughtException:", err));
