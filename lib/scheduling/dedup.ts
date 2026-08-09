import { createHash } from "node:crypto";
import type { DeliveryType } from "../types/companion";

// Deterministic deduplication key and document id for a delivery. Using the
// hash as the Firestore doc id makes enqueue idempotent: re-running the same
// scheduling decision writes the same document instead of a duplicate.

export function deduplicationKeyFor(parts: {
  userId: string;
  deliveryType: DeliveryType;
  enrollmentId?: string;
  lessonDay?: number;
  scheduledLocalDate: string;
  variant?: string;
}): string {
  return [
    parts.userId,
    parts.deliveryType,
    parts.enrollmentId ?? "-",
    parts.lessonDay ?? "-",
    parts.scheduledLocalDate,
    parts.variant ?? "default",
  ].join("|");
}

export function deliveryIdFor(deduplicationKey: string): string {
  return createHash("sha256").update(deduplicationKey).digest("hex").slice(0, 32);
}
