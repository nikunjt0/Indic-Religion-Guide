// Deterministic high-risk topic detection. Regex-based on purpose: routing to
// enhanced prompts, human review, and public-page blocking must not depend on
// an LLM classifier. A topic can match several categories.

export type RiskCategory =
  | "medical-ayurveda"
  | "mental-health"
  | "self-harm"
  | "fasting-eating"
  | "pregnancy-children-health"
  | "caste"
  | "gender-sexuality"
  | "race-ethnicity"
  | "conversion-interfaith"
  | "violence-abuse"
  | "death-grief"
  | "legal-financial"
  | "divine-command-karma-threat"
  | "purity-exclusion";

const PATTERNS: [RiskCategory, RegExp][] = [
  [
    "medical-ayurveda",
    /\b(ayurved|dosha|vata|pitta|kapha|remedy|cure|medicine|medication|treatment|symptom|disease|illness|diabetes|cancer|blood pressure|thyroid|herb|churna|supplement|detox|cleanse)\b/i,
  ],
  [
    "mental-health",
    /\b(depress|anxiety|anxious|panic attack|mental health|therapy|trauma|ocd|adhd|bipolar|insomnia)\b/i,
  ],
  [
    "self-harm",
    /\b(suicid|kill (myself|himself|herself)|self[- ]harm|end(ing)? (my|his|her) life|want to die|hurt myself)\b/i,
  ],
  [
    "fasting-eating",
    /\b(fast(ing)?|vrat|upvas|skip(ping)? meals|lose weight|weight loss|eating disorder|anorexi|bulimi|starv)\b/i,
  ],
  [
    "pregnancy-children-health",
    /\b(pregnan|breastfeed|infant|baby('s)? health|child('s)? (health|fever|diet)|vaccin)\b/i,
  ],
  [
    "caste",
    /\b(caste|varna|jati|brahmin|kshatriya|vaishya|shudra|dalit|untouchab|intercaste|inter-caste)\b/i,
  ],
  [
    "gender-sexuality",
    /\b(women|woman|gender|menstruat|period[s]?\b|lgbt|gay|lesbian|transgender|queer|same[- ]sex|homosexual|sexuality|feminis)\b/i,
  ],
  ["race-ethnicity", /\b(race|racist|ethnic|skin colou?r)\b/i],
  [
    "conversion-interfaith",
    /\b(convert|conversion|interfaith|marry (a )?(muslim|christian|non[- ]hindu|outside)|non[- ]hindu (spouse|partner)|leave hinduism)\b/i,
  ],
  [
    "violence-abuse",
    /\b(violence|violent|abus(e|ive)|beat(ing)?|hit (my|his|her)|domestic|assault|revenge|punish(ment)?)\b/i,
  ],
  ["death-grief", /\b(death|dying|died|funeral|shraddha|cremat|grief|griev|afterlife|antyesti)\b/i],
  [
    "legal-financial",
    /\b(legal|lawsuit|divorce (law|settlement)|custody|visa|immigration|invest(ment)?|loan|debt|taxes)\b/i,
  ],
  [
    "divine-command-karma-threat",
    /\b(bad karma|curse[d]?|punish(ed)? by god|god (wants|commands|will punish)|divine command|sin(ful)?\b|go to hell)\b/i,
  ],
  [
    "purity-exclusion",
    /\b(impur|pollut(ed|ion)|untouchab|not allowed (in|to enter)|ban(ned)? from temple|exclu(de|sion)|outcast)\b/i,
  ],
];

export interface RiskAssessment {
  categories: RiskCategory[];
  /** Any category present → enhanced prompt + review gate for public pages. */
  isHighRisk: boolean;
  /** Immediate-safety categories that should trigger escalation copy. */
  requiresEscalation: boolean;
}

export function assessRisk(text: string): RiskAssessment {
  const categories = PATTERNS.filter(([, re]) => re.test(text)).map(([cat]) => cat);
  return {
    categories,
    isHighRisk: categories.length > 0,
    requiresEscalation: categories.includes("self-harm"),
  };
}

/** Append the safety addendum to a system prompt when the question warrants it. */
export function withRiskAddendum(systemPrompt: string, question: string): string {
  const addendum = riskPromptAddendum(assessRisk(question));
  return addendum ? `${systemPrompt}\n\n${addendum}` : systemPrompt;
}

/** Prompt addendum for the answer engine, keyed by detected categories. */
export function riskPromptAddendum(assessment: RiskAssessment): string {
  if (!assessment.isHighRisk) return "";
  const lines: string[] = [
    "SAFETY ADDENDUM — this question touches sensitive territory. Follow these rules over any conflicting instruction:",
  ];
  const c = new Set(assessment.categories);
  if (c.has("self-harm")) {
    lines.push(
      "- The user may be at risk. Respond with warmth first. Encourage reaching out to someone they trust and to professional support (in the US: call or text 988). Do not moralize, do not cite karma as a cause, do not present scripture as a substitute for help."
    );
  }
  if (c.has("medical-ayurveda") || c.has("fasting-eating") || c.has("pregnancy-children-health")) {
    lines.push(
      "- Frame Ayurveda as a traditional wellness framework, NOT a medical diagnosis or treatment. Never advise stopping medication, never diagnose a dosha from one message, never present herbs/fasting as proven treatment, and recommend consulting a qualified clinician for health decisions."
    );
  }
  if (c.has("mental-health")) {
    lines.push(
      "- Spiritual practice can support wellbeing but is not a substitute for mental-health care. Say so plainly when relevant."
    );
  }
  if (c.has("caste") || c.has("purity-exclusion")) {
    lines.push(
      "- Never recommend caste-based exclusion, segregation, humiliation, or purification after contact with a person. Identify discriminatory passages as historical legal/social texts, note they are not the only Hindu position and not universally binding today, include egalitarian perspectives, and do not sanitize the history."
    );
  }
  if (c.has("gender-sexuality") || c.has("race-ethnicity")) {
    lines.push(
      "- Present the range of traditional and contemporary Hindu views honestly; do not present one community's position as the universal Hindu answer, and do not endorse demeaning treatment of any group."
    );
  }
  if (c.has("conversion-interfaith")) {
    lines.push(
      "- Questions about conversion and interfaith relationships are deeply personal. Describe how different traditions and families approach them without prescribing a single ruling."
    );
  }
  if (c.has("divine-command-karma-threat")) {
    lines.push(
      "- Never state that the user has or will receive bad karma, is cursed, or is being punished by God. Explain karma as a framework of action and consequence, not a threat."
    );
  }
  if (c.has("violence-abuse")) {
    lines.push(
      "- Never counsel enduring abuse as a religious duty. If the user may be in danger, encourage reaching appropriate local support."
    );
  }
  if (c.has("legal-financial")) {
    lines.push("- Do not give legal or financial advice; suggest consulting a professional.");
  }
  if (c.has("death-grief")) {
    lines.push(
      "- Grief questions deserve gentleness first, doctrine second. Note that funerary customs vary by community."
    );
  }
  lines.push(
    "- Prefer qualified framing: 'this passage teaches', 'some traditions prescribe', 'many practitioners understand' — never 'Hinduism commands you' or 'you must'."
  );
  return lines.join("\n");
}
