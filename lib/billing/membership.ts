// Membership state stored on imessageUsers/{handleId}.billing and the pure
// access rules derived from it. Stripe is the source of truth; these fields
// are a synced mirror (webhook + the bridge's own writes after cancel/resume),
// so access checks never need a network call on the send path.

export type MembershipStatus = "none" | "trialing" | "active" | "past_due" | "canceled";

export interface BillingState {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: MembershipStatus;
  /** True when the subscription will not renew (cancel_at_period_end). */
  cancelAtPeriodEnd: boolean;
  /**
   * Epoch ms of the end of the paid/trial period. This is the "you keep
   * access until" date: a cancel (during trial or mid-month) leaves access
   * on until this instant.
   */
  accessUntil: number | null;
  /** Epoch ms trial end, when the subscription started with a trial. */
  trialEnd?: number | null;
  updatedAt: number;
}

/**
 * Can this user receive proactive (scheduled) messages?
 *
 * - trialing/active: yes — Stripe keeps these statuses until the period end
 *   even when the user has already canceled (cancel_at_period_end).
 * - canceled: only while the already-paid period (accessUntil) lasts.
 * - past_due: payment failed at renewal — no access until Stripe recovers
 *   the payment (an update webhook flips the status back to active).
 * - none / no billing record: never subscribed — no scheduled messages.
 */
export function hasMessagingAccess(billing: BillingState | null | undefined, nowMs: number): boolean {
  if (!billing) return false;
  if (billing.status === "trialing" || billing.status === "active") return true;
  if (billing.status === "canceled") {
    return billing.accessUntil !== null && billing.accessUntil > nowMs;
  }
  return false;
}

/** Map a raw Stripe subscription status onto our stored status. */
export function membershipStatusFromStripe(stripeStatus: string): MembershipStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    // incomplete/incomplete_expired: checkout never finished — treat as none.
    case "incomplete":
    case "incomplete_expired":
      return "none";
    default:
      return "canceled";
  }
}
