import type { ScheduledDelivery } from "../types/companion";

// Storage seam for the delivery queue. The in-memory implementation mirrors
// Firestore transaction semantics closely enough to test claiming, leases,
// and idempotency without an emulator. The Firestore implementation lives in
// firestore-store.ts (kept separate so tests never import firebase-admin).

export interface DeliveryStore {
  get(id: string): Promise<ScheduledDelivery | null>;
  /** Create if absent. Returns the stored record (existing one on conflict). */
  createIfAbsent(delivery: ScheduledDelivery): Promise<{ created: boolean; record: ScheduledDelivery }>;
  /** Blind merge-update of mutable fields. */
  update(id: string, patch: Partial<ScheduledDelivery>): Promise<void>;
  /** Due = status queued|retry and nextAttemptAt <= now, oldest first. */
  findDue(nowMs: number, limit: number): Promise<ScheduledDelivery[]>;
  /** Claimed records whose lease expired before now. */
  findExpiredLeases(nowMs: number, limit: number): Promise<ScheduledDelivery[]>;
  /** Pending (queued|retry|claimed) deliveries for a user, optionally by type. */
  findPendingByUser(userId: string, types?: string[]): Promise<ScheduledDelivery[]>;
  /**
   * Atomically claim a delivery: only succeeds when the record is still due
   * (queued|retry), unclaimed or lease-expired. Returns the claimed record or
   * null when someone else won or state changed.
   */
  tryClaim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
    nowMs: number
  ): Promise<ScheduledDelivery | null>;
}

const CLAIMABLE = new Set(["queued", "retry"]);

export class InMemoryDeliveryStore implements DeliveryStore {
  readonly records = new Map<string, ScheduledDelivery>();

  async get(id: string): Promise<ScheduledDelivery | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  async createIfAbsent(
    delivery: ScheduledDelivery
  ): Promise<{ created: boolean; record: ScheduledDelivery }> {
    const existing = this.records.get(delivery.id);
    if (existing) return { created: false, record: { ...existing } };
    this.records.set(delivery.id, { ...delivery });
    return { created: true, record: { ...delivery } };
  }

  async update(id: string, patch: Partial<ScheduledDelivery>): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) throw new Error(`delivery not found: ${id}`);
    this.records.set(id, { ...existing, ...patch });
  }

  async findDue(nowMs: number, limit: number): Promise<ScheduledDelivery[]> {
    return [...this.records.values()]
      .filter((d) => CLAIMABLE.has(d.status) && d.nextAttemptAt <= nowMs)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async findExpiredLeases(nowMs: number, limit: number): Promise<ScheduledDelivery[]> {
    return [...this.records.values()]
      .filter((d) => d.status === "claimed" && (d.leaseExpiresAt ?? 0) <= nowMs)
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async findPendingByUser(userId: string, types?: string[]): Promise<ScheduledDelivery[]> {
    return [...this.records.values()]
      .filter(
        (d) =>
          d.userId === userId &&
          ["queued", "retry", "claimed"].includes(d.status) &&
          (!types || types.includes(d.deliveryType))
      )
      .map((d) => ({ ...d }));
  }

  async tryClaim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
    nowMs: number
  ): Promise<ScheduledDelivery | null> {
    const d = this.records.get(id);
    if (!d) return null;
    const leaseActive = d.status === "claimed" && (d.leaseExpiresAt ?? 0) > nowMs;
    if (leaseActive) return null;
    if (!CLAIMABLE.has(d.status) && d.status !== "claimed") return null;
    if (d.nextAttemptAt > nowMs) return null;
    const claimed: ScheduledDelivery = {
      ...d,
      status: "claimed",
      leaseOwner,
      leaseExpiresAt: nowMs + leaseMs,
      updatedAt: nowMs,
    };
    this.records.set(id, claimed);
    return { ...claimed };
  }
}
