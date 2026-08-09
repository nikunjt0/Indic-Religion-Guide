import { DateTime } from "luxon";
import type {
  DeliveryPreferences,
  DeliveryType,
  ScheduledDelivery,
} from "../types/companion";
import type { MessagingProvider, SendResult } from "../messaging/types";
import type { Clock } from "./clock";
import type { DeliveryStore } from "./store";
import { deduplicationKeyFor, deliveryIdFor } from "./dedup";
import { DEFAULT_MAX_ATTEMPTS, isPastLatenessWindow, planAfterFailure } from "./retry";
import { isInQuietHours } from "./time";

// The delivery engine: idempotent enqueue, a global dispatch tick (find due →
// claim with lease → deliver), and the idempotent delivery worker. All
// side-effectful collaborators are injected so the whole engine is testable
// with the in-memory store, fake provider, and fixed clock.

export interface EngineDeps {
  store: DeliveryStore;
  /** Should already be wrapped in GuardedMessagingProvider. */
  provider: MessagingProvider;
  clock: Clock;
  loadPreferences: (userId: string) => Promise<DeliveryPreferences | null>;
  /** Render the message body when delivery.renderedMessage is absent. */
  renderMessage?: (delivery: ScheduledDelivery) => Promise<string | null>;
  /** Called exactly once after a confirmed successful send. */
  onSent?: (delivery: ScheduledDelivery, result: SendResult) => Promise<void>;
  /**
   * Called when a delivery is suppressed (guard-blocked, paused, disabled…).
   * Lets recurring pipelines schedule their next occurrence so one suppressed
   * day doesn't silently kill all future deliveries.
   */
  onSuppressed?: (delivery: ScheduledDelivery, code: string) => Promise<void>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const PROACTIVE_FLAG: Partial<Record<DeliveryType, keyof DeliveryPreferences>> = {
  "daily-dharma": "dailyDharmaEnabled",
  "program-lesson": "programMessagesEnabled",
  festival: "festivalMessagesEnabled",
  "weekly-recap": "weeklyRecapEnabled",
  "inactivity-check-in": "inactivityCheckInsEnabled",
};

export interface EnqueueParams {
  userId: string;
  recipientHandle: string;
  recipientChatGuid?: string;
  provider: string;
  deliveryType: DeliveryType;
  programId?: string;
  enrollmentId?: string;
  lessonDay?: number;
  scheduledAt: number;
  scheduledLocalDate: string;
  timezone: string;
  renderedMessage?: string;
  variant?: string;
  maxAttempts?: number;
}

/** Idempotent: the same logical delivery always maps to the same doc id. */
export async function enqueueDelivery(
  deps: Pick<EngineDeps, "store" | "clock">,
  params: EnqueueParams
): Promise<{ created: boolean; record: ScheduledDelivery }> {
  const deduplicationKey = deduplicationKeyFor({
    userId: params.userId,
    deliveryType: params.deliveryType,
    enrollmentId: params.enrollmentId,
    lessonDay: params.lessonDay,
    scheduledLocalDate: params.scheduledLocalDate,
    variant: params.variant,
  });
  const now = deps.clock.now();
  const record: ScheduledDelivery = {
    id: deliveryIdFor(deduplicationKey),
    userId: params.userId,
    recipientHandle: params.recipientHandle,
    ...(params.recipientChatGuid ? { recipientChatGuid: params.recipientChatGuid } : {}),
    provider: params.provider,
    deliveryType: params.deliveryType,
    ...(params.programId ? { programId: params.programId } : {}),
    ...(params.enrollmentId ? { enrollmentId: params.enrollmentId } : {}),
    ...(params.lessonDay !== undefined ? { lessonDay: params.lessonDay } : {}),
    scheduledAt: params.scheduledAt,
    scheduledLocalDate: params.scheduledLocalDate,
    timezone: params.timezone,
    status: "queued",
    deduplicationKey,
    attemptCount: 0,
    maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: params.scheduledAt,
    ...(params.renderedMessage ? { renderedMessage: params.renderedMessage } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const result = await deps.store.createIfAbsent(record);
  if (result.created || result.record.status !== "canceled") return result;

  // Rescheduling can intentionally cancel and recreate the same logical
  // delivery: same user/enrollment/day/local-date dedup key, new delivery time.
  // Revive canceled records so the dispatcher can see the new queued work.
  const revived: ScheduledDelivery = {
    ...record,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: result.record.createdAt,
  };
  await deps.store.update(record.id, revived);
  return { created: true, record: revived };
}

/** Cancel all pending deliveries for a user (optionally only some types). */
export async function cancelPendingDeliveries(
  deps: Pick<EngineDeps, "store" | "clock">,
  userId: string,
  types?: DeliveryType[]
): Promise<number> {
  const pending = await deps.store.findPendingByUser(userId, types);
  const now = deps.clock.now();
  for (const d of pending) {
    await deps.store.update(d.id, { status: "canceled", updatedAt: now });
  }
  return pending.length;
}

export interface TickStats {
  recoveredLeases: number;
  due: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
}

export interface TickOptions {
  batchLimit?: number;
  leaseMs?: number;
  leaseOwner?: string;
}

/** One global dispatcher pass. Safe to run concurrently across processes. */
export async function runDispatchTick(
  deps: EngineDeps,
  opts: TickOptions = {}
): Promise<TickStats> {
  const batchLimit = opts.batchLimit ?? 25;
  const leaseMs = opts.leaseMs ?? 2 * 60_000;
  const leaseOwner = opts.leaseOwner ?? `dispatcher-${process.pid}`;
  const now = deps.clock.now();
  const stats: TickStats = {
    recoveredLeases: 0,
    due: 0,
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
  };

  // Recover leases abandoned by a crashed worker: put them back in the pool.
  const expired = await deps.store.findExpiredLeases(now, batchLimit);
  for (const d of expired) {
    await deps.store.update(d.id, {
      status: "retry",
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: now,
      updatedAt: now,
    });
    stats.recoveredLeases++;
  }

  const due = await deps.store.findDue(now, batchLimit);
  stats.due = due.length;
  for (const candidate of due) {
    const claimed = await deps.store.tryClaim(candidate.id, leaseOwner, leaseMs, now);
    if (!claimed) continue;
    stats.claimed++;
    const outcome = await deliverClaimed(deps, claimed);
    stats[outcome]++;
  }
  deps.log?.("dispatch tick", { ...stats });
  return stats;
}

export type DeliveryOutcome = "sent" | "retried" | "failed" | "suppressed";

/**
 * Deliver one claimed record. Revalidates consent/pause/type/lateness at send
 * time, sends through the (guarded) provider, records the result, and invokes
 * onSent exactly once on confirmed success.
 */
export async function deliverClaimed(
  deps: EngineDeps,
  delivery: ScheduledDelivery
): Promise<DeliveryOutcome> {
  const now = deps.clock.now();

  const suppress = async (code: string): Promise<DeliveryOutcome> => {
    await deps.store.update(delivery.id, {
      status: "suppressed",
      failureCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    await deps.onSuppressed?.(delivery, code);
    return "suppressed";
  };

  // Belt-and-braces idempotency: never double-send a record that is already
  // terminal (possible if a stale lease was recovered mid-send).
  const fresh = await deps.store.get(delivery.id);
  if (!fresh || fresh.status === "sent" || fresh.status === "canceled") {
    return "suppressed";
  }

  if (isPastLatenessWindow(delivery, now)) {
    await deps.store.update(delivery.id, {
      status: "failed",
      failureCode: "skipped-late",
      failureMessage: "maximum lateness window exceeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    return "failed";
  }

  const prefs = await deps.loadPreferences(delivery.userId);
  const isProactive = delivery.deliveryType in PROACTIVE_FLAG;
  if (isProactive) {
    if (!prefs || !prefs.enabled) return suppress("delivery-disabled");
    if (prefs.consentStatus !== "granted") return suppress("no-consent");
    if (prefs.pausedUntil && prefs.pausedUntil > now) return suppress("paused");
    const flag = PROACTIVE_FLAG[delivery.deliveryType]!;
    if (prefs[flag] === false) return suppress("type-disabled");
    if (isInQuietHours(now, delivery.timezone, prefs.quietHoursStart, prefs.quietHoursEnd)) {
      // Defer to the end of quiet hours instead of dropping.
      const deferTo = nextQuietEndMs(now, delivery.timezone, prefs.quietHoursEnd!);
      if (isPastLatenessWindow(delivery, deferTo)) {
        await deps.store.update(delivery.id, {
          status: "failed",
          failureCode: "skipped-late",
          failureMessage: "quiet hours pushed delivery past lateness window",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        });
        return "failed";
      }
      await deps.store.update(delivery.id, {
        status: "retry",
        nextAttemptAt: deferTo,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      });
      return "retried";
    }
  } else if (prefs && prefs.consentStatus === "revoked") {
    // Even transactional/onboarding messages stop after STOP.
    return suppress("opted-out");
  }

  let body = delivery.renderedMessage ?? null;
  if (!body && deps.renderMessage) body = await deps.renderMessage(delivery);
  if (!body) {
    await deps.store.update(delivery.id, {
      status: "failed",
      failureCode: "missing-content",
      failureMessage: "no rendered message and renderer returned null",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    return "failed";
  }

  const attemptCount = delivery.attemptCount + 1;
  await deps.store.update(delivery.id, { status: "sending", attemptCount, updatedAt: now });

  const result = await deps.provider.sendTextMessage(
    { handle: delivery.recipientHandle, chatGuid: delivery.recipientChatGuid },
    body
  );

  if (result.ok) {
    await deps.store.update(delivery.id, {
      status: "sent",
      providerMessageId: result.providerMessageId,
      sentAt: result.sentAt ?? deps.clock.now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: deps.clock.now(),
    });
    await deps.onSent?.({ ...delivery, attemptCount }, result);
    return "sent";
  }

  if (result.errorCategory === "blocked") {
    // Environment guard refused — not a delivery failure, an ops safeguard.
    return suppress("send-guard-blocked");
  }

  const plan = planAfterFailure({ ...delivery, attemptCount }, result, deps.clock.now());
  if (plan.action === "retry") {
    await deps.store.update(delivery.id, {
      status: "retry",
      attemptCount,
      nextAttemptAt: plan.nextAttemptAt,
      failureCode: result.errorCategory,
      failureMessage: result.errorMessage,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: deps.clock.now(),
    });
    return "retried";
  }
  await deps.store.update(delivery.id, {
    status: "failed",
    attemptCount,
    failureCode: plan.action === "skipped-late" ? "skipped-late" : result.errorCategory,
    failureMessage: result.errorMessage,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: deps.clock.now(),
  });
  return "failed";
}

/** Next instant at which quiet hours end, strictly after `nowMs`. */
export function nextQuietEndMs(nowMs: number, timezone: string, quietEnd: string): number {
  const [h, m] = quietEnd.split(":").map(Number);
  const local = DateTime.fromMillis(nowMs, { zone: timezone });
  let candidate = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (candidate.toMillis() <= nowMs) candidate = candidate.plus({ days: 1 });
  return candidate.toMillis();
}
