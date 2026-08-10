import { adminDb, imessageUsersCol } from "./firestore.ts";
import { log } from "./logger.ts";
import { config } from "./config.ts";
import { splitForSms } from "./format.ts";
import { sendSegments } from "./bluebubbles.ts";
import { parseCommand, type Command } from "../../lib/commands/router.ts";
import {
  runCompanionAgent,
  type CompanionAgentSnapshot,
  type CompanionToolExecutor,
} from "../../lib/companion/agent.ts";
import { appendTurn, loadRecentMessages } from "./history.ts";
import {
  currentPrompt,
  stepOnboarding,
  welcomeMessage,
  type OnboardingContext,
  type OnboardingState,
} from "../../lib/onboarding/machine.ts";
import {
  getActiveEnrollment,
  getEnrollment,
  getPreferences,
  recordInboundEventOnce,
  recordOutboundEvent,
  saveEnrollment,
  savePreferences,
} from "../../lib/companion/store.ts";
import {
  advanceEnrollment,
  lessonForDay,
  newEnrollment,
  scheduleCurrentLesson,
  type ProgramWithLessons,
} from "../../lib/programs/engine.ts";
import { loadAllProgramFiles } from "../../lib/programs/content.ts";
import {
  cancelPendingDeliveries,
  enqueueDelivery,
  runDispatchTick,
  type EngineDeps,
} from "../../lib/scheduling/engine.ts";
import { FirestoreDeliveryStore } from "../../lib/scheduling/firestore-store.ts";
import { systemClock } from "../../lib/scheduling/clock.ts";
import {
  localDateOf,
  nextOccurrence,
  parseUserTimeInputDetailed,
} from "../../lib/scheduling/time.ts";
import { BlueBubblesMessagingProvider } from "../../lib/messaging/bluebubbles.ts";
import { GuardedMessagingProvider } from "../../lib/messaging/guarded.ts";
import { guardConfigFromEnv } from "../../lib/messaging/guard.ts";
import type { DeliveryPreferences, ScheduledDelivery } from "../../lib/types/companion.ts";
import { PAUSED_INDEFINITELY } from "../../lib/types/companion.ts";
import { DateTime } from "luxon";

// Companion runtime for the bridge: the delivery dispatcher, deterministic
// command handling, and the consent-first onboarding flow. Free-form questions
// still go to the RAG guru (index.ts falls through when handleCompanionInbound
// returns false).

const PRODUCT_NAME = "Dharma Companion";
const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE ?? "America/Chicago";
const DISPATCH_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Runtime singletons
// ---------------------------------------------------------------------------

const programCache = new Map<string, ProgramWithLessons>();

function programs(): Map<string, ProgramWithLessons> {
  if (programCache.size === 0) {
    try {
      for (const p of loadAllProgramFiles()) programCache.set(p.slug, p);
    } catch (err) {
      log.error("failed to load program content files:", err);
    }
  }
  return programCache;
}

function getProgram(slug: string): ProgramWithLessons | null {
  return programs().get(slug) ?? null;
}

// Proactive queue sends are strictly guarded (MESSAGING_SEND_ENABLED).
// Conversational replies to an inbound message keep working like the legacy
// bridge (the user just texted us), but still honor MESSAGING_TEST_ALLOWLIST.
const envGuard = guardConfigFromEnv();
const rawProvider = new BlueBubblesMessagingProvider({
  baseUrl: config.bbUrl,
  password: config.bbPassword,
});
const queueProvider = new GuardedMessagingProvider(rawProvider, envGuard, (r, reason) =>
  log.warn(`queue send blocked (${reason}) for ${r.handle}`)
);

const deliveryStore = new FirestoreDeliveryStore(adminDb);

const engineDeps: EngineDeps = {
  store: deliveryStore,
  provider: queueProvider,
  clock: systemClock,
  loadPreferences: (userId) => getPreferences(adminDb, userId),
  renderMessage: async (d) => renderQueuedMessage(d),
  onSent: async (d, result) => {
    await recordOutboundEvent(adminDb, {
      id: `out-${d.id}`,
      userId: d.userId,
      direction: "outbound",
      provider: d.provider,
      providerMessageId: result.providerMessageId,
      deliveryId: d.id,
      programId: d.programId,
      lessonDay: d.lessonDay,
      sentAt: result.sentAt ?? Date.now(),
      processingStatus: "processed",
      isFromMe: true,
    });
    if (d.deliveryType === "program-lesson") await afterLessonSent(d);
    if (d.deliveryType === "daily-dharma") await scheduleNextDailyDharma(d.userId);
  },
  onSuppressed: async (d, code) => {
    // A guard-blocked send (MESSAGING_SEND_ENABLED off / not allowlisted) must
    // not kill the recurring pipeline: queue the next occurrence so deliveries
    // resume automatically once sending is enabled. Other suppression reasons
    // (paused, opted out, disabled) intentionally stop the pipeline — RESUME
    // or START restarts it.
    if (code !== "send-guard-blocked") return;
    log.warn(
      `delivery ${d.id} suppressed by send guard — scheduling next occurrence; ` +
        `set MESSAGING_SEND_ENABLED=true to actually send`
    );
    if (d.deliveryType === "daily-dharma") {
      await scheduleNextDailyDharma(d.userId);
      return;
    }
    if (d.deliveryType === "program-lesson" && d.enrollmentId && d.programId) {
      const enrollment = await getEnrollment(adminDb, d.enrollmentId);
      const program = getProgram(d.programId);
      const prefs = await getPreferences(adminDb, d.userId);
      if (!enrollment || enrollment.status !== "active" || !program || !prefs) return;
      await scheduleCurrentLesson(engineDeps, {
        enrollment,
        program,
        prefs,
        recipientHandle: d.recipientHandle,
        recipientChatGuid: d.recipientChatGuid,
        providerName: d.provider,
      });
    }
  },
  log: (m, extra) => log.info(m, extra ?? ""),
};

