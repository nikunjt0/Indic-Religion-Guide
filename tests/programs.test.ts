import { describe, expect, it } from "vitest";
import type { DeliveryPreferences } from "../lib/types/companion";
import { FixedClock } from "../lib/scheduling/clock";
import { InMemoryDeliveryStore } from "../lib/scheduling/store";
import { localDateOf } from "../lib/scheduling/time";
import {
  advanceEnrollment,
  lessonForDay,
  newEnrollment,
  scheduleCurrentLesson,
  type ProgramWithLessons,
} from "../lib/programs/engine";

const T0 = Date.UTC(2026, 6, 30, 12, 0, 0);

function program(days = 3): ProgramWithLessons {
  return {
    slug: "test-program",
    title: "Test Program",
    shortDescription: "x",
    durationDays: days,
    difficulty: "beginner",
    audience: "test",
    category: "test",
    status: "published",
    version: 1,
    isFree: true,
    requiredTier: "free",
    createdAt: T0,
    updatedAt: T0,
    lessons: Array.from({ length: days }, (_, i) => ({
      dayNumber: i + 1,
      slug: `day-${i + 1}`,
      title: `Day ${i + 1}`,
      learningObjective: "learn",
      standardMessage: `DAY ${i + 1} body`,
      reviewStatus: "approved",
    })),
  };
}

function prefs(): DeliveryPreferences {
  return {
    userId: "u1",
    enabled: true,
    timezone: "America/Chicago",
    preferredLocalTime: "07:30",
    dailyDharmaEnabled: true,
    programMessagesEnabled: true,
    festivalMessagesEnabled: true,
    weeklyRecapEnabled: true,
    inactivityCheckInsEnabled: true,
    consentStatus: "granted",
    createdAt: T0,
    updatedAt: T0,
  };
}

describe("program engine", () => {
  it("lessonForDay finds lessons and rejects missing days", () => {
    const p = program();
    expect(lessonForDay(p, 2)!.title).toBe("Day 2");
    expect(lessonForDay(p, 9)).toBeNull();
  });

  it("advanceEnrollment moves to the next day", () => {
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const advanced = advanceEnrollment(e, 1, 3, T0 + 1000);
    expect(advanced.currentDay).toBe(2);
    expect(advanced.completedLessonDays).toEqual([1]);
    expect(advanced.status).toBe("active");
  });

  it("advanceEnrollment is idempotent per day", () => {
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const once = advanceEnrollment(e, 1, 3, T0 + 1000);
    const twice = advanceEnrollment(once, 1, 3, T0 + 2000);
    expect(twice).toBe(once);
  });

  it("completes after the final day", () => {
    const e = { ...newEnrollment({ userId: "u1", program: program(), nowMs: T0 }), currentDay: 3, completedLessonDays: [1, 2] };
    const done = advanceEnrollment(e, 3, 3, T0 + 1000);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBe(T0 + 1000);
  });

  it("schedules the current lesson at the next preferred local time", async () => {
    const store = new InMemoryDeliveryStore();
    const clock = new FixedClock(T0); // 07:00 America/Chicago
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const res = await scheduleCurrentLesson(
      { store, clock },
      {
        enrollment: e,
        program: program(),
        prefs: prefs(),
        recipientHandle: "+13125550100",
        providerName: "fake",
      }
    );
    expect("scheduledAt" in res && res.created).toBe(true);
    const [record] = [...store.records.values()];
    expect(record.deliveryType).toBe("program-lesson");
    expect(record.renderedMessage).toBe("DAY 1 body");
    expect(record.lessonDay).toBe(1);
  });

  it("re-scheduling the same day is a no-op (no duplicate lesson)", async () => {
    const store = new InMemoryDeliveryStore();
    const clock = new FixedClock(T0);
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const args = {
      enrollment: e,
      program: program(),
      prefs: prefs(),
      recipientHandle: "+13125550100",
      providerName: "fake",
    };
    await scheduleCurrentLesson({ store, clock }, args);
    const second = await scheduleCurrentLesson({ store, clock }, args);
    expect(second.created).toBe(false);
    expect(store.records.size).toBe(1);
  });

  it("moves to the next local day when today's lesson was already sent", async () => {
    const store = new InMemoryDeliveryStore();
    const clock = new FixedClock(T0);
    const e = {
      ...newEnrollment({ userId: "u1", program: program(), nowMs: T0 }),
      lastLessonSentAt: T0 - 60_000,
    };
    const res = await scheduleCurrentLesson(
      { store, clock },
      {
        enrollment: e,
        program: program(),
        prefs: prefs(),
        recipientHandle: "+13125550100",
        providerName: "fake",
      }
    );

    expect("scheduledAt" in res && res.created).toBe(true);
    if (!("scheduledAt" in res)) throw new Error("expected scheduled result");
    expect(localDateOf(res.scheduledAt, "America/Chicago")).toBe("2026-07-31");
  });

  it("does not report a same-day sent collision as the next queued delivery", async () => {
    const store = new InMemoryDeliveryStore();
    const clock = new FixedClock(T0);
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const args = {
      enrollment: e,
      program: program(),
      prefs: prefs(),
      recipientHandle: "+13125550100",
      providerName: "fake",
    };
    const first = await scheduleCurrentLesson({ store, clock }, args);
    if (!("scheduledAt" in first)) throw new Error("expected scheduled result");
    const [sameDayRecord] = [...store.records.values()];
    await store.update(sameDayRecord.id, { status: "sent", sentAt: first.scheduledAt });

    const second = await scheduleCurrentLesson({ store, clock }, args);

    expect("scheduledAt" in second && second.created).toBe(true);
    if (!("scheduledAt" in second)) throw new Error("expected scheduled result");
    expect(localDateOf(second.scheduledAt, "America/Chicago")).toBe("2026-07-31");
    expect(store.records.size).toBe(2);
  });

  it("returns an error when the queued delivery cannot be verified after enqueue", async () => {
    class VanishingStore extends InMemoryDeliveryStore {
      override async get(): Promise<null> {
        return null;
      }
    }
    const store = new VanishingStore();
    const clock = new FixedClock(T0);
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });

    const res = await scheduleCurrentLesson(
      { store, clock },
      {
        enrollment: e,
        program: program(),
        prefs: prefs(),
        recipientHandle: "+13125550100",
        providerName: "fake",
      }
    );

    expect(res).toEqual({ created: false, reason: "queued-delivery-not-found" });
  });

  it("refuses canceled enrollments and missing lessons", async () => {
    const store = new InMemoryDeliveryStore();
    const clock = new FixedClock(T0);
    const e = newEnrollment({ userId: "u1", program: program(), nowMs: T0 });
    const canceled = await scheduleCurrentLesson(
      { store, clock },
      {
        enrollment: { ...e, status: "canceled" },
        program: program(),
        prefs: prefs(),
        recipientHandle: "+1",
        providerName: "fake",
      }
    );
    expect(canceled).toEqual({ created: false, reason: "enrollment-not-active" });
    const missing = await scheduleCurrentLesson(
      { store, clock },
      {
        enrollment: { ...e, currentDay: 99 },
        program: program(),
        prefs: prefs(),
        recipientHandle: "+1",
        providerName: "fake",
      }
    );
    expect(missing).toEqual({ created: false, reason: "missing-lesson" });
  });
});
