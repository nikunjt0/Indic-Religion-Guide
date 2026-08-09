import type { SubscriptionTier } from "./types/companion";

// Central entitlement service (spec §23). Billing is not implemented yet;
// every check flows through here so gating never gets hardcoded into UI or
// message flows. When Stripe lands, only tierFor() changes.

export interface EntitlementSubject {
  subscriptionTier?: SubscriptionTier;
  subscriptionStatus?: "active" | "trialing" | "past_due" | "canceled";
}

const TIER_ORDER: SubscriptionTier[] = ["free", "individual", "family"];

export function tierFor(subject: EntitlementSubject): SubscriptionTier {
  if (subject.subscriptionStatus === "canceled" || subject.subscriptionStatus === "past_due") {
    return "free";
  }
  return subject.subscriptionTier ?? "free";
}

function atLeast(subject: EntitlementSubject, tier: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(tierFor(subject)) >= TIER_ORDER.indexOf(tier);
}

/** Free tier gets a bounded daily question allowance; paid tiers more. */
const QUESTION_ALLOWANCE: Record<SubscriptionTier, number> = {
  free: 10,
  individual: 100,
  family: 100,
};

export const entitlements = {
  canAskQuestion(subject: EntitlementSubject, questionsToday: number): boolean {
    return questionsToday < QUESTION_ALLOWANCE[tierFor(subject)];
  },
  getRemainingQuestionAllowance(subject: EntitlementSubject, questionsToday: number): number {
    return Math.max(0, QUESTION_ALLOWANCE[tierFor(subject)] - questionsToday);
  },
  canEnrollInProgram(subject: EntitlementSubject, requiredTier: SubscriptionTier): boolean {
    return atLeast(subject, requiredTier);
  },
  canUseFamilyMode(subject: EntitlementSubject): boolean {
    return atLeast(subject, "family");
  },
  canAccessAdvancedSources(subject: EntitlementSubject): boolean {
    return atLeast(subject, "individual");
  },
  canReceiveDailyMessages(_subject: EntitlementSubject): boolean {
    return true; // one daily teaching is part of the free promise
  },
};
