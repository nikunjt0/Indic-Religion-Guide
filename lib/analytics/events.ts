import type { Firestore } from "firebase-admin/firestore";

// Privacy-conscious analytics taxonomy (spec §24). Events carry no message
// bodies or question text — only ids, types, and coarse metadata. Stored in
// Firestore `analyticsEvents` for now; swappable for a real pipeline later.

export type AnalyticsEventName =
  | "onboarding_started"
  | "consent_granted"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "daily_delivery_enabled"
  | "delivery_scheduled"
  | "delivery_claimed"
  | "delivery_sent"
  | "delivery_failed"
  | "delivery_suppressed"
  | "delivery_retried"
  | "inbound_message_received"
  | "lesson_reply_received"
  | "lesson_deeper_requested"
  | "lesson_child_version_requested"
  | "lesson_source_requested"
  | "lesson_saved"
  | "program_viewed"
  | "program_enrolled"
  | "program_day_delivered"
  | "program_day_engaged"
  | "program_completed"
  | "program_paused"
  | "program_resumed"
  | "delivery_time_changed"
  | "public_answer_viewed"
  | "public_answer_cta_clicked"
  | "seo_signup_started"
  | "seo_signup_completed"
  | "subscription_started"
  | "subscription_canceled"
  | "content_reported"
  | "content_corrected";

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  userId?: string; // opaque handleId / uid — never a raw phone number
  programId?: string;
  lessonDay?: number;
  deliveryId?: string;
  /** Small, non-sensitive metadata only. Never message or question text. */
  meta?: Record<string, string | number | boolean>;
  at: number;
}

export async function trackEvent(
  db: Firestore,
  event: Omit<AnalyticsEvent, "at">
): Promise<void> {
  try {
    await db.collection("analyticsEvents").add({ ...event, at: Date.now() });
  } catch {
    // Analytics must never break product flows.
  }
}
