import type { DeliveryType, ScheduledDelivery } from "../types/companion";
import type { SendResult } from "../messaging/types";

// Retry policy: staged backoff, bounded attempts, and per-delivery-type
// maximum lateness. A message that can no longer arrive on time is marked
// skipped-late rather than delivered absurdly late.

export const BACKOFF_SCHEDULE_MS: number[] = [
  1 * 60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

export const DEFAULT_MAX_ATTEMPTS = 5;

const HOUR = 3_600_000;

export const MAX_LATENESS_MS: Record<DeliveryType, number> = {
  "daily-dharma": 3 * HOUR,
  "program-lesson": 6 * HOUR,
  festival: 12 * HOUR,
  "weekly-recap": 24 * HOUR,
  onboarding: 24 * HOUR,
  "inactivity-check-in": 24 * HOUR,
  transactional: 48 * HOUR,
};

export type FailurePlan =
  | { action: "retry"; nextAttemptAt: number }
  | { action: "failed"; reason: string }
  | { action: "skipped-late" };

export function isPastLatenessWindow(delivery: ScheduledDelivery, nowMs: number): boolean {
  const window = MAX_LATENESS_MS[delivery.deliveryType] ?? 6 * HOUR;
  return nowMs - delivery.scheduledAt > window;
}

export function planAfterFailure(
  delivery: ScheduledDelivery,
  result: SendResult,
  nowMs: number
): FailurePlan {
  if (!result.retryable) {
    return { action: "failed", reason: result.errorCategory ?? "non-retryable" };
  }
  const attemptsMade = delivery.attemptCount; // caller increments before planning
  if (attemptsMade >= delivery.maxAttempts) {
    return { action: "failed", reason: "max-attempts-exhausted" };
  }
  const backoff =
    BACKOFF_SCHEDULE_MS[Math.min(attemptsMade - 1, BACKOFF_SCHEDULE_MS.length - 1)];
  const nextAttemptAt = nowMs + backoff;
  if (isPastLatenessWindow({ ...delivery }, nextAttemptAt)) {
    return { action: "skipped-late" };
  }
  return { action: "retry", nextAttemptAt };
}
