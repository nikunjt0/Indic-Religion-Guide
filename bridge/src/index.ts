import { config } from "./config.ts";
import {
  connectBlueBubbles,
  sendSegments,
  type IncomingMessage,
} from "./bluebubbles.ts";
import {
  citationTail,
  splitForSms,
  stripSourceBlocks,
  toSmsPlainText,
} from "./format.ts";
import { handleIdFor, normalizeHandle } from "./handle.ts";
import { loadRecentMessages, appendTurn } from "./history.ts";
import { log } from "./logger.ts";
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
import type { MatchedGuideRef, SourceGroup } from "../../lib/types/firestore.ts";

// iMessage chat.style: 45 = direct (1:1), 43 = group. We only engage in 1:1
// threads — group chats are noisy and out of scope.
const STYLE_DIRECT = 45;

async function handleInbound(raw: IncomingMessage): Promise<void> {
  if (raw.isFromMe) return;
  const chat = raw.chats?.[0];
  if (!chat || chat.style !== STYLE_DIRECT) return;
  const text = (raw.text ?? "").trim();
  if (!text) return;
  const handleRaw = raw.handle?.address ?? "";
  if (!handleRaw) return;
  const handle = normalizeHandle(handleRaw);
  const handleId = handleIdFor(handle);
  const chatGuid = chat.guid;

  // Stranger gate: if this handle has no user doc yet, only the literal
  // trigger word "guru" (case-insensitive, surrounding whitespace ignored)
  // creates a session. Everything else is dropped silently.
  const existingSnap = await imessageUsersCol().doc(handleId).get();
  if (!existingSnap.exists) {
    if (text.toLowerCase() !== config.triggerWord) {
      log.info(`ignoring stranger ${handle}: "${text.slice(0, 60)}"`);
      return;
    }
    log.info(`activating new user ${handle}`);
    const { user } = await getOrCreate(handleId, handle, chatGuid);
    await runOnboardingFromIntro(user, chatGuid);
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

  if (user.onboardingState !== "complete") {
    const result = await advance(user, text);
    await sendUserMessages(chatGuid, result.reply);
    return;
  }

  // Onboarded → RAG.
  await respondWithGuru(user, chatGuid, text);
}

async function runOnboardingFromIntro(user: IMessageUser, chatGuid: string): Promise<void> {
  // First send the intro message, then advance to ask_city and send that
  // prompt. Doing it as two separate messages keeps the intro from getting
  // wrapped together with the first question.
  await sendUserMessages(chatGuid, [PROMPTS.intro]);
  const result = await advance(user, "");
  await sendUserMessages(chatGuid, result.next === "ask_city" ? [PROMPTS.ask_city] : result.reply);
}

async function respondWithGuru(user: IMessageUser, chatGuid: string, question: string): Promise<void> {
  const history = await loadRecentMessages(user.handleId);
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
      if (share) tail = `\n\nSources: ${share.url}`;
    } catch (err) {
      log.error("createShare failed (falling back to citation tail):", err);
    }
  }
  if (!tail) tail = citationTail(answer);

  const final = `${body}${tail}`;
  const segments = splitForSms(final);
  await sendUserMessages(chatGuid, segments);
  await appendTurn(
    user.handleId,
    { content: question },
    {
      content: answer,
      sources,
      matchedGuides,
    },
  );
  void chunkIds;
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
  log.info("listening for new-message events");
}

main();

// Surface unhandled errors instead of silently crashing the daemon.
process.on("unhandledRejection", (err) => log.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => log.error("uncaughtException:", err));