let dispatcherTimer: NodeJS.Timeout | null = null;

export function startDispatcher(): void {
  if (dispatcherTimer) return;
  const tick = async () => {
    try {
      const stats = await runDispatchTick(engineDeps, {
        leaseOwner: `bridge-${process.pid}`,
      });
      if (stats.due > 0 || stats.recoveredLeases > 0) {
        log.info("dispatcher:", JSON.stringify(stats));
      }
    } catch (err) {
      log.error("dispatch tick failed:", err);
    }
  };
  dispatcherTimer = setInterval(tick, DISPATCH_INTERVAL_MS);
  void tick();
  log.info(
    `dispatcher started (interval ${DISPATCH_INTERVAL_MS / 1000}s, sends ${
      envGuard.sendEnabled ? "ENABLED" : "DISABLED — set MESSAGING_SEND_ENABLED=true"
    }${envGuard.allowlist ? `, allowlist ${envGuard.allowlist.length} handles` : ""})`
  );
}

// ---------------------------------------------------------------------------
// Message rendering for queued deliveries without a pre-rendered body
// ---------------------------------------------------------------------------

async function renderQueuedMessage(d: ScheduledDelivery): Promise<string | null> {
  if (d.deliveryType === "program-lesson" && d.programId && d.lessonDay) {
    const program = getProgram(d.programId);
    return lessonForDay(program!, d.lessonDay)?.standardMessage ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Enrollment progression after a confirmed lesson send
// ---------------------------------------------------------------------------

async function afterLessonSent(d: ScheduledDelivery): Promise<void> {
  if (!d.enrollmentId || !d.lessonDay || !d.programId) return;
  const enrollment = await getEnrollment(adminDb, d.enrollmentId);
  const program = getProgram(d.programId);
  if (!enrollment || !program) return;
  const advanced = advanceEnrollment(enrollment, d.lessonDay, program.durationDays, Date.now());
  if (advanced === enrollment) return; // already advanced (idempotent replay)
  await saveEnrollment(adminDb, advanced);

  if (advanced.status === "completed") {
    await enqueueDelivery(engineDeps, {
      userId: d.userId,
      recipientHandle: d.recipientHandle,
      recipientChatGuid: d.recipientChatGuid,
      provider: d.provider,
      deliveryType: "transactional",
      scheduledAt: Date.now(),
      scheduledLocalDate: localDateOf(Date.now(), d.timezone),
      timezone: d.timezone,
      variant: `completed-${d.programId}`,
      renderedMessage:
        `You finished ${program.title} — ${advanced.completedLessonDays.length} teachings over ` +
        `${program.durationDays} days. Reply PROGRAMS to choose what's next, or keep asking ` +
        `questions anytime.`,
    });
    return;
  }

  const prefs = await getPreferences(adminDb, d.userId);
  if (!prefs) return;
  await scheduleCurrentLesson(engineDeps, {
    enrollment: advanced,
    program,
    prefs,
    recipientHandle: d.recipientHandle,
    recipientChatGuid: d.recipientChatGuid,
    providerName: d.provider,
  });
}

// ---------------------------------------------------------------------------
// Daily Dharma (starter rotation until the full personalization phase)
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";

interface DailyDharmaEntry {
  id: string;
  message: string;
}

let dharmaEntries: DailyDharmaEntry[] | null = null;

function loadDailyDharma(): DailyDharmaEntry[] {
  if (!dharmaEntries) {
    try {
      const file = path.join(process.cwd(), "..", "content", "daily-dharma.json");
      dharmaEntries = JSON.parse(readFileSync(file, "utf8")).entries as DailyDharmaEntry[];
    } catch {
      try {
        const file = path.join(process.cwd(), "content", "daily-dharma.json");
        dharmaEntries = JSON.parse(readFileSync(file, "utf8")).entries as DailyDharmaEntry[];
      } catch (err) {
        log.error("daily-dharma content missing:", err);
        dharmaEntries = [];
      }
    }
  }
  return dharmaEntries;
}

function pickDailyDharma(userId: string, localDate: string): DailyDharmaEntry | null {
  const entries = loadDailyDharma();
  if (entries.length === 0) return null;
  // Deterministic per user+date; different users see different entries the
  // same day, and no user repeats until the rotation wraps.
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const dayIndex = Math.floor(Date.parse(localDate) / 86_400_000);
  return entries[(hash + dayIndex) % entries.length];
}

async function scheduleNextDailyDharma(userId: string): Promise<void> {
  const prefs = await getPreferences(adminDb, userId);
  if (!prefs || !prefs.dailyDharmaEnabled || prefs.consentStatus !== "granted") return;
  const user = (await imessageUsersCol().doc(userId).get()).data() as
    | { handle?: string; chatGuid?: string }
    | undefined;
  if (!user?.handle) return;
  const next = nextOccurrence(
    {
      timezone: prefs.timezone,
      preferredLocalTime: prefs.preferredLocalTime,
      deliveryDays: prefs.deliveryDays,
    },
    Date.now()
  );
  const entry = pickDailyDharma(userId, next.localDate);
  if (!entry) return;
  await enqueueDelivery(engineDeps, {
    userId,
    recipientHandle: user.handle,
    recipientChatGuid: user.chatGuid,
    provider: "bluebubbles",
    deliveryType: "daily-dharma",
    scheduledAt: next.atMs,
    scheduledLocalDate: next.localDate,
    timezone: prefs.timezone,
    renderedMessage: entry.message,
    variant: entry.id,
  });
}

// ---------------------------------------------------------------------------
// Inbound handling: dedup, onboarding, commands
// ---------------------------------------------------------------------------

export async function dedupInbound(eventGuid: string, userId: string, text: string): Promise<boolean> {
  return recordInboundEventOnce(adminDb, {
    id: eventGuid,
    userId,
    direction: "inbound",
    provider: "bluebubbles",
    body: text.slice(0, 500),
    receivedAt: Date.now(),
    processingStatus: "pending",
    isFromMe: false,
  });
}

interface CompanionUserDoc {
  handleId: string;
  handle: string;
  chatGuid?: string;
  onboardingState?: string; // legacy machine
  onboardingV2State?: OnboardingState;
  displayName?: string;
  pendingTimeChange?: boolean;
  savedTeachings?: { programId: string; day: number; title: string }[];
  accountStatus?: string;
  [key: string]: unknown;
}

function obCtx(): OnboardingContext {
  return { productName: PRODUCT_NAME, defaultTimezone: DEFAULT_TZ };
}

async function reply(chatGuid: string, messages: string[]): Promise<void> {
  const expanded: string[] = [];
  for (const m of messages) if (m.trim()) expanded.push(...splitForSms(m));
  if (expanded.length > 0) await sendSegments(chatGuid, expanded);
}

/**
 * Kick off consent-first onboarding for a brand-new or restarting user.
 * When the opener itself is START (e.g. from a "text START to …" CTA), that
 * message IS the affirmative consent — don't ask the user to reply START to
 * their own START.
 */
export async function beginOnboardingV2(
  user: CompanionUserDoc,
  chatGuid: string,
  initialText = ""
): Promise<void> {
  const openerCmd = parseCommand(initialText);
  if (openerCmd?.kind === "start") {
    await imessageUsersCol().doc(user.handleId).set(
      { onboardingV2State: "awaiting-name", chatGuid, updatedAt: Date.now() },
      { merge: true }
    );
    await savePreferences(adminDb, user.handleId, {
      consentStatus: "granted",
      consentTimestamp: Date.now(),
      consentSource: "imessage",
      enabled: true,
      dailyDharmaEnabled: false,
      programMessagesEnabled: true,
      festivalMessagesEnabled: true,
      weeklyRecapEnabled: true,
      inactivityCheckInsEnabled: true,
      timezone: DEFAULT_TZ,
      preferredLocalTime: "07:30",
      createdAt: Date.now(),
    });
    await reply(chatGuid, [
      `Namaste, and welcome! 🙏 I'm your Hindu Guru — a daily learning companion grounded in scripture. ` +
        `I'm trained on the Bhagavad Gita, the Upanishads, the Ramayana and Mahabharata, the Puranas, ` +
        `devotional poetry, and classical Ayurveda texts — and I cite my sources when I answer.\n\n` +
        `You can text me any question, anytime: about a verse, a ritual, a festival, or something ` +
        `you've wondered about for years. I can also send one short teaching each day at a time you ` +
        `choose. Reply STOP anytime to opt out.`,
      "First — what should I call you?",
    ]);
    return;
  }
  await imessageUsersCol().doc(user.handleId).set(
    { onboardingV2State: "awaiting-consent", chatGuid, updatedAt: Date.now() },
    { merge: true }
  );
  await reply(chatGuid, [welcomeMessage(obCtx())]);
}

export interface CompanionInboundResult {
  handled: boolean;
  /**
   * Set when the agent already replied to the account part of a mixed message
   * and extracted the remaining scripture question for the RAG guru. The
   * caller should answer this question instead of the raw inbound text.
   */
  guruQuestion?: string;
}

/**
 * Handle an inbound message through the companion layer: onboarding steps,
 * deterministic keyword commands, then the conversational account agent.
 * `handled: false` → fall through to the RAG guru.
 */
export async function handleCompanionInbound(
  user: CompanionUserDoc,
  chatGuid: string,
  text: string
): Promise<CompanionInboundResult> {
  const userRef = imessageUsersCol().doc(user.handleId);

  // Onboarding v2 in progress.
  const obState = user.onboardingV2State;
  if (obState && obState !== "completed") {
    const result = stepOnboarding(obState, text, obCtx());
    if (result.deflected) {
      // Real question mid-onboarding: let RAG answer, then re-prompt.
      await userRef.set({ onboardingV2State: result.nextState }, { merge: true });
      queueReprompt(user.handleId, chatGuid, result.nextState);
      return { handled: false };
    }
    await applyOnboardingStep(
      user,
      chatGuid,
      result.nextState,
      result.patch as Record<string, unknown>,
      result.replies
    );
    return { handled: true };
  }

  // Pending time change ("CHANGE TIME" → next message is the new time).
  if (user.pendingTimeChange) {
    const parsed = parseUserTimeInputDetailed(text);
    if (parsed?.needsMeridiem) {
      await reply(chatGuid, [
        "Please include AM or PM for that delivery time, like “6:25 PM”.",
      ]);
      return { handled: true };
    }
    if (parsed) {
      await userRef.set({ pendingTimeChange: false }, { merge: true });
      await changeDeliveryTime(user, chatGuid, parsed.time);
      return { handled: true };
    }
    await userRef.set({ pendingTimeChange: false }, { merge: true });
    // Not a time — fall through (maybe it's a question or a command).
  }

  // Exact keyword commands (STOP, DELETE MY DATA, PAUSE, DEEPER, …) stay
  // deterministic: compliance keywords must never depend on a model, and the
  // rest are documented single-word replies.
  const cmd = parseCommand(text);
  if (cmd) {
    await handleCommand(user, chatGuid, cmd);
    return { handled: true };
  }

  if (!text.trim()) return { handled: false };

  // Everything else: the conversational account agent. It sees the account
  // state and chat history, performs account actions through tools, and
  // composes its own reply — or hands the message to the RAG guru when it's
  // a content question.
  try {
    const [snapshot, history] = await Promise.all([
      buildAgentSnapshot(user),
      loadRecentMessages(user.handleId),
    ]);
    const result = await runCompanionAgent({
      message: text,
      history: history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      snapshot,
      executor: agentExecutor(user),
    });
    if (result.kind === "pass-to-guru") return { handled: false };
    if (result.text) {
      await reply(chatGuid, [result.text]);
      await appendTurn(user.handleId, { content: text }, { content: result.text });
    }
    if (result.guruQuestion) return { handled: false, guruQuestion: result.guruQuestion };
    return { handled: true };
  } catch (err) {
    // Agent failure must not silence the user — fall through to the guru.
    log.error("companion agent failed — falling through to RAG:", err);
    return { handled: false };
  }
}

// ---------------------------------------------------------------------------
// Agent wiring: account snapshot + tool executors
// ---------------------------------------------------------------------------

async function buildAgentSnapshot(user: CompanionUserDoc): Promise<CompanionAgentSnapshot> {
  const prefs = await getPreferences(adminDb, user.handleId);
  const enrollment = await getActiveEnrollment(adminDb, user.handleId);
  const program = enrollment ? getProgram(enrollment.programId) : null;
  const tz = prefs?.timezone ?? DEFAULT_TZ;

  let nextMessageText: string | undefined;
  if (prefs) {
    const pending = await deliveryStore.findPendingByUser(user.handleId);
    const nextUp = pending
      .filter((d) => ["queued", "retry"].includes(d.status))
      .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    if (nextUp) {
      nextMessageText = DateTime.fromMillis(nextUp.scheduledAt, { zone: tz }).toFormat(
        "cccc, LLL d 'at' h:mm a ZZZZ"
      );
    }
  }

  const pausedUntil = prefs?.pausedUntil ?? null;
  const paused = pausedUntil !== null && pausedUntil > Date.now();
  return {
    productName: PRODUCT_NAME,
    userName: user.displayName,
    consentGranted: prefs?.consentStatus === "granted",
    optedOut: prefs?.consentStatus === "revoked",
    pausedUntilText: paused
      ? pausedUntil === PAUSED_INDEFINITELY
        ? "they say resume"
        : DateTime.fromMillis(pausedUntil, { zone: tz }).toFormat("cccc, LLL d")
      : undefined,
    deliveryTimeText: prefs ? formatPrefTime(prefs) : undefined,
    nextMessageText,
    dailyDharmaEnabled: prefs?.dailyDharmaEnabled ?? false,
    program:
      enrollment && program
        ? {
            slug: program.slug,
            title: program.title,
            day: enrollment.currentDay,
            durationDays: program.durationDays,
            lessonsDelivered: enrollment.completedLessonDays.length,
          }
        : null,
    catalog: [...programs().values()].map((p) => ({
      slug: p.slug,
      title: p.title,
      durationDays: p.durationDays,
      description: p.shortDescription,
    })),
    localNowText: DateTime.now().setZone(tz).toFormat("cccc, LLL d, h:mm a ZZZZ"),
  };
}

const NOT_SET_UP = {
  error: "not-set-up",
  note: "The user hasn't completed consent/setup. Warmly tell them to text START so you can get them set up first (consent requires that exact keyword).",
};

function agentExecutor(user: CompanionUserDoc): CompanionToolExecutor {
  const userId = user.handleId;
  return {
    async enrollInProgram({ programSlug, replaceCurrent }) {
      const prefs = await getPreferences(adminDb, userId);
      if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;
      const program = getProgram(programSlug);
      if (!program) return { error: "unknown-program" };
      const active = await getActiveEnrollment(adminDb, userId);
      if (active?.programId === program.slug) {
        return {
          status: "already-enrolled",
          program: program.title,
          day: active.currentDay,
          durationDays: program.durationDays,
          note: "They are already in this program. Offer to restart it if they want to begin again.",
        };
      }
      if (active && !replaceCurrent) {
        return {
          status: "needs-confirmation",
          currentProgram: getProgram(active.programId)?.title ?? active.programId,
          currentDay: active.currentDay,
          note: "Only one program runs at a time and their progress in the current one is saved. Ask whether they want to switch; if they confirm, call again with replace_current true.",
        };
      }
      let switchedFrom: string | undefined;
      if (active) {
        await saveEnrollment(adminDb, { ...active, status: "canceled", updatedAt: Date.now() });
        await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"]);
        switchedFrom = getProgram(active.programId)?.title ?? active.programId;
      }
      const enrollment = newEnrollment({
        userId,
        program,
        nowMs: Date.now(),
        source: "conversation",
      });
      await saveEnrollment(adminDb, enrollment);
      const res = await rescheduleActive(user, false);
      if (!res) {
        return {
          status: "enrolled-but-unverified",
          program: program.title,
          switchedFrom,
          note: "Enrollment saved, but the first lesson could not be confirmed in the delivery queue. Say you're double-checking on your end and it may take a minute.",
        };
      }
      return {
        status: "enrolled",
        program: program.title,
        durationDays: program.durationDays,
        firstLessonDay: res.day,
        firstLessonArrives: res.when,
        switchedFrom,
      };
    },

    async enableDailyDharma() {
      const prefs = await getPreferences(adminDb, userId);
      if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;
      if (prefs.dailyDharmaEnabled) {
        return { status: "already-on", deliveryTime: formatPrefTime(prefs) };
      }
      await savePreferences(adminDb, userId, { dailyDharmaEnabled: true });
      await scheduleNextDailyDharma(userId);
      return { status: "enabled", deliveryTime: formatPrefTime(prefs) };
    },

    async disableDailyDharma() {
      await savePreferences(adminDb, userId, { dailyDharmaEnabled: false });
      await cancelPendingDeliveries(engineDeps, userId, ["daily-dharma"]);
      return { status: "disabled" };
    },

    async changeDeliveryTime(timeText) {
      const prefs = await getPreferences(adminDb, userId);
      if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;
      const parsed = parseUserTimeInputDetailed(timeText);
      if (parsed?.needsMeridiem) {
        return { error: "ambiguous-time", note: "Ask whether they mean AM or PM." };
      }
      if (!parsed) {
        return {
          error: "unrecognized-time",
          note: "Ask what time they'd like — e.g. 7:30 AM, 8 pm, or after dinner.",
        };
      }
      return applyDeliveryTimeChange(user, parsed.time);
    },

    async pauseMessages(days) {
      const until = days ? Date.now() + days * 86_400_000 : PAUSED_INDEFINITELY;
      await savePreferences(adminDb, userId, {
        pausedUntil: until,
        pauseReason: days ? `pause-${days}d` : "pause-indefinite",
      });
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson", "daily-dharma"]);
      return {
        status: "paused",
        days: days ?? null,
        note: days
          ? "Progress is saved; messages resume automatically after the pause."
          : "Paused until they ask to resume. Progress is saved.",
      };
    },

    async resumeMessages() {
      await savePreferences(adminDb, userId, { pausedUntil: null, pauseReason: "" });
      const resumed = await rescheduleActive(user, false);
      if (resumed) {
        return {
          status: "resumed",
          nextLessonDay: resumed.day,
          arrives: resumed.when,
          note: "They continue from where they paused — no missed-lesson pile-up.",
        };
      }
      const prefs = await getPreferences(adminDb, userId);
      if (prefs?.dailyDharmaEnabled) {
        await scheduleNextDailyDharma(userId);
        return { status: "resumed", note: "Daily Dharma returns at the usual time." };
      }
      return { status: "nothing-to-resume" };
    },

    async restartProgram() {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      const program = enrollment && getProgram(enrollment.programId);
      if (!enrollment || !program) return { error: "no-active-program" };
      await saveEnrollment(adminDb, {
        ...enrollment,
        currentDay: 1,
        completedLessonDays: [],
        skippedLessonDays: [],
        status: "active",
        updatedAt: Date.now(),
      });
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"]);
      const res = await rescheduleActive(user, false);
      return {
        status: "restarted",
        program: program.title,
        firstLessonArrives: res?.when ?? null,
      };
    },

    async skipTodaysLesson() {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      const program = enrollment && getProgram(enrollment.programId);
      if (!enrollment || !program) return { error: "no-active-program" };
      const skipped = enrollment.currentDay;
      await saveEnrollment(adminDb, {
        ...enrollment,
        skippedLessonDays: [...enrollment.skippedLessonDays, skipped],
        currentDay: Math.min(skipped + 1, program.durationDays),
        updatedAt: Date.now(),
      });
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"]);
      const res = await rescheduleActive(user, false);
      return {
        status: "skipped",
        skippedDay: skipped,
        nextLessonDay: res?.day ?? null,
        arrives: res?.when ?? null,
      };
    },

    async optOut() {
      await savePreferences(adminDb, userId, {
        consentStatus: "revoked",
        enabled: false,
        optOutTimestamp: Date.now(),
      });
      const canceled = await cancelPendingDeliveries(engineDeps, userId);
      log.info(`agent opt-out for ${userId}: canceled ${canceled} pending deliveries`);
      return {
        status: "opted-out",
        note: "All scheduled messages stopped; progress saved. Texting START opts back in — mention that once.",
      };
    },

    async getLessonContent() {
      const lesson = await lastDeliveredLesson(userId);
      if (!lesson) return { error: "no-lesson-delivered-yet" };
      const l = lesson.lesson;
      return {
        programId: lesson.programId,
        day: l.dayNumber,
        title: l.title,
        standardMessage: l.standardMessage,
        deeperMessage: l.deeperMessage ?? null,
        childMessage: l.childMessage ?? null,
        sourceNote: l.sourceNote ?? null,
        practicalAction: l.practicalAction ?? null,
        reflectionQuestion: l.reflectionQuestion ?? null,
      };
    },
  };
}

const repromptTimers = new Map<string, NodeJS.Timeout>();

/** After RAG answers a mid-onboarding question, gently resume the flow. */
function queueReprompt(userId: string, chatGuid: string, state: OnboardingState): void {
  const existing = repromptTimers.get(userId);
  if (existing) clearTimeout(existing);
  repromptTimers.set(
    userId,
    setTimeout(() => {
      repromptTimers.delete(userId);
      const prompt = currentPrompt(state, obCtx());
      if (prompt) void reply(chatGuid, [`Back to getting you set up:\n\n${prompt}`]);
    }, 20_000)
  );
}

async function applyOnboardingStep(
  user: CompanionUserDoc,
  chatGuid: string,
  nextState: OnboardingState,
  patch: Record<string, unknown>,
  replies: string[]
): Promise<void> {
  const userRef = imessageUsersCol().doc(user.handleId);
  const docPatch: Record<string, unknown> = { onboardingV2State: nextState, updatedAt: Date.now() };
  if (patch.displayName) docPatch.displayName = patch.displayName;
  for (const k of ["primaryGoal", "experienceLevel", "traditionPreference", "preferredLanguage"]) {
    if (patch[k] !== undefined) docPatch[k] = patch[k];
  }
  await userRef.set(docPatch, { merge: true });

  if (patch.consentGranted === false) {
    await savePreferences(adminDb, user.handleId, {
      consentStatus: "revoked",
      enabled: false,
      optOutTimestamp: Date.now(),
    });
    await cancelPendingDeliveries(engineDeps, user.handleId);
  } else if (patch.consentGranted === true) {
    await savePreferences(adminDb, user.handleId, {
      consentStatus: "granted",
      consentTimestamp: Date.now(),
      consentSource: "imessage",
      enabled: true,
      dailyDharmaEnabled: false,
      programMessagesEnabled: true,
      festivalMessagesEnabled: true,
      weeklyRecapEnabled: true,
      inactivityCheckInsEnabled: true,
      timezone: DEFAULT_TZ,
      preferredLocalTime: "07:30",
      createdAt: Date.now(),
    });
  }
  if (patch.preferredLocalTime) {
    await savePreferences(adminDb, user.handleId, {
      preferredLocalTime: patch.preferredLocalTime as string,
    });
  }
  if (patch.timezone) {
    await savePreferences(adminDb, user.handleId, { timezone: patch.timezone as string });
  }

  await reply(chatGuid, replies);

  if (nextState === "completed") {
    await finishOnboarding(user, chatGuid, {
      selectedProgram:
        (patch.selectedProgram as string | undefined) ??
        ((await userRef.get()).data()?.selectedProgram as string | undefined) ??
        "hinduism-101",
      startImmediately: patch.startImmediately === true,
    });
  } else if (patch.selectedProgram) {
    await userRef.set({ selectedProgram: patch.selectedProgram }, { merge: true });
  }
}

async function finishOnboarding(
  user: CompanionUserDoc,
  chatGuid: string,
  opts: { selectedProgram: string; startImmediately: boolean }
): Promise<void> {
  const prefs = await getPreferences(adminDb, user.handleId);
  if (!prefs) return;

  if (opts.selectedProgram === "daily-dharma") {
    await savePreferences(adminDb, user.handleId, { dailyDharmaEnabled: true });
    await scheduleNextDailyDharma(user.handleId);
    await reply(chatGuid, [
      `You're set: one Daily Dharma teaching at ${formatPrefTime(prefs)} each day. ` +
        `Reply PAUSE, STOP, or CHANGE TIME anytime, and ask me questions whenever you like.`,
    ]);
    return;
  }

  const program = getProgram(opts.selectedProgram);
  if (!program) {
    await reply(chatGuid, ["I couldn't find that program — reply PROGRAMS to see the list."]);
    return;
  }
  const enrollment = newEnrollment({
    userId: user.handleId,
    program,
    nowMs: Date.now(),
    source: "onboarding",
  });
  await saveEnrollment(adminDb, enrollment);
  await scheduleCurrentLesson(engineDeps, {
    enrollment,
    program,
    prefs,
    recipientHandle: user.handle,
    recipientChatGuid: chatGuid,
    providerName: "bluebubbles",
    immediate: opts.startImmediately,
  });
  const when = opts.startImmediately
    ? "Day 1 is on its way now"
    : `Day 1 arrives tomorrow at ${formatPrefTime(prefs)}`;
  await reply(chatGuid, [
    `You're enrolled in ${program.title}. ${when}. Reply PAUSE, STOP, or CHANGE TIME anytime — and you can ask me any question between lessons.`,
  ]);
}

function formatPrefTime(prefs: DeliveryPreferences): string {
  const [h, m] = prefs.preferredLocalTime.split(":").map(Number);
  const dt = DateTime.fromObject({ hour: h, minute: m }, { zone: prefs.timezone });
  return `${dt.toFormat("h:mm a")} (${prefs.timezone})`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function handleCommand(
  user: CompanionUserDoc,
  chatGuid: string,
  cmd: Command
): Promise<void> {
  const userId = user.handleId;
  const prefs = await getPreferences(adminDb, userId);

  switch (cmd.kind) {
    case "stop": {
      await savePreferences(adminDb, userId, {
        consentStatus: "revoked",
        enabled: false,
        optOutTimestamp: Date.now(),
      });
      const canceled = await cancelPendingDeliveries(engineDeps, userId);
      log.info(`STOP from ${userId}: canceled ${canceled} pending deliveries`);
      await reply(chatGuid, [
        "You're opted out — no more scheduled messages. Your progress is saved. Reply START anytime to opt back in.",
      ]);
      return;
    }

    case "start": {
      if (!prefs || prefs.consentStatus !== "granted") {
        await savePreferences(adminDb, userId, {
          consentStatus: "granted",
          consentTimestamp: Date.now(),
          consentSource: "imessage",
          enabled: true,
          pausedUntil: null,
        });
      }
      const enrollment = await getActiveEnrollment(adminDb, userId);
      if (enrollment) {
        await rescheduleActive(user, cmd.immediate);
        await reply(chatGuid, [
          `Welcome back — continuing ${enrollment.programId} from day ${enrollment.currentDay}.`,
        ]);
      } else if (prefs?.dailyDharmaEnabled) {
        await savePreferences(adminDb, userId, { enabled: true, pausedUntil: null });
        await scheduleNextDailyDharma(userId);
        await reply(chatGuid, ["Welcome back — Daily Dharma resumes at your usual time."]);
      } else {
        await beginOnboardingV2(user, chatGuid);
      }
      return;
    }

    case "pause": {
      const until = cmd.days ? Date.now() + cmd.days * 86_400_000 : PAUSED_INDEFINITELY;
      await savePreferences(adminDb, userId, {
        pausedUntil: until,
        pauseReason: cmd.days ? `pause-${cmd.days}d` : "pause-indefinite",
      });
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson", "daily-dharma"]);
      const untilText = cmd.days
        ? `for ${cmd.days} day${cmd.days === 1 ? "" : "s"}`
        : "until you say RESUME";
      await reply(chatGuid, [
        `Paused ${untilText}. Your progress is saved and nothing will be sent. Reply RESUME to pick up where you left off.`,
      ]);
      return;
    }

    case "resume": {
      await savePreferences(adminDb, userId, { pausedUntil: null, pauseReason: "" });
      const resumed = await rescheduleActive(user, false);
      if (resumed) {
        await reply(chatGuid, [
          `Resumed — your next lesson (day ${resumed.day}) arrives at ${resumed.when}. We continue from where you paused; no missed-lesson pile-up.`,
        ]);
      } else if (prefs?.dailyDharmaEnabled) {
        await scheduleNextDailyDharma(userId);
        await reply(chatGuid, ["Resumed — Daily Dharma returns at your usual time."]);
      } else {
        await reply(chatGuid, ["Nothing to resume yet. Reply START to begin, or PROGRAMS to browse."]);
      }
      return;
    }

    case "help": {
      await reply(chatGuid, [
        `${PRODUCT_NAME} — commands:\n` +
          `PAUSE / PAUSE 7 DAYS, RESUME, STOP, START\n` +
          `TIME, CHANGE TIME — delivery schedule\n` +
          `PROGRAMS, MY PROGRAM, SKIP, RESTART\n` +
          `DEEPER, KIDS, SOURCE — more on today's lesson\n` +
          `SAVE — save today's teaching. SETTINGS — your setup.\n` +
          `Or just ask any question about Hindu practice, scripture, or festivals.`,
      ]);
      return;
    }

    case "time": {
      if (!prefs) {
        await reply(chatGuid, ["No delivery schedule yet — reply START to set one up."]);
        return;
      }
      const pending = await deliveryStore.findPendingByUser(userId);
      const nextUp = pending
        .filter((d) => ["queued", "retry"].includes(d.status))
        .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
      const nextText = nextUp
        ? `Next message: ${DateTime.fromMillis(nextUp.scheduledAt, { zone: prefs.timezone }).toFormat("cccc, LLL d 'at' h:mm a ZZZZ")}.`
        : "Nothing currently scheduled.";
      await reply(chatGuid, [
        `Your delivery time is ${formatPrefTime(prefs)}. ${nextText} Reply CHANGE TIME to change it.`,
      ]);
      return;
    }

    case "change-time": {
      if (cmd.needsMeridiem) {
        await imessageUsersCol().doc(userId).set({ pendingTimeChange: true }, { merge: true });
        await reply(chatGuid, [
          "Please include AM or PM for that delivery time, like “6:25 PM”.",
        ]);
        return;
      }
      if (cmd.time) {
        await changeDeliveryTime(user, chatGuid, cmd.time);
        return;
      }
      await imessageUsersCol().doc(userId).set({ pendingTimeChange: true }, { merge: true });
      await reply(chatGuid, [
        "What time should your messages arrive? You can say “7:30 AM” or “after dinner”.",
      ]);
      return;
    }

    case "programs": {
      const list = [...programs().values()]
        .map((p) => `• ${p.title} — ${p.durationDays} days`)
        .join("\n");
      await reply(chatGuid, [
        `Here's what I can send you, one text a day:\n${list}\n` +
          `• Daily Dharma — one standalone teaching each day\n` +
          `Just tell me which one you'd like and I'll set it up.`,
      ]);
      return;
    }

    case "my-program": {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      if (!enrollment) {
        await reply(chatGuid, ["You're not in a program right now. Reply PROGRAMS to browse."]);
        return;
      }
      const program = getProgram(enrollment.programId);
      await reply(chatGuid, [
        `${program?.title ?? enrollment.programId}: day ${enrollment.currentDay} of ${program?.durationDays ?? "?"} — ${enrollment.completedLessonDays.length} lessons delivered.`,
      ]);
      return;
    }

    case "skip": {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      const program = enrollment && getProgram(enrollment.programId);
      if (!enrollment || !program) {
        await reply(chatGuid, ["Nothing to skip — you're not in a program."]);
        return;
      }
      const skipped = enrollment.currentDay;
      const updated = {
        ...enrollment,
        skippedLessonDays: [...enrollment.skippedLessonDays, skipped],
        currentDay: Math.min(skipped + 1, program.durationDays),
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, updated);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"]);
      const res = await rescheduleActive(user, false);
      await reply(chatGuid, [
        `Skipped day ${skipped}. ${res ? `Day ${res.day} arrives ${res.when}.` : ""}`,
      ]);
      return;
    }

    case "restart": {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      const program = enrollment && getProgram(enrollment.programId);
      if (!enrollment || !program) {
        await reply(chatGuid, ["Nothing to restart. Reply PROGRAMS to pick a program."]);
        return;
      }
      const fresh = {
        ...enrollment,
        currentDay: 1,
        completedLessonDays: [],
        skippedLessonDays: [],
        status: "active" as const,
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, fresh);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"]);
      const res = await rescheduleActive(user, false);
      await reply(chatGuid, [
        `Restarting ${program.title} from Day 1${res ? ` — arriving ${res.when}` : ""}.`,
      ]);
      return;
    }

    case "deeper":
    case "kids":
    case "source":
    case "story":
    case "practice": {
      const lesson = await lastDeliveredLesson(userId);
      if (!lesson) {
        await reply(chatGuid, [
          "No recent lesson to expand on — but ask me anything and I'll answer with sources.",
        ]);
        return;
      }
      const body =
        cmd.kind === "deeper" || cmd.kind === "story"
          ? lesson.lesson.deeperMessage
          : cmd.kind === "kids"
            ? lesson.lesson.childMessage
            : cmd.kind === "source"
              ? lesson.lesson.sourceNote
              : lesson.lesson.practicalAction;
      await reply(chatGuid, [
        body ??
          `I don't have a ${cmd.kind.toUpperCase()} version for “${lesson.lesson.title}” yet — try DEEPER or SOURCE.`,
      ]);
      return;
    }

    case "save": {
      const lesson = await lastDeliveredLesson(userId);
      if (!lesson) {
        await reply(chatGuid, ["No recent lesson to save."]);
        return;
      }
      const saved = user.savedTeachings ?? [];
      if (!saved.some((s) => s.programId === lesson.programId && s.day === lesson.lesson.dayNumber)) {
        saved.push({
          programId: lesson.programId,
          day: lesson.lesson.dayNumber,
          title: lesson.lesson.title,
        });
        await imessageUsersCol().doc(userId).set({ savedTeachings: saved }, { merge: true });
      }
      await reply(chatGuid, [`Saved “${lesson.lesson.title}”. Reply SETTINGS to see your saved list.`]);
      return;
    }

    case "unsave": {
      const lesson = await lastDeliveredLesson(userId);
      const saved = (user.savedTeachings ?? []).filter(
        (s) => !(lesson && s.programId === lesson.programId && s.day === lesson.lesson.dayNumber)
      );
      await imessageUsersCol().doc(userId).set({ savedTeachings: saved }, { merge: true });
      await reply(chatGuid, ["Removed from your saved teachings."]);
      return;
    }

    case "settings": {
      const enrollment = await getActiveEnrollment(adminDb, userId);
      const savedCount = user.savedTeachings?.length ?? 0;
      await reply(chatGuid, [
        `Your setup:\n` +
          `• Delivery: ${prefs ? formatPrefTime(prefs) : "not set"}${prefs?.pausedUntil && prefs.pausedUntil > Date.now() ? " (paused)" : ""}\n` +
          `• Program: ${enrollment ? `${enrollment.programId}, day ${enrollment.currentDay}` : "none"}\n` +
          `• Daily Dharma: ${prefs?.dailyDharmaEnabled ? "on" : "off"}\n` +
          `• Saved teachings: ${savedCount}\n` +
          `Commands: CHANGE TIME, PAUSE, RESUME, STOP, PROGRAMS, DELETE MY DATA.`,
      ]);
      return;
    }

    case "delete-my-data": {
      await savePreferences(adminDb, userId, { consentStatus: "revoked", enabled: false });
      await cancelPendingDeliveries(engineDeps, userId);
      await imessageUsersCol()
        .doc(userId)
        .set({ accountStatus: "deletion-requested", updatedAt: Date.now() }, { merge: true });
      log.warn(`DELETE MY DATA requested by ${userId} — operator action required`);
      await reply(chatGuid, [
        "Understood. All scheduled messages are stopped and your account is marked for deletion — your conversation history and profile will be removed within 30 days. Reply START before then if you change your mind.",
      ]);
      return;
    }

    case "simple": {
      await reply(chatGuid, [
        "Got it — I'll keep answers short and plain. (Reply DEEPER on any lesson when you want more.)",
      ]);
      await imessageUsersCol().doc(userId).set({ explanationDepth: "concise" }, { merge: true });
      return;
    }

    case "now":
    case "tomorrow":
      // Only meaningful during onboarding; outside it, treat as chatter.
      await reply(chatGuid, ["Reply HELP to see what I can do, or just ask a question."]);
      return;
  }
}

async function rescheduleActive(
  user: CompanionUserDoc,
  immediate: boolean
): Promise<{ day: number; when: string; deliveryId: string } | null> {
  const enrollment = await getActiveEnrollment(adminDb, user.handleId);
  if (!enrollment) return null;
  const program = getProgram(enrollment.programId);
  const prefs = await getPreferences(adminDb, user.handleId);
  if (!program || !prefs) return null;
  const res = await scheduleCurrentLesson(engineDeps, {
    enrollment,
    program,
    prefs,
    recipientHandle: user.handle,
    recipientChatGuid: user.chatGuid,
    providerName: "bluebubbles",
    immediate,
  });
  if (!("scheduledAt" in res)) return null;
  return {
    day: enrollment.currentDay,
    deliveryId: res.deliveryId,
    when: DateTime.fromMillis(res.scheduledAt, { zone: prefs.timezone }).toFormat(
      "cccc 'at' h:mm a"
    ),
  };
}

interface DeliveryTimeChangeResult {
  status: "changed" | "changed-but-unverified";
  newTime: string;
  nextLessonArrives?: string | null;
  note?: string;
}

/** Core time change shared by the keyword flow and the agent tool. */
async function applyDeliveryTimeChange(
  user: CompanionUserDoc,
  time: string
): Promise<DeliveryTimeChangeResult> {
  await savePreferences(adminDb, user.handleId, {
    preferredLocalTime: time,
    lastPreferenceChangeAt: Date.now(),
  });
  const activeEnrollment = await getActiveEnrollment(adminDb, user.handleId);
  // Cancel unsent recurring deliveries, keep history, recalculate.
  const canceled = await cancelPendingDeliveries(engineDeps, user.handleId, [
    "program-lesson",
    "daily-dharma",
  ]);
  const res = await rescheduleActive(user, false);
  const prefs = await getPreferences(adminDb, user.handleId);
  if (prefs?.dailyDharmaEnabled) await scheduleNextDailyDharma(user.handleId);
  log.info("delivery time changed", {
    userId: user.handleId,
    preferredLocalTime: time,
    canceledPending: canceled,
    nextLesson: res,
    dailyDharmaEnabled: prefs?.dailyDharmaEnabled ?? false,
  });
  const newTime = prefs ? formatPrefTime(prefs) : time;
  if (activeEnrollment && !res) {
    log.error("delivery time change could not verify queued lesson", {
      userId: user.handleId,
      preferredLocalTime: time,
      canceledPending: canceled,
    });
    return {
      status: "changed-but-unverified",
      newTime,
      note: "The preferred time was saved but the next lesson could not be confirmed in the delivery queue. Do not present it as confirmed; say you're double-checking and they can ask again in a minute.",
    };
  }
  return { status: "changed", newTime, nextLessonArrives: res?.when ?? null };
}

async function changeDeliveryTime(
  user: CompanionUserDoc,
  chatGuid: string,
  time: string
): Promise<void> {
  const result = await applyDeliveryTimeChange(user, time);
  if (result.status === "changed-but-unverified") {
    await reply(chatGuid, [
      "I updated your preferred time, but I could not verify the next lesson in the delivery queue. I’m not marking this confirmed. Please try CHANGE TIME again in a minute.",
    ]);
    return;
  }
  await reply(chatGuid, [
    `Done — your messages now arrive at ${result.newTime}.` +
      (result.nextLessonArrives ? ` Next lesson: ${result.nextLessonArrives}.` : ""),
  ]);
}

async function lastDeliveredLesson(
  userId: string
): Promise<{ programId: string; lesson: NonNullable<ReturnType<typeof lessonForDay>> } | null> {
  const enrollment =
    (await getActiveEnrollment(adminDb, userId)) ??
    // Completed programs still support DEEPER/KIDS on the final lesson.
    null;
  if (!enrollment) return null;
  const program = getProgram(enrollment.programId);
  if (!program) return null;
  const lastDay =
    enrollment.completedLessonDays.length > 0
      ? enrollment.completedLessonDays[enrollment.completedLessonDays.length - 1]
      : null;
  if (!lastDay) return null;
  const lesson = lessonForDay(program, lastDay);
  return lesson ? { programId: program.slug, lesson } : null;
}
