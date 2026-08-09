// Data model for the Hindu Dharma Companion transformation: consent,
// delivery preferences, the scheduled-delivery queue, programs/enrollments,
// message events, and public answers. All timestamps are epoch milliseconds
// (number) so the types work identically under the client SDK, the Admin SDK,
// and plain-object tests. Firestore Timestamp fields are converted at the
// read/write boundary.

// ---------------------------------------------------------------------------
// Consent + delivery preferences (doc id = messaging user's handleId)
// ---------------------------------------------------------------------------

export type ConsentStatus = "granted" | "revoked" | "unknown";

export interface DeliveryPreferences {
  userId: string; // handleId of the imessageUsers doc
  enabled: boolean;
  timezone: string; // IANA, e.g. "America/Chicago"
  preferredLocalTime: string; // "HH:mm" 24h local
  /** 1=Monday … 7=Sunday (ISO weekday numbers). Empty/omitted = every day. */
  deliveryDays?: number[];
  quietHoursStart?: string; // "HH:mm" — deliveries are suppressed inside quiet hours
  quietHoursEnd?: string;
  pausedUntil?: number | null; // epoch ms; null/absent = not paused; Infinity is stored as PAUSED_INDEFINITELY
  pauseReason?: string;
  dailyDharmaEnabled: boolean;
  programMessagesEnabled: boolean;
  festivalMessagesEnabled: boolean;
  weeklyRecapEnabled: boolean;
  inactivityCheckInsEnabled: boolean;
  consentStatus: ConsentStatus;
  consentTimestamp?: number;
  consentSource?: "imessage" | "web";
  optOutTimestamp?: number;
  lastPreferenceChangeAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Sentinel for pausedUntil meaning "paused until explicitly resumed". */
export const PAUSED_INDEFINITELY = 8640000000000000; // max valid JS date ms

// ---------------------------------------------------------------------------
// Programs and lessons
// ---------------------------------------------------------------------------

export type ProgramStatus = "draft" | "review" | "published" | "archived";
export type ReviewStatus =
  | "draft"
  | "needs-theological-review"
  | "editorial-review"
  | "approved"
  | "rejected";

export interface Program {
  slug: string;
  title: string;
  shortDescription: string;
  longDescription?: string;
  durationDays: number;
  difficulty: "beginner" | "intermediate" | "advanced";
  audience: string;
  category: string;
  status: ProgramStatus;
  version: number;
  isFree: boolean;
  requiredTier: SubscriptionTier;
  sourcePolicy?: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
}

export interface ProgramLesson {
  dayNumber: number;
  slug: string;
  title: string;
  learningObjective: string;
  standardMessage: string; // the primary text-message body (plain text)
  deeperMessage?: string; // DEEPER reply
  childMessage?: string; // KIDS reply
  sourceNote?: string; // SOURCE reply
  reflectionQuestion?: string;
  practicalAction?: string;
  safetyClassification?: "standard" | "enhanced-review";
  reviewStatus: ReviewStatus | string;
  version?: number;
  estimatedReadingMinutes?: number;
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

export type EnrollmentStatus = "active" | "paused" | "completed" | "canceled";

export interface Enrollment {
  id: string;
  userId: string; // handleId
  programId: string; // program slug
  programVersion: number;
  status: EnrollmentStatus;
  /** Day number of the next lesson to deliver (1-based). */
  currentDay: number;
  startedAt: number;
  nextLessonAt?: number | null;
  lastLessonSentAt?: number;
  lastLessonCompletedAt?: number;
  completedLessonDays: number[];
  skippedLessonDays: number[];
  enrollmentSource?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Scheduled delivery queue
// ---------------------------------------------------------------------------

export type DeliveryType =
  | "daily-dharma"
  | "program-lesson"
  | "festival"
  | "weekly-recap"
  | "onboarding"
  | "inactivity-check-in"
  | "transactional";

export type DeliveryStatus =
  | "queued"
  | "claimed"
  | "sending"
  | "sent"
  | "retry"
  | "failed"
  | "canceled"
  | "suppressed";

export interface ScheduledDelivery {
  id: string; // deterministic hash of deduplicationKey
  userId: string; // handleId
  recipientHandle: string; // normalized handle
  recipientChatGuid?: string; // BlueBubbles chat GUID when known
  provider: string; // "bluebubbles"
  deliveryType: DeliveryType;
  programId?: string;
  enrollmentId?: string;
  lessonDay?: number;
  /** UTC instant the message should go out. */
  scheduledAt: number;
  scheduledLocalDate: string; // YYYY-MM-DD in the user's timezone
  timezone: string;
  status: DeliveryStatus;
  deduplicationKey: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number; // epoch ms; queued items have nextAttemptAt === scheduledAt
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  providerMessageId?: string;
  failureCode?: string;
  failureMessage?: string;
  /** Pre-rendered message body. Rendering happens at enqueue or claim time. */
  renderedMessage?: string;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
}

// ---------------------------------------------------------------------------
// Message events (permanent inbound/outbound log, used for dedup)
// ---------------------------------------------------------------------------

export interface MessageEvent {
  id: string; // providerEventId (message GUID) — doc id gives us dedup for free
  userId?: string; // handleId when mapped
  direction: "inbound" | "outbound";
  provider: string;
  providerMessageId?: string;
  body?: string;
  deliveryId?: string;
  programId?: string;
  lessonDay?: number;
  receivedAt?: number;
  sentAt?: number;
  processedAt?: number;
  processingStatus?: "pending" | "processed" | "ignored" | "failed";
  isFromMe?: boolean;
}

// ---------------------------------------------------------------------------
// Subscription-ready entitlements
// ---------------------------------------------------------------------------

export type SubscriptionTier = "free" | "individual" | "family";

// ---------------------------------------------------------------------------
// Public answers (reviewed SEO library)
// ---------------------------------------------------------------------------

export type PublicAnswerReviewStatus =
  | "draft"
  | "generated"
  | "theological-review"
  | "editorial-review"
  | "approved"
  | "published"
  | "rejected";

export interface PublicAnswer {
  question: string;
  slug: string;
  route: string; // e.g. "/learn/what-is-karma-in-hinduism"
  shortAnswer: string;
  fullAnswer: string;
  childExplanation?: string;
  perspectives?: string;
  practicalTakeaway?: string;
  sourceRefs?: { title: string; reference?: string }[];
  relatedSlugs?: string[];
  hubSlug?: string;
  category: string;
  titleTag: string;
  metaDescription: string;
  reviewStatus: PublicAnswerReviewStatus;
  riskClassification: "standard" | "elevated" | "high";
  reviewers?: string[];
  publishedAt?: number;
  lastReviewedAt?: number;
  contentVersion: number;
  indexingStatus: "noindex" | "index";
  createdAt: number;
  updatedAt: number;
}
