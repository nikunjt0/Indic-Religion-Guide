import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  client = new OpenAI({ apiKey });
  return client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
// Text chat model. gpt-4.1 (not the smaller gpt-4o-mini) because the Guru
// answer has to be *specific* — name the herb, the verse, the step — and a
// small model collapses into generic, hedged advice no matter how strict the
// system prompt is. gpt-4.1 follows the imperative-and-cite instructions far
// more faithfully.
export const CHAT_MODEL = "gpt-4.1";
// Conversational account agent (enrollment, scheduling, pausing). Full-size
// model: it composes user-facing replies and orchestrates tool calls, and a
// mini model reads as exactly the phone-bot voice we're avoiding.
export const COMPANION_AGENT_MODEL = process.env.COMPANION_AGENT_MODEL ?? CHAT_MODEL;
// Vision-capable model. Used when the user's turn includes image attachments
// (or video frames extracted client-side). Same gpt-4.1 family as the text
// model: stronger visual reasoning and a large context window for the keyframe
// sequences a video expands into.
export const VISION_CHAT_MODEL = "gpt-4.1";
// Follow-up condenser (lib/rag/condense.ts): rewrites a follow-up into a
// standalone retrieval question. A mechanical rewrite, not a user-facing
// answer, so the mini tier is fine here — the "no minis" note on CHAT_MODEL
// is about composing the Guru's reply.
export const CONDENSE_MODEL = "gpt-4.1-mini";
// Speech-to-text model for audio attachments and the audio track lifted out
// of videos. gpt-4o-transcribe supersedes whisper-1 with better accuracy on
// accented English, Sanskrit terms, and noisy ritual recordings.
export const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
