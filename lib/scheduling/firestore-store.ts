import type { Firestore } from "firebase-admin/firestore";
import type { ScheduledDelivery } from "../types/companion";
import type { DeliveryStore } from "./store";

// Firestore-backed delivery store. Collection: scheduledDeliveries.
// Requires composite indexes (see firestore.indexes.json):
//   (status ASC, nextAttemptAt ASC)  — findDue
//   (status ASC, leaseExpiresAt ASC) — findExpiredLeases
//   (userId ASC, status ASC)         — findPendingByUser

const COLLECTION = "scheduledDeliveries";
const CLAIMABLE = ["queued", "retry"];

export class FirestoreDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Firestore) {}

  private col() {
    return this.db.collection(COLLECTION);
  }

  async get(id: string): Promise<ScheduledDelivery | null> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? (snap.data() as ScheduledDelivery) : null;
  }

  async createIfAbsent(
    delivery: ScheduledDelivery
  ): Promise<{ created: boolean; record: ScheduledDelivery }> {
    const ref = this.col().doc(delivery.id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return { created: false, record: snap.data() as ScheduledDelivery };
      tx.set(ref, delivery);
      return { created: true, record: delivery };
    });
  }

  async update(id: string, patch: Partial<ScheduledDelivery>): Promise<void> {
    await this.col().doc(id).set(patch, { merge: true });
  }

  async findDue(nowMs: number, limit: number): Promise<ScheduledDelivery[]> {
    // Two equality-filtered queries instead of an IN to keep index shape simple.
    const results: ScheduledDelivery[] = [];
    for (const status of CLAIMABLE) {
      const snap = await this.col()
        .where("status", "==", status)
        .where("nextAttemptAt", "<=", nowMs)
        .orderBy("nextAttemptAt", "asc")
        .limit(limit)
        .get();
      snap.forEach((d) => results.push(d.data() as ScheduledDelivery));
    }
    return results.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, limit);
  }

  async findExpiredLeases(nowMs: number, limit: number): Promise<ScheduledDelivery[]> {
    const snap = await this.col()
      .where("status", "==", "claimed")
      .where("leaseExpiresAt", "<=", nowMs)
      .orderBy("leaseExpiresAt", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as ScheduledDelivery);
  }

  async findPendingByUser(userId: string, types?: string[]): Promise<ScheduledDelivery[]> {
    const snap = await this.col()
      .where("userId", "==", userId)
      .where("status", "in", ["queued", "retry", "claimed"])
      .get();
    const all = snap.docs.map((d) => d.data() as ScheduledDelivery);
    return types ? all.filter((d) => types.includes(d.deliveryType)) : all;
  }

  async tryClaim(
    id: string,
    leaseOwner: string,
    leaseMs: number,
    nowMs: number
  ): Promise<ScheduledDelivery | null> {
    const ref = this.col().doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = snap.data() as ScheduledDelivery;
      const leaseActive = d.status === "claimed" && (d.leaseExpiresAt ?? 0) > nowMs;
      if (leaseActive) return null;
      if (!CLAIMABLE.includes(d.status) && d.status !== "claimed") return null;
      if (d.nextAttemptAt > nowMs) return null;
      const patch = {
        status: "claimed" as const,
        leaseOwner,
        leaseExpiresAt: nowMs + leaseMs,
        updatedAt: nowMs,
      };
      tx.update(ref, patch);
      return { ...d, ...patch };
    });
  }
}
