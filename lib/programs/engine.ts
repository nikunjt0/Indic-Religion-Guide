import type {
  DeliveryPreferences,
  Enrollment,
  Program,
  ProgramLesson,
} from "../types/companion";
import type { Clock } from "../scheduling/clock";
import type { DeliveryStore } from "../scheduling/store";
import { enqueueDelivery } from "../scheduling/engine";
import { localDateOf, nextOccurrence } from "../scheduling/time";
import { DateTime } from "luxon";

export interface ProgramWithLessons extends Program {
  lessons: ProgramLesson[];
}

export function lessonForDay(program: ProgramWithLessons, day: number): ProgramLesson | null {
  return program.lessons.find((l) => l.dayNumber === day) ?? null;
}

/**
 * Advance an enrollment after a lesson was confirmed sent. Pure — returns the
 * updated enrollment. Idempotent: re-advancing for an already-delivered day
 * is a no-op.
 */
export function advanceEnrollment(
  enrollment: Enrollment,
  deliveredDay: number,
  durationDays: number,
  nowMs: number
): Enrollment {
  if (enrollment.completedLessonDays.includes(deliveredDay)) return enrollment;
  const completedLessonDays = [...enrollment.completedLessonDays, deliveredDay].sort(
    (a, b) => a - b
  );
  const nextDay = deliveredDay + 1;
  const finished = nextDay > durationDays;
  return {
    ...enrollment,
    completedLessonDays,
    currentDay: finished ? deliveredDay : nextDay,
    status: finished ? "completed" : enrollment.status,
    lastLessonSentAt: nowMs,
    completedAt: finished ? nowMs : enrollment.completedAt,
    updatedAt: nowMs,
  };
}

export interface ScheduleLessonParams {
  enrollment: Enrollment;
  program: ProgramWithLessons;
  prefs: DeliveryPreferences;
  recipientHandle: string;
  recipientChatGuid?: string;
  providerName: string;
  /** Send as soon as the dispatcher runs rather than at the preferred time. */
  immediate?: boolean;
}

export interface ScheduledLessonResult {
  created: boolean;
  deliveryId: string;
  scheduledAt: number;
}

/**
 * Enqueue the delivery for the enrollment's current day. Idempotent thanks to
 * the deterministic dedup key (enrollment + day + local date).
 */
export async function scheduleCurrentLesson(
  deps: { store: DeliveryStore; clock: Clock },
  params: ScheduleLessonParams
): Promise<ScheduledLessonResult | { created: false; reason: string }> {
  const { enrollment, program, prefs } = params;
  if (enrollment.status !== "active") return { created: false, reason: "enrollment-not-active" };
  const lesson = lessonForDay(program, enrollment.currentDay);
  if (!lesson) return { created: false, reason: "missing-lesson" };

  const now = deps.clock.now();
  const today = localDateOf(now, prefs.timezone);
  const lastSentToday =
    !params.immediate &&
    enrollment.lastLessonSentAt !== undefined &&
    localDateOf(enrollment.lastLessonSentAt, prefs.timezone) === today;

  let afterMs = lastSentToday ? endOfLocalDay(today, prefs.timezone) : now;
  for (let attempt = 0; attempt < 9; attempt++) {
    const { scheduledAt, scheduledLocalDate } = params.immediate
      ? { scheduledAt: now, scheduledLocalDate: localDateOf(now, prefs.timezone) }
      : nextScheduledOccurrence(prefs, afterMs);

    const result = await enqueueDelivery(deps, {
      userId: enrollment.userId,
      recipientHandle: params.recipientHandle,
      recipientChatGuid: params.recipientChatGuid,
      provider: params.providerName,
      deliveryType: "program-lesson",
      programId: program.slug,
      enrollmentId: enrollment.id,
      lessonDay: lesson.dayNumber,
      scheduledAt,
      scheduledLocalDate,
      timezone: prefs.timezone,
      renderedMessage: lesson.standardMessage,
    });

    if (result.record.status === "sent" && !params.immediate) {
      afterMs = endOfLocalDay(result.record.scheduledLocalDate, prefs.timezone);
      continue;
    }

    const stored = await deps.store.get(result.record.id);
    if (!stored) return { created: false, reason: "queued-delivery-not-found" };
    if (!["queued", "retry", "claimed"].includes(stored.status)) {
      return { created: false, reason: `queued-delivery-not-claimable:${stored.status}` };
    }

    return {
      created: result.created,
      deliveryId: stored.id,
      scheduledAt: stored.scheduledAt,
    };
  }

  return { created: false, reason: "no-open-local-date" };
}

function nextScheduledOccurrence(
  prefs: DeliveryPreferences,
  afterMs: number
): { scheduledAt: number; scheduledLocalDate: string } {
  const next = nextOccurrence(
    {
      timezone: prefs.timezone,
      preferredLocalTime: prefs.preferredLocalTime,
      deliveryDays: prefs.deliveryDays,
    },
    afterMs
  );
  return { scheduledAt: next.atMs, scheduledLocalDate: next.localDate };
}

function endOfLocalDay(localDate: string, timezone: string): number {
  return DateTime.fromISO(localDate, { zone: timezone }).endOf("day").toMillis();
}

export function newEnrollment(params: {
  userId: string;
  program: ProgramWithLessons;
  nowMs: number;
  source?: string;
}): Enrollment {
  const { userId, program, nowMs } = params;
  return {
    id: `${userId}_${program.slug}_v${program.version}`,
    userId,
    programId: program.slug,
    programVersion: program.version,
    status: "active",
    currentDay: 1,
    startedAt: nowMs,
    completedLessonDays: [],
    skippedLessonDays: [],
    enrollmentSource: params.source,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}
