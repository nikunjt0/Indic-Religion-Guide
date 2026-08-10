import type { Firestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { enqueueDelivery } from "../scheduling/engine";
import { FirestoreDeliveryStore } from "../scheduling/firestore-store";
import { systemClock } from "../scheduling/clock";
import { localDateOf } from "../scheduling/time";
import { getActiveEnrollments } from "../companion/store";
import { billingOf } from "./membership";

// The one-time "your membership has started" text. The webhook runs on
// Vercel and can't reach iMessage directly, so it drops a transactional
// delivery into the queue; the bridge dispatcher sends it within a minute.
// Transactional deliveries aren't membership-gated, and they still respect
// STOP (consent revoked suppresses them).

const USERS = "imessageUsers";
const PREFS = "deliveryPreferences";
const PRODUCT_NAME = "Dharma Companion";

export interface MembershipStartedContext {
  trialing: boolean;
  /** e.g. "Sunday, Aug 17" — when the first $5 charge lands (trial only). */
  firstChargeDay?: string | null;
  /** They already have an active program or Daily Dharma running. */
  hasLessonPlan: boolean;
  /** Onboarding is mid-flight — its own questions will pick the plan. */
  onboardingInProgress: boolean;
}

/**
 * Compose the welcome. Beyond confirming the membership, it moves setup
 * forward: an already-enrolled member is told their lessons continue, a
 * mid-onboarding user is pointed back to the pending setup question, and
 * everyone else is asked what they'd like to learn — their free-form reply
 * lands in the account agent, which picks and enrolls the right program.
 */
export function membershipStartedBody(ctx: MembershipStartedContext): string {
  const opener = ctx.trialing
    ? `Your ${PRODUCT_NAME} membership has started 🙏 Your free week is underway` +
      `${ctx.firstChargeDay ? ` — the first $5 charge comes on ${ctx.firstChargeDay}` : ""}, ` +
      `and daily teachings and unlimited questions are yours now. You can cancel anytime just ` +
      `by texting me.`
    : `Your ${PRODUCT_NAME} membership is active 🙏 Daily teachings and unlimited questions ` +
      `are yours. You can cancel anytime just by texting me.`;
  if (ctx.hasLessonPlan) {
    return `${opener}\n\nYour daily lessons continue as scheduled — nothing else to do.`;
  }
  if (ctx.onboardingInProgress) {
    return `${opener}\n\nLet's finish getting you set up — just answer my last question whenever you're ready.`;
  }
  return (
    `${opener}\n\nNow, let's find the right plan for you. What would you like to learn about — ` +
    `the Bhagavad Gita, the foundations of Hinduism, stories to share with your family, karma ` +
    `and dharma, or building a daily practice? Tell me in your own words and I'll set up your ` +
    `daily lessons.`
  );
}

/**
 * Queue the welcome text for a freshly completed checkout. Exactly once per
 * subscription — the user doc remembers which subscription was announced, so
 * webhook replays and renewal payments never re-trigger it, while a genuine
 * re-subscribe months later (new subscription id) is announced again.
 */
export async function queueMembershipStartedText(
  db: Firestore,
  handleId: string,
  subscriptionId: string
): Promise<boolean> {
  const ref = db.collection(USERS).doc(handleId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const user = (snap.data() ?? {}) as {
    handle?: string;
    chatGuid?: string;
    membershipStartNoticeFor?: string;
    onboardingV2State?: string;
    billing?: unknown;
  };
  if (!user.handle) return false;
  if (user.membershipStartNoticeFor === subscriptionId) return false;

  const prefsSnap = await db.collection(PREFS).doc(handleId).get();
  const prefs = (prefsSnap.data() ?? {}) as { timezone?: string; dailyDharmaEnabled?: boolean };
  const tz = prefs.timezone ?? process.env.DEFAULT_TIMEZONE ?? "America/Chicago";

  const billing = billingOf(user);
  const trialing = billing?.status === "trialing";
  const enrollments = await getActiveEnrollments(db, handleId);
  const body = membershipStartedBody({
    trialing,
    firstChargeDay:
      trialing && billing?.trialEnd
        ? DateTime.fromMillis(billing.trialEnd, { zone: tz }).toFormat("cccc, LLL d")
        : null,
    hasLessonPlan: enrollments.length > 0 || prefs.dailyDharmaEnabled === true,
    onboardingInProgress:
      user.onboardingV2State !== undefined && user.onboardingV2State !== "completed",
  });

  // Mark before enqueue: a crash between the two risks a missed welcome, the
  // other order risks a double text on webhook retry. Missing is the lesser
  // harm for a courtesy message.
  await ref.set(
    { membershipStartNoticeFor: subscriptionId, updatedAt: Date.now() },
    { merge: true }
  );
  const now = Date.now();
  await enqueueDelivery(
    { store: new FirestoreDeliveryStore(db), clock: systemClock },
    {
      userId: handleId,
      recipientHandle: user.handle,
      recipientChatGuid: user.chatGuid,
      provider: "bluebubbles",
      deliveryType: "transactional",
      scheduledAt: now,
      scheduledLocalDate: localDateOf(now, tz),
      timezone: tz,
      variant: `membership-started-${subscriptionId}`,
      renderedMessage: body,
    }
  );
  return true;
}
