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
import { appendAssistantMessage, appendTurn, loadRecentMessages } from "./history.ts";
import {
  currentPrompt,
  stepOnboarding,
  welcomeMessage,
  type OnboardingContext,
  type OnboardingState,
} from "../../lib/onboarding/machine.ts";
import {
  getActiveEnrollments,
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
import type {
  DeliveryPreferences,
  Enrollment,
  ScheduledDelivery,
} from "../../lib/types/companion.ts";
import { PAUSED_INDEFINITELY } from "../../lib/types/companion.ts";
import {
  MEMBERSHIP_PRICE_TEXT,
  billingOf,
  cancelMembership,
  isFreeTestingUser,
  resumeMembership,
  signupLinkFor,
  userHasMessagingAccess,
} from "./billing.ts";
import { hasFullAccess, hasMessagingAccess } from "../../lib/billing/membership.ts";
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
  hasAccess: (userId) => userHasMessagingAccess(userId),
  renderMessage: async (d) => renderQueuedMessage(d),
  onSent: async (d, result) => {
    // Scheduled sends must land in conversation history too — otherwise the
    // agent and the guru have no idea a lesson was ever delivered, and a
    // follow-up like "deeper" or "who is Shiva?" loses its referent.
    try {
      const body = d.renderedMessage ?? (await renderQueuedMessage(d));
      if (body) await appendAssistantMessage(d.userId, body);
    } catch (err) {
      log.error("failed to append delivered message to history:", err);
    }
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
    // No membership (trial never started, or it ended): the pipeline stops —
    // resubscribing restarts it — but the user deserves to know why the texts
    // went quiet, exactly once.
    if (code === "no-membership") {
      await sendMembershipLapseNote(d);
      return;
    }
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
      // Daily Dharma can run at its own hour, apart from program lessons.
      preferredLocalTime: prefs.dailyDharmaLocalTime ?? prefs.preferredLocalTime,
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
// Membership lapse note
// ---------------------------------------------------------------------------

/**
 * One-time note when a scheduled teaching is withheld because there's no
 * active membership (trial never started, or it ended). Sent through the
 * queue as "transactional" so it isn't itself membership-gated, and guarded
 * by a user-doc flag so a lapsed member gets exactly one nudge — not one per
 * suppressed lesson. The Stripe webhook re-arms the flag when a membership
 * becomes active again.
 */
async function sendMembershipLapseNote(d: ScheduledDelivery): Promise<void> {
  const link = signupLinkFor(d.userId);
  if (!link) return; // no payment link configured — nothing useful to say
  const ref = imessageUsersCol().doc(d.userId);
  const snap = await ref.get();
  const user = (snap.data() ?? {}) as {
    membershipEndNoticeSent?: boolean;
    billing?: unknown;
    freeTestingUser?: boolean;
  };
  // A comped tester should never be suppressed for membership, but if the
  // flag was flipped between claim and suppression, stay silent.
  if (user.freeTestingUser === true) return;
  if (user.membershipEndNoticeSent) return;
  await ref.set({ membershipEndNoticeSent: true, updatedAt: Date.now() }, { merge: true });
  const billing = billingOf(user);
  const body =
    !billing || billing.status === "none"
      ? `Daily teachings are part of the ${PRODUCT_NAME} membership — ${MEMBERSHIP_PRICE_TEXT}. ` +
        `Your lessons are ready whenever you are; start your free week here: ${link}`
      : `Your ${PRODUCT_NAME} membership has ended, so daily teachings are paused — your progress ` +
        `is saved. Restart anytime: ${link}`;
  await enqueueDelivery(engineDeps, {
    userId: d.userId,
    recipientHandle: d.recipientHandle,
    recipientChatGuid: d.recipientChatGuid,
    provider: d.provider,
    deliveryType: "transactional",
    scheduledAt: Date.now(),
    scheduledLocalDate: localDateOf(Date.now(), d.timezone),
    timezone: d.timezone,
    variant: "membership-lapse",
    renderedMessage: body,
  });
}

/**
 * One-line signup reminder for confirmations that promise future deliveries
 * (START, RESUME, enrollments): without an active membership those sends
 * would be quietly suppressed at dispatch time, so the promise must carry
 * the fix. Fresh doc read, so a just-finished checkout or a flipped
 * freeTestingUser flag is honored. Null when access is fine or when no
 * payment link is configured.
 */
async function membershipNudgeLine(userId: string): Promise<string | null> {
  if (await userHasMessagingAccess(userId)) return null;
  const link = signupLinkFor(userId);
  if (!link) return null;
  return (
    `Quick heads up: your teachings won't be delivered until your membership is active — ` +
    `${MEMBERSHIP_PRICE_TEXT}. Start here (Apple Pay works): ${link}`
  );
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
  /** Synced mirror of the Stripe subscription (lib/billing/membership.ts). */
  billing?: unknown;
  /** Operator comp flag — full access without paying. Default false. */
  freeTestingUser?: boolean;
  membershipEndNoticeSent?: boolean;
  [key: string]: unknown;
}

function obCtx(user?: CompanionUserDoc): OnboardingContext {
  // Comped testers never see pricing or a signup link.
  const wantsPricing = user && !isFreeTestingUser(user);
  return {
    productName: PRODUCT_NAME,
    defaultTimezone: DEFAULT_TZ,
    ...(wantsPricing ? { signupUrl: signupLinkFor(user.handleId) } : {}),
  };
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
    const signupUrl = isFreeTestingUser(user) ? null : signupLinkFor(user.handleId);
    await reply(chatGuid, [
      `Namaste, and welcome! 🙏 I'm your Hindu Guru — a daily learning companion grounded in scripture. ` +
        `I'm trained on the Bhagavad Gita, the Upanishads, the Ramayana and Mahabharata, the Puranas, ` +
        `devotional poetry, and classical Ayurveda texts — and I cite my sources when I answer.\n\n` +
        `You can text me any question, anytime: about a verse, a ritual, a festival, or something ` +
        `you've wondered about for years. I can also send one short teaching each day at a time you ` +
        `choose. Reply STOP anytime to opt out.`,
      ...(signupUrl
        ? [
            `${PRODUCT_NAME} is $5 a month with a 1-week free trial, and you can cancel anytime just ` +
              `by texting me. When you're ready, start your free week here (Apple Pay works): ${signupUrl}`,
          ]
        : []),
      "First — what should I call you?",
    ]);
    return;
  }
  await imessageUsersCol().doc(user.handleId).set(
    { onboardingV2State: "awaiting-consent", chatGuid, updatedAt: Date.now() },
    { merge: true }
  );
  await reply(chatGuid, [welcomeMessage(obCtx(user))]);
}

export interface CompanionInboundResult {
  handled: boolean;
  /**
   * The standalone question the RAG guru should answer instead of the raw
   * inbound text. Set when the agent replied to the account part of a mixed
   * message and extracted the rest, or when it reworded a contextual
   * follow-up ("deeper") into a question that stands alone.
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
    const result = stepOnboarding(obState, text, obCtx(user));
    if (result.deflected) {
      // Real question mid-onboarding: let RAG answer, then re-prompt.
      await userRef.set({ onboardingV2State: result.nextState }, { merge: true });
      queueReprompt(user, chatGuid, result.nextState);
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

  // Exact keyword commands (STOP, DELETE MY DATA, PAUSE, …) stay
  // deterministic: compliance keywords must never depend on a model. Content
  // continuations ("deeper", "kids", "source", …) are deliberately NOT
  // commands — they're ambiguous between the last lesson and the last answer,
  // so the conversational layer below resolves them from chat history.
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
    if (result.kind === "pass-to-guru") {
      return { handled: false, guruQuestion: result.question };
    }
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
  const enrollments = await getActiveEnrollments(adminDb, user.handleId);
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

  const billing = billingOf(user);
  const now = Date.now();
  let membershipState: CompanionAgentSnapshot["membership"]["state"];
  if (isFreeTestingUser(user)) membershipState = "complimentary";
  else if (!billing || billing.status === "none") membershipState = "none";
  else if (billing.status === "past_due") membershipState = "past-due";
  else if (billing.status === "canceled" || billing.cancelAtPeriodEnd)
    membershipState = hasMessagingAccess(billing, now) ? "canceling" : "ended";
  else membershipState = billing.status === "trialing" ? "trial" : "active";
  const accessUntilText = billing?.accessUntil
    ? DateTime.fromMillis(billing.accessUntil, { zone: tz }).toFormat("cccc, LLL d")
    : undefined;

  const pausedUntil = prefs?.pausedUntil ?? null;
  const paused = pausedUntil !== null && pausedUntil > Date.now();
  return {
    membership: {
      state: membershipState,
      priceText: MEMBERSHIP_PRICE_TEXT,
      ...(membershipState === "canceling" || membershipState === "ended"
        ? { accessUntilText }
        : {}),
      ...(membershipState === "trial" || membershipState === "active"
        ? { renewsText: accessUntilText }
        : {}),
      // The signup link is only surfaced when a fresh checkout is the right
      // fix — handing it to an active member invites a duplicate subscription.
      ...(membershipState === "none" || membershipState === "ended"
        ? { signupUrl: signupLinkFor(user.handleId) ?? undefined }
        : {}),
    },
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
    dailyDharmaTimeText: prefs?.dailyDharmaLocalTime
      ? formatLocalTime(prefs.dailyDharmaLocalTime, tz)
      : undefined,
    programs: enrollments.flatMap((enrollment) => {
      const program = getProgram(enrollment.programId);
      if (!program) return [];
      return [
        {
          slug: program.slug,
          title: program.title,
          day: enrollment.currentDay,
          durationDays: program.durationDays,
          lessonsDelivered: enrollment.completedLessonDays.length,
          deliveryTimeText: enrollment.preferredLocalTime
            ? formatLocalTime(enrollment.preferredLocalTime, tz)
            : undefined,
        },
      ];
    }),
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

/**
 * Parse a user-worded time ("9am", "after dinner") into "HH:mm", or return a
 * model-facing error object explaining what to ask for.
 */
function parseTimeArg(timeText: string): { time: string } | { error: string; note: string } {
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
  return { time: parsed.time };
}

function agentExecutor(user: CompanionUserDoc): CompanionToolExecutor {
  const userId = user.handleId;

  /**
   * Tools that promise scheduled sends get a membershipWarning attached when
   * the dispatcher would actually suppress those sends — the model then tells
   * the user and shares the signup link instead of confirming a delivery that
   * will never arrive. Error results pass through untouched.
   */
  const withMembershipWarning = async (result: unknown): Promise<unknown> => {
    if (!result || typeof result !== "object") return result;
    if ("error" in (result as Record<string, unknown>)) return result;
    if (await userHasMessagingAccess(userId)) return result;
    const link = signupLinkFor(userId);
    if (!link) return result;
    return {
      ...(result as Record<string, unknown>),
      membershipWarning:
        `IMPORTANT: their membership is NOT active, so these scheduled texts will not actually ` +
        `be delivered until they start it (${MEMBERSHIP_PRICE_TEXT}). Say that plainly and ` +
        `share their signup link: ${link}`,
    };
  };

  /** Pick the enrollment a program-scoped tool call refers to. */
  const resolveEnrollment = async (
    programSlug?: string
  ): Promise<{ enrollment: Enrollment } | { error: string; note?: string; programs?: string[] }> => {
    const actives = await getActiveEnrollments(adminDb, userId);
    if (actives.length === 0) return { error: "no-active-program" };
    if (programSlug) {
      const match = actives.find((e) => e.programId === programSlug);
      return match
        ? { enrollment: match }
        : {
            error: "not-enrolled-in-that-program",
            programs: actives.map((e) => e.programId),
          };
    }
    if (actives.length === 1) return { enrollment: actives[0] };
    return {
      error: "multiple-programs",
      programs: actives.map((e) => e.programId),
      note: "They're in several programs — ask which one they mean, then call again with program_slug.",
    };
  };

  const base: CompanionToolExecutor = {
    async enrollInProgram({ programSlug, time }) {
      const prefs = await getPreferences(adminDb, userId);
      if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;
      const program = getProgram(programSlug);
      if (!program) return { error: "unknown-program" };

      let localTime: string | undefined;
      if (time) {
        const parsed = parseTimeArg(time);
        if ("error" in parsed) return parsed;
        localTime = parsed.time;
      }

      const actives = await getActiveEnrollments(adminDb, userId);
      const existing = actives.find((e) => e.programId === program.slug);
      if (existing) {
        if (localTime && existing.preferredLocalTime !== localTime) {
          return applyDeliveryTimeChange(user, localTime, program.slug);
        }
        return {
          status: "already-enrolled",
          program: program.title,
          day: existing.currentDay,
          durationDays: program.durationDays,
          note: "They are already in this program. Offer to restart it if they want to begin again.",
        };
      }

      const enrollment = newEnrollment({
        userId,
        program,
        nowMs: Date.now(),
        source: "conversation",
        preferredLocalTime: localTime,
      });
      await saveEnrollment(adminDb, enrollment);
      const res = await rescheduleEnrollment(user, enrollment, false);
      const alongside = actives.map((e) => getProgram(e.programId)?.title ?? e.programId);
      if (!res) {
        return {
          status: "enrolled-but-unverified",
          program: program.title,
          note: "Enrollment saved, but the first lesson could not be confirmed in the delivery queue. Say you're double-checking on your end and it may take a minute.",
        };
      }
      return {
        status: "enrolled",
        program: program.title,
        durationDays: program.durationDays,
        deliveryTime: localTime ? formatLocalTime(localTime, prefs.timezone) : formatPrefTime(prefs),
        firstLessonDay: res.day,
        firstLessonArrives: res.when,
        runningAlongside: alongside.length > 0 ? alongside : undefined,
      };
    },

    async leaveProgram({ programSlug }) {
      const actives = await getActiveEnrollments(adminDb, userId);
      const enrollment = actives.find((e) => e.programId === programSlug);
      if (!enrollment) {
        return {
          error: "not-enrolled-in-that-program",
          programs: actives.map((e) => e.programId),
        };
      }
      await saveEnrollment(adminDb, { ...enrollment, status: "canceled", updatedAt: Date.now() });
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
      const remaining = actives
        .filter((e) => e.id !== enrollment.id)
        .map((e) => getProgram(e.programId)?.title ?? e.programId);
      return {
        status: "left",
        program: getProgram(programSlug)?.title ?? programSlug,
        progressSaved: true,
        stillEnrolledIn: remaining,
      };
    },

    async enableDailyDharma({ time }) {
      const prefs = await getPreferences(adminDb, userId);
      if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;

      let localTime: string | undefined;
      if (time) {
        const parsed = parseTimeArg(time);
        if ("error" in parsed) return parsed;
        localTime = parsed.time;
      }

      if (prefs.dailyDharmaEnabled && !localTime) {
        return {
          status: "already-on",
          deliveryTime: formatLocalTime(prefs.dailyDharmaLocalTime ?? prefs.preferredLocalTime, prefs.timezone),
        };
      }
      await savePreferences(adminDb, userId, {
        dailyDharmaEnabled: true,
        ...(localTime ? { dailyDharmaLocalTime: localTime } : {}),
      });
      if (localTime) await cancelPendingDeliveries(engineDeps, userId, ["daily-dharma"]);
      await scheduleNextDailyDharma(userId);
      return {
        status: "enabled",
        deliveryTime: formatLocalTime(
          localTime ?? prefs.dailyDharmaLocalTime ?? prefs.preferredLocalTime,
          prefs.timezone
        ),
      };
    },

    async disableDailyDharma() {
      await savePreferences(adminDb, userId, { dailyDharmaEnabled: false });
      await cancelPendingDeliveries(engineDeps, userId, ["daily-dharma"]);
      return { status: "disabled" };
    },

    async changeDeliveryTime({ time, target }) {
      const parsed = parseTimeArg(time);
      if ("error" in parsed) return parsed;
      return applyDeliveryTimeChange(user, parsed.time, target || "all");
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
      const resumed = await rescheduleAllActive(user, false);
      if (resumed.length > 0) {
        return {
          status: "resumed",
          nextLessons: resumed.map((r) => ({ program: r.programTitle, day: r.day, arrives: r.when })),
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

    async restartProgram({ programSlug }) {
      const resolved = await resolveEnrollment(programSlug);
      if ("error" in resolved) return resolved;
      const enrollment = resolved.enrollment;
      const program = getProgram(enrollment.programId);
      if (!program) return { error: "no-active-program" };
      const fresh: Enrollment = {
        ...enrollment,
        currentDay: 1,
        completedLessonDays: [],
        skippedLessonDays: [],
        status: "active",
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, fresh);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
      const res = await rescheduleEnrollment(user, fresh, false);
      return {
        status: "restarted",
        program: program.title,
        firstLessonArrives: res?.when ?? null,
      };
    },

    async skipTodaysLesson({ programSlug }) {
      const resolved = await resolveEnrollment(programSlug);
      if ("error" in resolved) return resolved;
      const enrollment = resolved.enrollment;
      const program = getProgram(enrollment.programId);
      if (!program) return { error: "no-active-program" };
      const skipped = enrollment.currentDay;
      const advanced: Enrollment = {
        ...enrollment,
        skippedLessonDays: [...enrollment.skippedLessonDays, skipped],
        currentDay: Math.min(skipped + 1, program.durationDays),
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, advanced);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
      const res = await rescheduleEnrollment(user, advanced, false);
      return {
        status: "skipped",
        program: program.title,
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

    async cancelMembership() {
      const prefs = await getPreferences(adminDb, userId);
      return cancelMembership(userId, prefs?.timezone ?? DEFAULT_TZ);
    },

    async resumeMembership() {
      const prefs = await getPreferences(adminDb, userId);
      return resumeMembership(userId, prefs?.timezone ?? DEFAULT_TZ);
    },

    async getLessonContent({ programSlug }) {
      const lesson = await lastDeliveredLesson(userId, programSlug);
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

  const promisesDeliveries: (keyof CompanionToolExecutor)[] = [
    "enrollInProgram",
    "enableDailyDharma",
    "changeDeliveryTime",
    "resumeMessages",
    "restartProgram",
    "skipTodaysLesson",
  ];
  for (const key of promisesDeliveries) {
    const original = base[key] as (...args: unknown[]) => Promise<unknown>;
    (base as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[key] = (
      ...args: unknown[]
    ) => original(...args).then(withMembershipWarning);
  }
  return base;
}

const repromptTimers = new Map<string, NodeJS.Timeout>();

/** After RAG answers a mid-onboarding question, gently resume the flow. */
function queueReprompt(user: CompanionUserDoc, chatGuid: string, state: OnboardingState): void {
  const userId = user.handleId;
  const existing = repromptTimers.get(userId);
  if (existing) clearTimeout(existing);
  repromptTimers.set(
    userId,
    setTimeout(() => {
      repromptTimers.delete(userId);
      const prompt = currentPrompt(state, obCtx(user));
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

  // Fresh read — they may have finished Stripe checkout mid-onboarding.
  const latest = (await imessageUsersCol().doc(user.handleId).get()).data() ?? {};
  const signupUrl = signupLinkFor(user.handleId);
  const trialNudge =
    !hasFullAccess(latest, Date.now()) && signupUrl
      ? `One more thing: daily texts begin once your free week is active — ` +
        `${MEMBERSHIP_PRICE_TEXT}. Start here (Apple Pay works): ${signupUrl}`
      : null;

  if (opts.selectedProgram === "daily-dharma") {
    await savePreferences(adminDb, user.handleId, { dailyDharmaEnabled: true });
    await scheduleNextDailyDharma(user.handleId);
    await reply(chatGuid, [
      `You're set: one Daily Dharma teaching at ${formatPrefTime(prefs)} each day. ` +
        `Reply PAUSE, STOP, or CHANGE TIME anytime, and ask me questions whenever you like.`,
      ...(trialNudge ? [trialNudge] : []),
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
    ...(trialNudge ? [trialNudge] : []),
  ]);
}

function formatLocalTime(hhmm: string, timezone: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const dt = DateTime.fromObject({ hour: h, minute: m }, { zone: timezone });
  return `${dt.toFormat("h:mm a")} (${timezone})`;
}

function formatPrefTime(prefs: DeliveryPreferences): string {
  return formatLocalTime(prefs.preferredLocalTime, prefs.timezone);
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
      // Opting out of texts and canceling billing are different things — a
      // paying member who texts STOP must be told their membership is intact.
      const billing = billingOf(user);
      const stillBilling =
        billing !== null &&
        (billing.status === "trialing" || billing.status === "active") &&
        !billing.cancelAtPeriodEnd;
      await reply(chatGuid, [
        "You're opted out — no more scheduled messages. Your progress is saved. Reply START anytime to opt back in." +
          (stillBilling
            ? " Heads up: your $5/month membership is still active. If you'd like to cancel that too, text me “cancel my membership”."
            : ""),
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
      const rescheduled = await rescheduleAllActive(user, cmd.immediate);
      // A START without an active membership must not promise deliveries the
      // dispatcher will suppress — pair the welcome with the signup link.
      const nudge = await membershipNudgeLine(userId);
      if (rescheduled.length > 0) {
        const lines = rescheduled
          .map((r) => `${r.programTitle} from day ${r.day}`)
          .join(" and ");
        await reply(chatGuid, [
          `Welcome back — continuing ${lines}.${nudge ? `\n\n${nudge}` : ""}`,
        ]);
      } else if (prefs?.dailyDharmaEnabled) {
        await savePreferences(adminDb, userId, { enabled: true, pausedUntil: null });
        await scheduleNextDailyDharma(userId);
        await reply(chatGuid, [
          `Welcome back — Daily Dharma resumes at your usual time.${nudge ? `\n\n${nudge}` : ""}`,
        ]);
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
      const resumed = await rescheduleAllActive(user, false);
      if (prefs?.dailyDharmaEnabled) await scheduleNextDailyDharma(userId);
      const resumeNudge = await membershipNudgeLine(userId);
      if (resumed.length > 0) {
        const lines = resumed
          .map((r) => `${r.programTitle} day ${r.day} arrives ${r.when}`)
          .join("; ");
        await reply(chatGuid, [
          `Resumed — ${lines}. We continue from where you paused; no missed-lesson pile-up.` +
            (resumeNudge ? `\n\n${resumeNudge}` : ""),
        ]);
      } else if (prefs?.dailyDharmaEnabled) {
        await reply(chatGuid, [
          `Resumed — Daily Dharma returns at your usual time.${resumeNudge ? `\n\n${resumeNudge}` : ""}`,
        ]);
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
          `SAVE — save today's teaching. SETTINGS — your setup.\n` +
          `And just talk to me in your own words — ask any question, or ask for ` +
          `more on any teaching: the deeper meaning, a version for kids, the sources.`,
      ]);
      return;
    }

    case "time": {
      if (!prefs) {
        await reply(chatGuid, ["No delivery schedule yet — reply START to set one up."]);
        return;
      }
      const enrollments = await getActiveEnrollments(adminDb, userId);
      const streams: string[] = [];
      for (const e of enrollments) {
        const title = getProgram(e.programId)?.title ?? e.programId;
        streams.push(
          `${title} at ${e.preferredLocalTime ? formatLocalTime(e.preferredLocalTime, prefs.timezone) : formatPrefTime(prefs)}`
        );
      }
      if (prefs.dailyDharmaEnabled) {
        streams.push(
          `Daily Dharma at ${formatLocalTime(prefs.dailyDharmaLocalTime ?? prefs.preferredLocalTime, prefs.timezone)}`
        );
      }
      const scheduleText =
        streams.length > 0
          ? `Your deliveries: ${streams.join("; ")}.`
          : `Your delivery time is ${formatPrefTime(prefs)}.`;
      const pending = await deliveryStore.findPendingByUser(userId);
      const nextUp = pending
        .filter((d) => ["queued", "retry"].includes(d.status))
        .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
      const nextText = nextUp
        ? `Next message: ${DateTime.fromMillis(nextUp.scheduledAt, { zone: prefs.timezone }).toFormat("cccc, LLL d 'at' h:mm a ZZZZ")}.`
        : "Nothing currently scheduled.";
      await reply(chatGuid, [
        `${scheduleText} ${nextText} Just tell me if you'd like different times — each program can have its own.`,
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
      const enrollments = await getActiveEnrollments(adminDb, userId);
      if (enrollments.length === 0) {
        await reply(chatGuid, ["You're not in a program right now. Reply PROGRAMS to browse."]);
        return;
      }
      const lines = enrollments.map((e) => {
        const program = getProgram(e.programId);
        return `${program?.title ?? e.programId}: day ${e.currentDay} of ${program?.durationDays ?? "?"} — ${e.completedLessonDays.length} lessons delivered`;
      });
      await reply(chatGuid, [lines.join("\n")]);
      return;
    }

    case "skip": {
      const enrollments = await getActiveEnrollments(adminDb, userId);
      if (enrollments.length === 0) {
        await reply(chatGuid, ["Nothing to skip — you're not in a program."]);
        return;
      }
      if (enrollments.length > 1) {
        const titles = enrollments
          .map((e) => getProgram(e.programId)?.title ?? e.programId)
          .join(", ");
        await reply(chatGuid, [
          `You're in ${titles} — tell me which one you'd like to skip a day of.`,
        ]);
        return;
      }
      const enrollment = enrollments[0];
      const program = getProgram(enrollment.programId);
      if (!program) {
        await reply(chatGuid, ["Nothing to skip — you're not in a program."]);
        return;
      }
      const skipped = enrollment.currentDay;
      const updated: Enrollment = {
        ...enrollment,
        skippedLessonDays: [...enrollment.skippedLessonDays, skipped],
        currentDay: Math.min(skipped + 1, program.durationDays),
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, updated);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
      const res = await rescheduleEnrollment(user, updated, false);
      await reply(chatGuid, [
        `Skipped day ${skipped}. ${res ? `Day ${res.day} arrives ${res.when}.` : ""}`,
      ]);
      return;
    }

    case "restart": {
      const enrollments = await getActiveEnrollments(adminDb, userId);
      if (enrollments.length === 0) {
        await reply(chatGuid, ["Nothing to restart. Reply PROGRAMS to pick a program."]);
        return;
      }
      if (enrollments.length > 1) {
        const titles = enrollments
          .map((e) => getProgram(e.programId)?.title ?? e.programId)
          .join(", ");
        await reply(chatGuid, [
          `You're in ${titles} — tell me which one you'd like to restart.`,
        ]);
        return;
      }
      const enrollment = enrollments[0];
      const program = getProgram(enrollment.programId);
      if (!program) {
        await reply(chatGuid, ["Nothing to restart. Reply PROGRAMS to pick a program."]);
        return;
      }
      const fresh: Enrollment = {
        ...enrollment,
        currentDay: 1,
        completedLessonDays: [],
        skippedLessonDays: [],
        status: "active",
        updatedAt: Date.now(),
      };
      await saveEnrollment(adminDb, fresh);
      await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
      const res = await rescheduleEnrollment(user, fresh, false);
      await reply(chatGuid, [
        `Restarting ${program.title} from Day 1${res ? ` — arriving ${res.when}` : ""}.`,
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
      const enrollments = await getActiveEnrollments(adminDb, userId);
      const savedCount = user.savedTeachings?.length ?? 0;
      const programLines =
        enrollments.length > 0
          ? enrollments
              .map((e) => {
                const title = getProgram(e.programId)?.title ?? e.programId;
                const at =
                  e.preferredLocalTime && prefs
                    ? ` at ${formatLocalTime(e.preferredLocalTime, prefs.timezone)}`
                    : "";
                return `• Program: ${title}, day ${e.currentDay}${at}`;
              })
              .join("\n")
          : "• Program: none";
      const dharmaLine = prefs?.dailyDharmaEnabled
        ? `on${prefs.dailyDharmaLocalTime ? ` at ${formatLocalTime(prefs.dailyDharmaLocalTime, prefs.timezone)}` : ""}`
        : "off";
      await reply(chatGuid, [
        `Your setup:\n` +
          `• Default delivery: ${prefs ? formatPrefTime(prefs) : "not set"}${prefs?.pausedUntil && prefs.pausedUntil > Date.now() ? " (paused)" : ""}\n` +
          `${programLines}\n` +
          `• Daily Dharma: ${dharmaLine}\n` +
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

    case "now":
    case "tomorrow":
      // Only meaningful during onboarding; outside it, treat as chatter.
      await reply(chatGuid, ["Reply HELP to see what I can do, or just ask a question."]);
      return;
  }
}

interface RescheduledLesson {
  programId: string;
  programTitle: string;
  day: number;
  when: string;
  deliveryId: string;
}

async function rescheduleEnrollment(
  user: CompanionUserDoc,
  enrollment: Enrollment,
  immediate: boolean
): Promise<RescheduledLesson | null> {
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
    programId: program.slug,
    programTitle: program.title,
    day: enrollment.currentDay,
    deliveryId: res.deliveryId,
    when: DateTime.fromMillis(res.scheduledAt, { zone: prefs.timezone }).toFormat(
      "cccc 'at' h:mm a"
    ),
  };
}

/** Re-queue the next lesson of every active enrollment. */
async function rescheduleAllActive(
  user: CompanionUserDoc,
  immediate: boolean
): Promise<RescheduledLesson[]> {
  const enrollments = await getActiveEnrollments(adminDb, user.handleId);
  const results: RescheduledLesson[] = [];
  for (const enrollment of enrollments) {
    const res = await rescheduleEnrollment(user, enrollment, immediate);
    if (res) results.push(res);
  }
  return results;
}

type TimeChangeTarget = "all" | "daily-dharma" | string; // string = program slug

interface DeliveryTimeChangeResult {
  status?: "changed" | "changed-but-unverified";
  error?: string;
  target?: string;
  newTime?: string;
  nextLessons?: { program: string; arrives: string }[];
  note?: string;
}

/**
 * Core time change shared by the keyword flow and the agent tool. Each
 * program and Daily Dharma can run at its own hour: "all" moves everything to
 * one time (clearing per-stream overrides), a program slug or "daily-dharma"
 * moves just that stream.
 */
async function applyDeliveryTimeChange(
  user: CompanionUserDoc,
  time: string,
  target: TimeChangeTarget
): Promise<DeliveryTimeChangeResult> {
  const userId = user.handleId;
  const prefs = await getPreferences(adminDb, userId);
  if (!prefs || prefs.consentStatus !== "granted") return NOT_SET_UP;
  const tz = prefs.timezone;
  const newTime = formatLocalTime(time, tz);

  if (target === "daily-dharma") {
    if (!prefs.dailyDharmaEnabled) {
      return {
        error: "daily-dharma-off",
        note: "Daily Dharma isn't on. Offer to enable it at that time (enable_daily_dharma with the time).",
      };
    }
    await savePreferences(adminDb, userId, {
      dailyDharmaLocalTime: time,
      lastPreferenceChangeAt: Date.now(),
    });
    await cancelPendingDeliveries(engineDeps, userId, ["daily-dharma"]);
    await scheduleNextDailyDharma(userId);
    log.info("daily dharma time changed", { userId, time });
    return { status: "changed", target: "Daily Dharma", newTime };
  }

  if (target !== "all") {
    const enrollment = (await getActiveEnrollments(adminDb, userId)).find(
      (e) => e.programId === target
    );
    if (!enrollment) {
      return {
        error: "not-enrolled-in-that-program",
        note: "They aren't in that program; check the account snapshot for what's active.",
      };
    }
    const program = getProgram(target);
    await saveEnrollment(adminDb, {
      ...enrollment,
      preferredLocalTime: time,
      updatedAt: Date.now(),
    });
    await cancelPendingDeliveries(engineDeps, userId, ["program-lesson"], enrollment.id);
    const res = await rescheduleEnrollment(
      user,
      { ...enrollment, preferredLocalTime: time },
      false
    );
    log.info("program delivery time changed", { userId, program: target, time, nextLesson: res });
    if (!res) {
      return {
        status: "changed-but-unverified",
        target: program?.title ?? target,
        newTime,
        note: "The time was saved but the next lesson could not be confirmed in the delivery queue. Do not present it as confirmed; say you're double-checking and they can ask again in a minute.",
      };
    }
    return {
      status: "changed",
      target: program?.title ?? target,
      newTime,
      nextLessons: [{ program: res.programTitle, arrives: res.when }],
    };
  }

  // target === "all": one time for everything — clear per-stream overrides.
  await savePreferences(adminDb, userId, {
    preferredLocalTime: time,
    dailyDharmaLocalTime: null,
    lastPreferenceChangeAt: Date.now(),
  });
  const enrollments = await getActiveEnrollments(adminDb, userId);
  for (const e of enrollments) {
    if (e.preferredLocalTime) {
      await saveEnrollment(adminDb, { ...e, preferredLocalTime: null, updatedAt: Date.now() });
    }
  }
  const canceled = await cancelPendingDeliveries(engineDeps, userId, [
    "program-lesson",
    "daily-dharma",
  ]);
  const rescheduled = await rescheduleAllActive(user, false);
  if (prefs.dailyDharmaEnabled) await scheduleNextDailyDharma(userId);
  log.info("delivery time changed for all streams", {
    userId,
    preferredLocalTime: time,
    canceledPending: canceled,
    nextLessons: rescheduled,
  });
  if (enrollments.length > 0 && rescheduled.length < enrollments.length) {
    log.error("delivery time change could not verify all queued lessons", {
      userId,
      preferredLocalTime: time,
      expected: enrollments.length,
      verified: rescheduled.length,
    });
    return {
      status: "changed-but-unverified",
      target: "all messages",
      newTime,
      nextLessons: rescheduled.map((r) => ({ program: r.programTitle, arrives: r.when })),
      note: "The time was saved but not every next lesson could be confirmed in the delivery queue. Do not present it as fully confirmed; say you're double-checking and they can ask again in a minute.",
    };
  }
  return {
    status: "changed",
    target: "all messages",
    newTime,
    nextLessons: rescheduled.map((r) => ({ program: r.programTitle, arrives: r.when })),
  };
}

async function changeDeliveryTime(
  user: CompanionUserDoc,
  chatGuid: string,
  time: string
): Promise<void> {
  const result = await applyDeliveryTimeChange(user, time, "all");
  if (result.error) {
    await reply(chatGuid, ["No delivery schedule yet — reply START to set one up."]);
    return;
  }
  if (result.status === "changed-but-unverified") {
    await reply(chatGuid, [
      "I updated your preferred time, but I could not verify the next lesson in the delivery queue. I’m not marking this confirmed. Please try CHANGE TIME again in a minute.",
    ]);
    return;
  }
  const next = result.nextLessons?.[0];
  await reply(chatGuid, [
    `Done — your messages now arrive at ${result.newTime}.` +
      (next ? ` Next lesson: ${next.arrives}.` : ""),
  ]);
}

/**
 * The most recently delivered lesson, across all active programs — or one
 * specific program's latest lesson when a slug is given.
 */
async function lastDeliveredLesson(
  userId: string,
  programSlug?: string
): Promise<{ programId: string; lesson: NonNullable<ReturnType<typeof lessonForDay>> } | null> {
  const enrollments = (await getActiveEnrollments(adminDb, userId)).filter(
    (e) => (!programSlug || e.programId === programSlug) && e.completedLessonDays.length > 0
  );
  const enrollment = enrollments.sort(
    (a, b) => (b.lastLessonSentAt ?? 0) - (a.lastLessonSentAt ?? 0)
  )[0];
  if (!enrollment) return null;
  const program = getProgram(enrollment.programId);
  if (!program) return null;
  const lastDay = enrollment.completedLessonDays[enrollment.completedLessonDays.length - 1];
  const lesson = lessonForDay(program, lastDay);
  return lesson ? { programId: program.slug, lesson } : null;
}
