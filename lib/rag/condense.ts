import { CONDENSE_MODEL, openai } from "../openai";

// How much conversation the condenser sees. The last few turns are enough to
// resolve "it"/"that" references; older turns only add tokens and drift.
const MAX_CONDENSE_TURNS = 6;
const MAX_TURN_CHARS = 600;

// The condenser exists because a follow-up embedded verbatim (or concatenated
// with the prior question) retrieves the SAME chunks the prior turn already
// used: "What will happen if I take it home?" after a question about an
// unclaimed charger is dominated by the charger scenario, so the user gets the
// identical Manu Smriti quote twice and never gets the consequences they asked
// about. Rewriting the follow-up into a standalone question keeps the referent
// (the charger) but foregrounds the NEW intent (what follows the act).
const CONDENSE_SYSTEM = `You rewrite the newest message in a conversation with a Hindu spiritual guide into ONE standalone question, used to vector-search a corpus of Hindu scripture, dharma-shastra, Ayurveda, and devotional poetry.

Rules:
- Resolve pronouns and references ("it", "that", "do this anyway") from the conversation so the question stands alone.
- Preserve the NEWEST message's intent exactly. If it asks about a different aspect than earlier turns — consequences ("what will happen"), punishment, atonement, exceptions, procedure, reasons, sources — the rewritten question must ask about THAT aspect. Never re-ask an earlier turn's question.
- Phrase the ask in the corpus's own terms where the mapping is obvious: "what will happen if I do X" is asking for the karmic consequences, prescribed penance/atonement, or punishment for X.
- At most 40 words. Output ONLY the rewritten question — no preamble, no quotes.`;

export interface CondenseTurn {
  role: "user" | "assistant";
  content: string;
}

// Pure prompt builder, split out so it can be unit-tested without an API call.
export function buildCondenseMessages(
  question: string,
  history: CondenseTurn[],
): { role: "system" | "user"; content: string }[] {
  const turns = history
    .slice(-MAX_CONDENSE_TURNS)
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Guide"}: ${m.content.slice(0, MAX_TURN_CHARS)}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: CONDENSE_SYSTEM },
    {
      role: "user",
      content: `CONVERSATION SO FAR:\n${turns}\n\nNEWEST MESSAGE:\n${question}\n\nStandalone retrieval question:`,
    },
  ];
}

// Rewrite a follow-up into a standalone retrieval question. Returns null when
// there is nothing to condense (no history) or the call fails — callers fall
// back to their existing retrieval query.
export async function condenseFollowUpQuestion(
  question: string,
  history: CondenseTurn[],
): Promise<string | null> {
  if (history.length === 0 || !question.trim()) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: CONDENSE_MODEL,
      temperature: 0,
      max_tokens: 80,
      messages: buildCondenseMessages(question, history),
    });
    const out = completion.choices[0]?.message?.content?.trim() ?? "";
    // A rambling or empty rewrite is worse than the fallback concatenation.
    if (!out || out.length > 400) return null;
    return out;
  } catch (err) {
    console.error("condenseFollowUpQuestion failed:", err);
    return null;
  }
}
