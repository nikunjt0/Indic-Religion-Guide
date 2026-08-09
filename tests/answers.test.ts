import { describe, expect, it } from "vitest";
import { assessRisk, riskPromptAddendum, withRiskAddendum } from "../lib/answers/risk";
import { renderSmsAnswer, validateStructuredAnswer } from "../lib/answers/schema";

describe("risk detection", () => {
  it("flags Ayurveda/medical questions", () => {
    const r = assessRisk("What does Ayurveda say about my vata dosha and digestion?");
    expect(r.isHighRisk).toBe(true);
    expect(r.categories).toContain("medical-ayurveda");
  });

  it("flags caste questions", () => {
    const r = assessRisk("I am a Brahmin. Am I allowed to hang out with Dalits?");
    expect(r.categories).toContain("caste");
  });

  it("flags self-harm with escalation", () => {
    const r = assessRisk("I have been thinking about ending my life, what does karma say");
    expect(r.requiresEscalation).toBe(true);
  });

  it("flags fasting and karma threats", () => {
    expect(assessRisk("Should I fast to lose weight for Navratri?").categories).toContain(
      "fasting-eating"
    );
    expect(assessRisk("Will I get bad karma for skipping puja?").categories).toContain(
      "divine-command-karma-threat"
    );
  });

  it("does not flag ordinary doctrine questions", () => {
    const r = assessRisk("What is the meaning of Om?");
    expect(r.isHighRisk).toBe(false);
    expect(riskPromptAddendum(r)).toBe("");
  });

  it("addendum includes category-specific guidance and appends to prompts", () => {
    const base = "SYSTEM";
    const withCaste = withRiskAddendum(base, "Is caste discrimination required by Hinduism?");
    expect(withCaste).toContain("SYSTEM");
    expect(withCaste).toContain("caste-based exclusion");
    expect(withRiskAddendum(base, "What is a mala?")).toBe(base);
  });
});

describe("structured answer schema", () => {
  const valid = {
    directAnswer: "Karma means action and its consequences.",
    confidence: "high",
    answerType: "doctrine",
    consensusLevel: "broad-agreement",
    perspectives: [{ tradition: "Advaita", view: "..." }],
    sources: [{ title: "Bhagavad Gita", reference: "2.47", sourceType: "smriti" }],
    followUpOptions: ["DEEPER", "KIDS"],
    shortTextVersion: "Karma means action and consequence — not fate.",
    publicPageEligible: true,
    reviewRequired: false,
  };

  it("accepts valid output including fenced JSON strings", () => {
    const direct = validateStructuredAnswer(valid);
    expect(direct.ok).toBe(true);
    const fenced = validateStructuredAnswer("```json\n" + JSON.stringify(valid) + "\n```");
    expect(fenced.ok).toBe(true);
  });

  it("rejects malformed JSON and missing fields", () => {
    expect(validateStructuredAnswer("not json").ok).toBe(false);
    const missing = validateStructuredAnswer({ directAnswer: "x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.length).toBeGreaterThan(0);
  });

  it("rejects more than three follow-up options", () => {
    const bad = { ...valid, followUpOptions: ["DEEPER", "KIDS", "SOURCE", "STORY"] };
    expect(validateStructuredAnswer(bad).ok).toBe(false);
  });

  it("renders SMS: answer first, source label, reply options", () => {
    const parsed = validateStructuredAnswer(valid);
    if (!parsed.ok) throw new Error("expected valid");
    const sms = renderSmsAnswer(parsed.answer);
    expect(sms.startsWith("Karma means action")).toBe(true);
    expect(sms).toContain("Source: Bhagavad Gita (2.47)");
    expect(sms).toContain("Reply DEEPER, KIDS.");
  });
});
