import type { Firestore } from "firebase-admin/firestore";
import type {
  DeliveryPreferences,
  Enrollment,
  MessageEvent,
} from "../types/companion";

// Admin-SDK repositories for the companion collections. Kept thin: callers
// own the business logic, these own collection names and merge semantics.

const PREFS = "deliveryPreferences";
const ENROLLMENTS = "enrollments";
const EVENTS = "messageEvents";

export async function getPreferences(
  db: Firestore,
  userId: string
): Promise<DeliveryPreferences | null> {
  const snap = await db.collection(PREFS).doc(userId).get();
  return snap.exists ? (snap.data() as DeliveryPreferences) : null;
}

export async function savePreferences(
  db: Firestore,
  userId: string,
  patch: Partial<DeliveryPreferences>
): Promise<void> {
  await db
    .collection(PREFS)
    .doc(userId)
    .set({ ...patch, userId, updatedAt: Date.now() }, { merge: true });
}

/** All active enrollments — users can run several programs concurrently. */
export async function getActiveEnrollments(
  db: Firestore,
  userId: string
): Promise<Enrollment[]> {
  const snap = await db
    .collection(ENROLLMENTS)
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  return snap.docs
    .map((d) => d.data() as Enrollment)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export async function getEnrollment(
  db: Firestore,
  enrollmentId: string
): Promise<Enrollment | null> {
  const snap = await db.collection(ENROLLMENTS).doc(enrollmentId).get();
  return snap.exists ? (snap.data() as Enrollment) : null;
}

export async function saveEnrollment(db: Firestore, enrollment: Enrollment): Promise<void> {
  await db.collection(ENROLLMENTS).doc(enrollment.id).set(enrollment, { merge: true });
}

/**
 * Record an inbound provider event exactly once. Returns false when the event
 * id was already recorded (duplicate webhook/socket emission) — callers must
 * then skip processing.
 */
export async function recordInboundEventOnce(
  db: Firestore,
  event: MessageEvent
): Promise<boolean> {
  try {
    await db.collection(EVENTS).doc(event.id).create(event);
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    // Firestore ALREADY_EXISTS = 6
    if (code === 6) return false;
    throw err;
  }
}

export async function recordOutboundEvent(db: Firestore, event: MessageEvent): Promise<void> {
  await db.collection(EVENTS).doc(event.id).set(event, { merge: true });
}
