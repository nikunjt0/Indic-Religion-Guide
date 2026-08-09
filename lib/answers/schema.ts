import { z } from "zod";

// Structured answer contract for the refactored answer engine (spec §14.3).
// The model returns JSON matching this schema; the server validates before
// anything is rendered or sent. Malformed output never reaches a user.

export const sourceCitationSchema = z.object({
  title: z.string().min(1),
  reference: z.string().optional(), // chapter/verse/page, e.g. "Bhagavad Gita 2.47"
  translatorOrEdition: z.string().optional(),
  tradition: z.string().optional(),
  sourceType: z
    .enum([
      "shruti",
      "smriti",
      "itihasa",
      "purana",
      "darshana",
      "commentary",
      "bhakti",
      "ritual-manual",
      "historical-legal",
      "ayurveda",
      "modern-teacher",
      "academic",
      "other",
    ])
    .default("other"),
  historicalContext: z.string().optional(),
});

export const perspectiveSchema = z.object({
  tradition: z.string().min(1), // e.g. "Advaita Vedanta", "many Vaishnava communities"
  view: z.string().min(1),
});

export const structuredAnswerSchema = z.object({
  directAnswer: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  answerType: z.enum(["doctrine", "practice", "custom", "story", "wellness", "other"]),
  consensusLevel: z.enum([
    "broad-agreement",
    "multiple-interpretations",
    "school-dependent",
    "historical-not-normative",
    "modern-practice-differs",
  ]),
  perspectives: z.array(perspectiveSchema).default([]),
  historicalContext: z.string().optional(),
  modernContext: z.string().optional(),
  practicalTakeaway: z.string().optional(),
  sources: z.array(sourceCitationSchema).default([]),
  safetyFlags: z.array(z.string()).default([]),
  followUpOptions: z
    .array(z.enum(["DEEPER", "SOURCE", "KIDS", "COMPARE", "PRACTICE", "STORY"]))
    .max(3)
    .default([]),
  childVersion: z.string().optional(),
  shortTextVersion: z.string().min(1), // SMS-ready plain text
  publicPageEligible: z.boolean().default(false),
  reviewRequired: z.boolean().default(false),
});

export type StructuredAnswer = z.infer<typeof structuredAnswerSchema>;

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export interface ValidationSuccess {
  ok: true;
  answer: StructuredAnswer;
}

/** Parse and validate raw model output (string or object). Never throws. */
export function validateStructuredAnswer(
  raw: unknown
): ValidationSuccess | ValidationFailure {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { ok: false, errors: ["output is not valid JSON"] };
    }
  }
  const result = structuredAnswerSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, answer: result.data };
}

/**
 * Render the SMS body from a validated answer: answer first, one idea, source
 * label, at most three follow-up options.
 */
export function renderSmsAnswer(answer: StructuredAnswer): string {
  const parts: string[] = [answer.shortTextVersion.trim()];
  const primarySource = answer.sources[0];
  if (primarySource && !answer.shortTextVersion.includes(primarySource.title)) {
    parts.push(
      `Source: ${primarySource.title}${primarySource.reference ? ` (${primarySource.reference})` : ""}`
    );
  }
  if (answer.followUpOptions.length > 0) {
    parts.push(`Reply ${answer.followUpOptions.join(", ")}.`);
  }
  return parts.join("\n\n");
}
