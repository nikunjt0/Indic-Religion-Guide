import { membershipStatusFromStripe, type BillingState } from "./membership";

// Thin fetch-based Stripe client — the only three calls we need (fetch,
// cancel-at-period-end, reactivate) don't justify the SDK dependency in both
// the bridge and the Next app. The API version is pinned so response shapes
// (top-level current_period_end in particular) don't drift with the account
// default.

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing required env var: STRIPE_SECRET_KEY");
  return key;
}

export class StripeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/** The subset of the Stripe subscription object we read. */
export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  /** Epoch seconds. Absent on newer API versions (moved to items). */
  current_period_end?: number;
  trial_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number }> };
}

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`,
      "Stripe-Version": STRIPE_VERSION,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as { message?: string; code?: string };
    throw new StripeError(err.message ?? `Stripe ${res.status}`, res.status, err.code);
  }
  return json;
}

export async function getSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return (await stripeRequest("GET", `/subscriptions/${subscriptionId}`)) as unknown as StripeSubscription;
}

/** Cancel at period end — access continues until the paid/trial period ends. */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string
): Promise<StripeSubscription> {
  return (await stripeRequest("POST", `/subscriptions/${subscriptionId}`, {
    cancel_at_period_end: "true",
  })) as unknown as StripeSubscription;
}

/** Undo a pending cancellation before the period ends. */
export async function reactivateSubscription(
  subscriptionId: string
): Promise<StripeSubscription> {
  return (await stripeRequest("POST", `/subscriptions/${subscriptionId}`, {
    cancel_at_period_end: "false",
  })) as unknown as StripeSubscription;
}

/** End of the current paid/trial period in epoch ms, across API versions. */
export function periodEndMs(sub: StripeSubscription): number | null {
  const seconds =
    sub.current_period_end ??
    (sub.items?.data ?? [])
      .map((i) => i.current_period_end ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
  return seconds ? seconds * 1000 : null;
}

/** Project a Stripe subscription onto our stored billing fields. */
export function billingStateFrom(sub: StripeSubscription, nowMs: number): BillingState {
  return {
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    status: membershipStatusFromStripe(sub.status),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    accessUntil: periodEndMs(sub),
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : null,
    updatedAt: nowMs,
  };
}

/**
 * The user's personal signup URL: the shared payment link plus a
 * client_reference_id, which comes back on checkout.session.completed and
 * ties the new Stripe subscription to their imessageUsers doc.
 */
export function signupLinkFor(handleId: string): string | null {
  const base = process.env.STRIPE_PAYMENT_LINK_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}?client_reference_id=${encodeURIComponent(handleId)}`;
}
