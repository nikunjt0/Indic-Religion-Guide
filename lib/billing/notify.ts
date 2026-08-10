import type { Firestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { enqueueDelivery } from "../scheduling/engine";
import { FirestoreDeliveryStore } from "../scheduling/firestore-store";
import { systemClock } from "../scheduling/clock";
import { localDateOf } from "../scheduling/time";
import { billingOf } from "./membership";

// The one-time "your membership has started" text. The webhook runs on
// Vercel and can't reach iMessage directly, so it drops a transactional
// delivery into the queue; the bridge dispatcher sends it within a minute.
// Transactional deliveries aren't membership-gated, and they still respect
// STOP (consent revoked suppresses them).

const USERS = "imessageUsers";
const PREFS = "deliveryPreferences";
const PRODUCT_NAME = "Dharma Companion";

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
    billing?: unknown;
  };
  if (!user.handle) return false;
  if (user.membershipStartNoticeFor === subscriptionId) return false;

  const prefsSnap = await db.collection(PREFS).doc(handleId).get();
  const tz =
    (prefsSnap.data() as { timezone?: string } | undefined)?.timezone ??
    process.env.DEFAULT_TIMEZONE ??
    "America/Chicago";

  const billing = billingOf(user);
  const trialing = billing?.status === "trialing";
  const firstChargeDay =
    trialing && billing?.trialEnd
      ? DateTime.fromMillis(billing.trialEnd, { zone: tz }).toFormat("cccc, LLL d")
      : null;
  const body = trialing
    ? `Your ${PRODUCT_NAME} membership has started 🙏 Your free week is underway` +
      `${firstChargeDay ? ` — the first $5 charge comes on ${firstChargeDay}` : ""}, and daily ` +
      `teachings and unlimited questions are yours now. You can cancel anytime by just texting ` +
      `me — say “cancel my membership” and you'll keep access through the end of your week.`
    : `Your ${PRODUCT_NAME} membership is active 🙏 Daily teachings and unlimited questions are ` +
      `yours. You can cancel anytime by just texting me — say “cancel my membership” and you'll ` +
      `keep access through the end of what you've paid for.`;

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
