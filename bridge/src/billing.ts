import { DateTime } from "luxon";
import { imessageUsersCol } from "./firestore.ts";
import { log } from "./logger.ts";
import {
  billingOf,
  hasFullAccess,
  hasMessagingAccess,
  isFreeTestingUser,
  type BillingState,
  type MembershipUserDoc,
} from "../../lib/billing/membership.ts";
import {
  billingStateFrom,
  cancelSubscriptionAtPeriodEnd,
  reactivateSubscription,
  signupLinkFor,
  StripeError,
} from "../../lib/billing/stripe.ts";

// Membership plumbing for the bridge: the send-time access gate, the personal
// signup link, and the cancel/resume tool executors. Stripe is the source of
// truth; after every Stripe write we mirror the result onto the user doc so
// the dispatcher and the agent snapshot see it immediately (the webhook would
// get there too, just seconds later).

export { billingOf, isFreeTestingUser, signupLinkFor };

export const MEMBERSHIP_PRICE_TEXT = "$5/month with a 1-week free trial — cancel anytime";
const PRODUCT_NAME = "Dharma Companion";

/** Send-time gate for scheduled deliveries (EngineDeps.hasAccess). */
export async function userHasMessagingAccess(userId: string): Promise<boolean> {
  const snap = await imessageUsersCol().doc(userId).get();
  return hasFullAccess((snap.data() as MembershipUserDoc | undefined) ?? {}, Date.now());
}

/**
 * The paywall reply for a guru question from someone without access (and not
 * a comped tester). Returns null when access is fine — or when no payment
 * link is configured, in which case we fail open rather than lock everyone
 * out with no way to subscribe.
 */
export function membershipRequiredMessage(
  user: MembershipUserDoc & { handleId: string }
): string | null {
  if (hasFullAccess(user, Date.now())) return null;
  const link = signupLinkFor(user.handleId);
  if (!link) return null;
  const billing = billingOf(user);
  if (!billing || billing.status === "none") {
    // Someone who has never subscribed may never have been greeted at all —
    // this is often their literal first impression, so it must welcome and
    // explain before it asks for anything.
    return (
      `Namaste, and welcome! 🙏 I'm your Hindu Guru. I can text you one short teaching each ` +
      `day on dharma, scripture, and Hindu traditions at a time you choose — and you can ask ` +
      `me any question, anytime, about a verse, a ritual, a festival, or anything you've ` +
      `wondered about.\n\n` +
      `All of that comes with ${PRODUCT_NAME} — ${MEMBERSHIP_PRICE_TEXT}. Start your free ` +
      `week here (Apple Pay works): ${link}`
    );
  }
  return (
    `Your ${PRODUCT_NAME} membership has ended, so I can't answer questions or send teachings ` +
    `right now — your progress is saved. Restart anytime (${MEMBERSHIP_PRICE_TEXT}): ${link}`
  );
}

function formatDay(ms: number, timezone: string): string {
  return DateTime.fromMillis(ms, { zone: timezone }).toFormat("cccc, LLL d");
}

async function writeBilling(userId: string, billing: BillingState): Promise<void> {
  const paying = hasMessagingAccess(billing, Date.now());
  await imessageUsersCol()
    .doc(userId)
    .set(
      {
        billing,
        subscriptionTier: paying ? "individual" : "free",
        subscriptionStatus: billing.status === "none" ? "canceled" : billing.status,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
}

/**
 * Cancel at period end. Returns model-facing JSON: either the confirmed
 * cancellation with the last day of access, or an error object telling the
 * agent what to say instead.
 */
export async function cancelMembership(userId: string, timezone: string): Promise<unknown> {
  const snap = await imessageUsersCol().doc(userId).get();
  const billing = billingOf((snap.data() as { billing?: unknown } | undefined) ?? {});
  if (!billing?.stripeSubscriptionId || billing.status === "none") {
    return {
      error: "no-membership",
      note:
        "They have no paid membership to cancel — nothing is billing them. If they want the texts to stop too, offer to pause or opt out.",
    };
  }
  if (billing.status === "canceled" || billing.cancelAtPeriodEnd) {
    return {
      status: "already-canceled",
      accessUntil: billing.accessUntil ? formatDay(billing.accessUntil, timezone) : null,
      note: "Their membership was already canceled — no further charges are coming.",
    };
  }
  try {
    const sub = await cancelSubscriptionAtPeriodEnd(billing.stripeSubscriptionId);
    const updated = billingStateFrom(sub, Date.now());
    await writeBilling(userId, updated);
    log.info(`membership canceled at period end for ${userId}`, {
      accessUntil: updated.accessUntil,
    });
    return {
      status: "canceled",
      accessUntil: updated.accessUntil ? formatDay(updated.accessUntil, timezone) : null,
      note:
        "Billing is stopped — they will not be charged again. Access and daily texts continue until accessUntil; confirm that date to them plainly.",
    };
  } catch (err) {
    log.error(`cancelMembership failed for ${userId}:`, err);
    return {
      error: "cancel-failed",
      detail: err instanceof StripeError ? err.message : String(err),
      note:
        "The cancellation did not go through on the billing system. Apologize, say you couldn't complete it just now, and ask them to try again in a few minutes — do NOT tell them it's canceled.",
    };
  }
}

/** Undo a pending cancellation while the paid period is still running. */
export async function resumeMembership(userId: string, timezone: string): Promise<unknown> {
  const snap = await imessageUsersCol().doc(userId).get();
  const billing = billingOf((snap.data() as { billing?: unknown } | undefined) ?? {});
  const signupUrl = signupLinkFor(userId);
  if (!billing?.stripeSubscriptionId || billing.status === "none") {
    return {
      error: "no-membership",
      signupUrl,
      note: "They never had a membership — share the signup link so they can start the free trial.",
    };
  }
  if (billing.status === "canceled") {
    return {
      error: "membership-ended",
      signupUrl,
      note:
        "The old membership already ended and cannot be resumed — share the signup link so they can restart.",
    };
  }
  if (!billing.cancelAtPeriodEnd) {
    return {
      status: "already-active",
      note: "Their membership was never canceled — nothing to resume.",
    };
  }
  try {
    const sub = await reactivateSubscription(billing.stripeSubscriptionId);
    const updated = billingStateFrom(sub, Date.now());
    await writeBilling(userId, updated);
    log.info(`membership cancellation undone for ${userId}`);
    return {
      status: "resumed",
      renewsOn: updated.accessUntil ? formatDay(updated.accessUntil, timezone) : null,
      note: "The membership continues as before and will renew normally.",
    };
  } catch (err) {
    log.error(`resumeMembership failed for ${userId}:`, err);
    return {
      error: "resume-failed",
      detail: err instanceof StripeError ? err.message : String(err),
      note:
        "Reactivating did not go through. Apologize and ask them to try again in a few minutes — do NOT tell them it's resumed.",
    };
  }
}
