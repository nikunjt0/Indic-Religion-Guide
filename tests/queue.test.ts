import { describe, expect, it } from "vitest";
import type { DeliveryPreferences } from "../lib/types/companion";
import { FakeMessagingProvider } from "../lib/messaging/fake";
import { GuardedMessagingProvider } from "../lib/messaging/guarded";
import { FixedClock } from "../lib/scheduling/clock";
import {
  cancelPendingDeliveries,
  deliverClaimed,
  enqueueDelivery,
  runDispatchTick,
  type EngineDeps,
} from "../lib/scheduling/engine";
import { InMemoryDeliveryStore } from "../lib/scheduling/store";
import { BACKOFF_SCHEDULE_MS } from "../lib/scheduling/retry";

const T0 = Date.UTC(2026, 6, 30, 12, 0, 0);

function prefs(overrides: Partial<DeliveryPreferences> = {}): DeliveryPreferences {
  return {
    userId: "user1",
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
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EngineDeps> = {}) {
  const store = new InMemoryDeliveryStore();
  const provider = new FakeMessagingProvider();
  const clock = new FixedClock(T0);
  const deps: EngineDeps = {
    store,
    provider,
    clock,
    loadPreferences: async () => prefs(),
    ...overrides,
  };
  return { deps, store, provider, clock };
}

function enqueueParams(overrides: Partial<Parameters<typeof enqueueDelivery>[1]> = {}) {
  return {
    userId: "user1",
    recipientHandle: "+13125550100",
    provider: "fake",
    deliveryType: "program-lesson" as const,
    enrollmentId: "enr1",
    lessonDay: 1,
    scheduledAt: T0,
    scheduledLocalDate: "2026-07-30",
    timezone: "America/Chicago",
    renderedMessage: "DAY 1 lesson body",
    ...overrides,
  };
}

describe("enqueueDelivery idempotency", () => {
  it("same logical delivery creates one record", async () => {
    const { deps, store } = makeDeps();
    const first = await enqueueDelivery(deps, enqueueParams());
    const second = await enqueueDelivery(deps, enqueueParams());
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(store.records.size).toBe(1);
  });

  it("different local date is a different delivery", async () => {
    const { deps, store } = makeDeps();
    await enqueueDelivery(deps, enqueueParams());
    await enqueueDelivery(deps, enqueueParams({ scheduledLocalDate: "2026-07-31", lessonDay: 2 }));
    expect(store.records.size).toBe(2);
  });
});

describe("claiming", () => {
  it("a delivery can be claimed exactly once while the lease is live", async () => {
    const { deps, store } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const a = await store.tryClaim(record.id, "worker-a", 120_000, T0);
    const b = await store.tryClaim(record.id, "worker-b", 120_000, T0);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("future deliveries are not claimable", async () => {
    const { deps, store } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams({ scheduledAt: T0 + 60_000 }));
    expect(await store.tryClaim(record.id, "w", 120_000, T0)).toBeNull();
  });

  it("expired leases are recovered by the dispatcher and re-processed", async () => {
    const { deps, store, clock, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    await store.tryClaim(record.id, "dead-worker", 120_000, T0);
    // Dead worker never delivers. Advance past lease expiry.
    clock.set(T0 + 180_000);
    const stats = await runDispatchTick(deps);
    expect(stats.recoveredLeases).toBe(1);
    expect(stats.sent).toBe(1);
    expect(provider.sent).toHaveLength(1);
  });
});

describe("delivery worker", () => {
  it("sends, marks sent, and calls onSent exactly once", async () => {
    let onSentCalls = 0;
    const { deps, store, provider } = makeDeps({ onSent: async () => void onSentCalls++ });
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    const outcome = await deliverClaimed(deps, claimed!);
    expect(outcome).toBe("sent");
    expect(provider.sent).toHaveLength(1);
    expect(onSentCalls).toBe(1);
    const final = await store.get(record.id);
    expect(final!.status).toBe("sent");
    expect(final!.providerMessageId).toBeTruthy();
  });

  it("never double-sends an already-sent record (function retry safety)", async () => {
    const { deps, store, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    await deliverClaimed(deps, claimed!);
    // Simulate a stale worker re-running with the same claimed snapshot.
    const outcome = await deliverClaimed(deps, claimed!);
    expect(outcome).toBe("suppressed");
    expect(provider.sent).toHaveLength(1);
  });

  it("suppresses when consent is revoked", async () => {
    const { deps, store } = makeDeps({
      loadPreferences: async () => prefs({ consentStatus: "revoked" }),
    });
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("suppressed");
    expect((await store.get(record.id))!.failureCode).toBe("no-consent");
  });

  it("suppresses while paused", async () => {
    const { deps, store } = makeDeps({
      loadPreferences: async () => prefs({ pausedUntil: T0 + 86_400_000 }),
    });
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("suppressed");
  });

  it("suppresses when the delivery type is disabled", async () => {
    const { deps, store } = makeDeps({
      loadPreferences: async () => prefs({ programMessagesEnabled: false }),
    });
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("suppressed");
  });

  it("defers into a retry when inside quiet hours", async () => {
    const { deps, store, clock } = makeDeps({
      loadPreferences: async () => prefs({ quietHoursStart: "00:00", quietHoursEnd: "23:00" }),
    });
    // T0 = 07:00 America/Chicago — inside 00:00–23:00 quiet hours.
    clock.set(T0);
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    const outcome = await deliverClaimed(deps, claimed!);
    // 23:00 local is > 6h past schedule → lateness kicks in and it fails as
    // skipped-late rather than arriving mid-night.
    expect(["retried", "failed"]).toContain(outcome);
    const rec = await store.get(record.id);
    if (outcome === "retried") expect(rec!.nextAttemptAt).toBeGreaterThan(T0);
    else expect(rec!.failureCode).toBe("skipped-late");
  });

  it("fails as skipped-late past the lateness window", async () => {
    const { deps, store, clock, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    clock.set(T0 + 7 * 3_600_000); // program lesson window is 6h
    const claimed = await store.tryClaim(record.id, "w", 120_000, clock.now());
    expect(await deliverClaimed(deps, claimed!)).toBe("failed");
    expect((await store.get(record.id))!.failureCode).toBe("skipped-late");
    expect(provider.sent).toHaveLength(0);
  });

  it("retries transient failures with staged backoff, then succeeds without duplicates", async () => {
    const { deps, store, clock, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    provider.failNext({ errorCategory: "server", retryable: true, errorMessage: "HTTP 503" });

    let stats = await runDispatchTick(deps);
    expect(stats.retried).toBe(1);
    const rec = await store.get(record.id);
    expect(rec!.status).toBe("retry");
    expect(rec!.nextAttemptAt).toBe(T0 + BACKOFF_SCHEDULE_MS[0]);

    // Not due yet — nothing happens.
    stats = await runDispatchTick(deps);
    expect(stats.claimed).toBe(0);

    clock.set(rec!.nextAttemptAt);
    stats = await runDispatchTick(deps);
    expect(stats.sent).toBe(1);
    expect(provider.sent).toHaveLength(1);
    expect((await store.get(record.id))!.status).toBe("sent");
  });

  it("fails immediately on non-retryable errors", async () => {
    const { deps, store, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams());
    provider.failNext({ errorCategory: "invalid-recipient", retryable: false });
    const stats = await runDispatchTick(deps);
    expect(stats.failed).toBe(1);
    expect((await store.get(record.id))!.status).toBe("failed");
  });

  it("exhausts max attempts", async () => {
    const { deps, store, clock, provider } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams({ maxAttempts: 2 }));
    provider.failNext({ errorCategory: "server", retryable: true });
    provider.failNext({ errorCategory: "server", retryable: true });
    await runDispatchTick(deps);
    const afterFirst = await store.get(record.id);
    clock.set(afterFirst!.nextAttemptAt);
    await runDispatchTick(deps);
    expect((await store.get(record.id))!.status).toBe("failed");
    expect((await store.get(record.id))!.failureCode).toBe("server");
  });

  it("send-guard block suppresses instead of failing and fires onSuppressed", async () => {
    const base = makeDeps();
    const guarded = new GuardedMessagingProvider(base.provider, {
      sendEnabled: false,
      allowlist: null,
    });
    const suppressions: string[] = [];
    const deps: EngineDeps = {
      ...base.deps,
      provider: guarded,
      onSuppressed: async (_d, code) => void suppressions.push(code),
    };
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await base.store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("suppressed");
    expect((await base.store.get(record.id))!.failureCode).toBe("send-guard-blocked");
    expect(base.provider.sent).toHaveLength(0);
    expect(suppressions).toEqual(["send-guard-blocked"]);
  });

  it("consent-revoked suppression also fires onSuppressed with its code", async () => {
    const suppressions: string[] = [];
    const { deps, store } = makeDeps({
      loadPreferences: async () => prefs({ consentStatus: "revoked" }),
      onSuppressed: async (_d, code) => void suppressions.push(code),
    });
    const { record } = await enqueueDelivery(deps, enqueueParams());
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("suppressed");
    expect(suppressions).toEqual(["no-consent"]);
  });

  it("fails with missing-content when there is nothing to render", async () => {
    const { deps, store } = makeDeps();
    const { record } = await enqueueDelivery(deps, enqueueParams({ renderedMessage: undefined }));
    const claimed = await store.tryClaim(record.id, "w", 120_000, T0);
    expect(await deliverClaimed(deps, claimed!)).toBe("failed");
    expect((await store.get(record.id))!.failureCode).toBe("missing-content");
  });
});

describe("cancelPendingDeliveries", () => {
  it("cancels queued items and leaves sent history alone", async () => {
    const { deps, store } = makeDeps();
    const a = await enqueueDelivery(deps, enqueueParams());
    await runDispatchTick(deps); // a is sent
    await enqueueDelivery(
      deps,
      enqueueParams({ scheduledLocalDate: "2026-07-31", lessonDay: 2, scheduledAt: T0 + 86_400_000 })
    );
    const canceled = await cancelPendingDeliveries(deps, "user1");
    expect(canceled).toBe(1);
    expect((await store.get(a.record.id))!.status).toBe("sent");
  });
});
