import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hasFullAccess,
  hasMessagingAccess,
  isFreeTestingUser,
  membershipStatusFromStripe,
  type BillingState,
} from "../lib/billing/membership";
import {
  billingStateFrom,
  periodEndMs,
  signupLinkFor,
  type StripeSubscription,
} from "../lib/billing/stripe";
import { verifyStripeSignature } from "../lib/billing/webhook";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const DAY = 86_400_000;

function billing(overrides: Partial<BillingState> = {}): BillingState {
  return {
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    cancelAtPeriodEnd: false,
    accessUntil: NOW + 20 * DAY,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("hasMessagingAccess", () => {
  it("denies users who never subscribed", () => {
    expect(hasMessagingAccess(null, NOW)).toBe(false);
    expect(hasMessagingAccess(undefined, NOW)).toBe(false);
    expect(hasMessagingAccess(billing({ status: "none" }), NOW)).toBe(false);
  });

  it("grants trialing and active members", () => {
    expect(hasMessagingAccess(billing({ status: "trialing" }), NOW)).toBe(true);
    expect(hasMessagingAccess(billing({ status: "active" }), NOW)).toBe(true);
  });

  it("keeps access through the paid period after a cancel, then ends it", () => {
    // While Stripe still reports active + cancel_at_period_end, access stays.
    expect(
      hasMessagingAccess(billing({ status: "active", cancelAtPeriodEnd: true }), NOW)
    ).toBe(true);
    // After the deletion webhook flips status to canceled: access lasts
    // exactly until accessUntil (end of the trial week / billed month).
    const canceled = billing({ status: "canceled", accessUntil: NOW + DAY });
    expect(hasMessagingAccess(canceled, NOW)).toBe(true);
    expect(hasMessagingAccess(canceled, NOW + DAY + 1)).toBe(false);
  });

  it("denies past_due until payment recovers", () => {
    expect(hasMessagingAccess(billing({ status: "past_due" }), NOW)).toBe(false);
  });
});

describe("hasFullAccess (freeTestingUser comp flag)", () => {
  it("grants comped testers regardless of billing", () => {
    expect(hasFullAccess({ freeTestingUser: true }, NOW)).toBe(true);
    expect(
      hasFullAccess(
        { freeTestingUser: true, billing: billing({ status: "canceled", accessUntil: NOW - DAY }) },
        NOW
      )
    ).toBe(true);
  });

  it("treats absent or non-true flag values as false", () => {
    expect(hasFullAccess({}, NOW)).toBe(false);
    expect(hasFullAccess({ freeTestingUser: false }, NOW)).toBe(false);
    // Firestore console typos ("true" as a string) must not grant access.
    expect(hasFullAccess({ freeTestingUser: "true" }, NOW)).toBe(false);
    expect(isFreeTestingUser({ freeTestingUser: 1 })).toBe(false);
  });

  it("falls through to billing for non-testers", () => {
    expect(hasFullAccess({ billing: billing({ status: "trialing" }) }, NOW)).toBe(true);
    expect(hasFullAccess({ billing: billing({ status: "past_due" }) }, NOW)).toBe(false);
  });
});

describe("stripe projection", () => {
  const sub: StripeSubscription = {
    id: "sub_1",
    customer: "cus_1",
    status: "trialing",
    cancel_at_period_end: false,
    current_period_end: Math.floor((NOW + 7 * DAY) / 1000),
    trial_end: Math.floor((NOW + 7 * DAY) / 1000),
  };

  it("maps a trialing subscription onto billing state", () => {
    expect(billingStateFrom(sub, NOW)).toEqual({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "trialing",
      cancelAtPeriodEnd: false,
      accessUntil: NOW + 7 * DAY,
      trialEnd: NOW + 7 * DAY,
      updatedAt: NOW,
    });
  });

  it("falls back to item-level period end (newer Stripe API shapes)", () => {
    const itemShaped: StripeSubscription = {
      ...sub,
      current_period_end: undefined,
      items: { data: [{ current_period_end: Math.floor((NOW + 30 * DAY) / 1000) }] },
    };
    expect(periodEndMs(itemShaped)).toBe(NOW + 30 * DAY);
  });

  it("maps stripe statuses conservatively", () => {
    expect(membershipStatusFromStripe("trialing")).toBe("trialing");
    expect(membershipStatusFromStripe("active")).toBe("active");
    expect(membershipStatusFromStripe("past_due")).toBe("past_due");
    expect(membershipStatusFromStripe("unpaid")).toBe("past_due");
    expect(membershipStatusFromStripe("incomplete")).toBe("none");
    expect(membershipStatusFromStripe("canceled")).toBe("canceled");
  });

  it("builds the personal signup link from the shared payment link", () => {
    const prev = process.env.STRIPE_PAYMENT_LINK_URL;
    process.env.STRIPE_PAYMENT_LINK_URL = "https://buy.stripe.com/test";
    try {
      expect(signupLinkFor("abc123")).toBe(
        "https://buy.stripe.com/test?client_reference_id=abc123"
      );
    } finally {
      if (prev === undefined) delete process.env.STRIPE_PAYMENT_LINK_URL;
      else process.env.STRIPE_PAYMENT_LINK_URL = prev;
    }
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1","type":"customer.subscription.updated"}';
  const nowSec = 1_770_000_000;

  function sign(ts: number, body: string = payload, key: string = secret): string {
    const sig = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v1=${sig}`;
  }

  it("accepts a valid signature within tolerance", () => {
    expect(verifyStripeSignature(payload, sign(nowSec - 60), secret, nowSec)).toBe(true);
  });

  it("rejects a tampered payload, wrong secret, or stale timestamp", () => {
    expect(
      verifyStripeSignature('{"id":"evt_2"}', sign(nowSec - 60), secret, nowSec)
    ).toBe(false);
    expect(
      verifyStripeSignature(payload, sign(nowSec - 60, payload, "whsec_other"), secret, nowSec)
    ).toBe(false);
    expect(verifyStripeSignature(payload, sign(nowSec - 3600), secret, nowSec)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, nowSec)).toBe(false);
    expect(verifyStripeSignature(payload, "t=,v1=", secret, nowSec)).toBe(false);
  });
});
