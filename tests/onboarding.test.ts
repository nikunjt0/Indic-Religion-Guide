import { describe, expect, it } from "vitest";
import {
  stepOnboarding,
  welcomeMessage,
  type OnboardingContext,
  type OnboardingState,
} from "../lib/onboarding/machine";

const ctx: OnboardingContext = {
  productName: "Dharma Companion",
  defaultTimezone: "America/Chicago",
};

function run(
  state: OnboardingState,
  inputs: string[]
): { state: OnboardingState; patches: Record<string, unknown>; lastReplies: string[] } {
  let s = state;
  const patches: Record<string, unknown> = {};
  let lastReplies: string[] = [];
  for (const input of inputs) {
    const r = stepOnboarding(s, input, ctx);
    s = r.nextState;
    Object.assign(patches, r.patch);
    lastReplies = r.replies;
  }
  return { state: s, patches, lastReplies };
}

describe("welcome message pricing", () => {
  it("includes price, free trial, and the personal signup link when configured", () => {
    const msg = welcomeMessage({
      ...ctx,
      signupUrl: "https://buy.stripe.com/test?client_reference_id=abc123",
    });
    expect(msg).toContain("$5 a month with a 1-week free trial");
    expect(msg).toContain("cancel anytime");
    expect(msg).toContain("https://buy.stripe.com/test?client_reference_id=abc123");
    // Consent instructions still close the message.
    expect(msg).toContain("Reply START to begin");
  });

  it("omits the pricing paragraph when no signup link is configured", () => {
    expect(welcomeMessage(ctx)).not.toContain("$5");
  });
});

describe("onboarding state machine", () => {
  it("welcome message includes consent framing", () => {
    const msg = welcomeMessage(ctx);
    expect(msg).toContain("Reply START");
    expect(msg).toContain("STOP");
  });

  it("completes the happy path", () => {
    const { state, patches } = run("awaiting-consent", [
      "START",
      "Nikunj",
      "3", // teach my children
      "1", // beginner
      "1", // not sure
      "2", // english with sanskrit
      "7:30 am",
      "yes",
      "1", // hinduism-101
      "TOMORROW",
    ]);
    expect(state).toBe("completed");
    expect(patches).toMatchObject({
      consentGranted: true,
      displayName: "Nikunj",
      primaryGoal: "teach-children",
      experienceLevel: "beginner",
      traditionPreference: "not-sure",
      preferredLanguage: "english-with-sanskrit",
      preferredLocalTime: "07:30",
      timezone: "America/Chicago",
      selectedProgram: "hinduism-101",
      startImmediately: false,
    });
  });

  it("accepts natural-language answers", () => {
    const r = stepOnboarding("awaiting-goal", "I want to teach my kids about our culture", ctx);
    expect(r.nextState).toBe("awaiting-level");
    expect(r.patch.primaryGoal).toBe("teach-children");
  });

  it("does not record consent without an affirmative reply", () => {
    const r = stepOnboarding("awaiting-consent", "hmm maybe later", ctx);
    expect(r.nextState).toBe("awaiting-consent");
    expect(r.patch.consentGranted).toBeUndefined();
  });

  it("STOP works from any state", () => {
    const r = stepOnboarding("awaiting-language", "STOP", ctx);
    expect(r.patch.consentGranted).toBe(false);
    expect(r.replies[0]).toContain("opted out");
  });

  it("does not treat commands or questions as names", () => {
    const cmd = stepOnboarding("awaiting-name", "HELP", ctx);
    expect(cmd.nextState).toBe("awaiting-name");
    const q = stepOnboarding("awaiting-name", "what is dharma?", ctx);
    expect(q.nextState).toBe("awaiting-name");
    expect(q.deflected).toBe(true);
  });

  it("strips name prefixes", () => {
    const r = stepOnboarding("awaiting-name", "I'm Priya", ctx);
    expect(r.patch.displayName).toBe("Priya");
  });

  it("converts dayparts to a concrete time and confirms", () => {
    const r = stepOnboarding("awaiting-delivery-time", "after dinner", ctx);
    expect(r.nextState).toBe("awaiting-timezone-confirmation");
    expect(r.patch.preferredLocalTime).toBe("19:30");
    expect(r.replies[0]).toContain("7:30 PM");
  });

  it("asks for AM or PM when delivery time is ambiguous", () => {
    const r = stepOnboarding("awaiting-delivery-time", "6:25", ctx);
    expect(r.nextState).toBe("awaiting-delivery-time");
    expect(r.patch.preferredLocalTime).toBeUndefined();
    expect(r.replies[0]).toContain("AM or PM");
  });

  it("re-asks on unparseable time", () => {
    const r = stepOnboarding("awaiting-delivery-time", "whenever works", ctx);
    expect(r.nextState).toBe("awaiting-delivery-time");
  });

  it("accepts a corrected timezone by city name", () => {
    const r = stepOnboarding("awaiting-timezone-confirmation", "I'm in Mumbai actually", ctx);
    expect(r.nextState).toBe("awaiting-program-selection");
    expect(r.patch.timezone).toBe("Asia/Kolkata");
  });

  it("keeps a corrected delivery time while confirming timezone", () => {
    const r = stepOnboarding(
      "awaiting-timezone-confirmation",
      "Yes but actually switch to 6:10 pm",
      ctx
    );
    expect(r.nextState).toBe("awaiting-program-selection");
    expect(r.patch).toMatchObject({
      preferredLocalTime: "18:10",
      timezone: "America/Chicago",
    });
  });

  it("flags mid-flow questions as deflected without losing the step", () => {
    const r = stepOnboarding("awaiting-tradition", "Wait — what is the difference between Shaiva and Vaishnava?", ctx);
    expect(r.nextState).toBe("awaiting-tradition");
    expect(r.deflected).toBe(true);
  });

  it("NOW starts immediately", () => {
    const r = stepOnboarding("awaiting-start-choice", "now", ctx);
    expect(r.nextState).toBe("completed");
    expect(r.patch.startImmediately).toBe(true);
  });
});
