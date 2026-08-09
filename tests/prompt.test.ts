import { describe, expect, it } from "vitest";
import {
  RESPONSE_STYLE_POLICY,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_SMS,
  buildUserPrompt,
  PROMPT_VERSION,
  PROMPT_VERSION_SMS,
} from "../lib/rag/prompt";

describe("RAG response style policy", () => {
  it("is shared by web and SMS system prompts", () => {
    expect(PROMPT_VERSION).toBe("v10-synthesis");
    expect(PROMPT_VERSION_SMS).toBe("v5-synthesis-sms");
    expect(RESPONSE_STYLE_POLICY).toContain("Synthesize first");
    expect(RESPONSE_STYLE_POLICY).toContain("at most 1 short direct quote");
    expect(RESPONSE_STYLE_POLICY).toContain("Explain unfamiliar concepts immediately");
    expect(RESPONSE_STYLE_POLICY).toContain("Rank recommendations");
    expect(RESPONSE_STYLE_POLICY).toContain("Do not turn every retrieved passage into an imperative");
    expect(SYSTEM_PROMPT).toContain(RESPONSE_STYLE_POLICY);
    expect(SYSTEM_PROMPT_SMS).toContain(RESPONSE_STYLE_POLICY);
  });

  it("builds SMS prompts that forbid source-list answers", () => {
    const prompt = buildUserPrompt({
      question: "What should I eat to make my headache go away?",
      profile: null,
      guides: [],
      smsMode: true,
      sources: [
        {
          index: 1,
          source_title: "The Complete Book of Ayurvedic Home Remedies",
          quotes: [
            {
              chapter: null,
              verse: null,
              page: 193,
              text: "EAT SOMETHING SWEET. Sometimes a pitta headache responds quickly...",
            },
          ],
        },
      ],
    });

    expect(prompt).toContain("Synthesize first in 2–4 sentences");
    expect(prompt).toContain("use at most 1 short quote");
    expect(prompt).toContain("rank the most relevant guidance first");
    expect(prompt).toContain("Do not emit a Sources line");
    expect(prompt).toContain("the bridge appends compact citations and the source URL");
  });
});
