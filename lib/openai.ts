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
export const CHAT_MODEL = "gpt-4o-mini";
// Vision-capable model. Used only when the user's turn includes image
// attachments (or video frames extracted client-side) — gpt-4o-mini is
// text-only, so we cannot ship image content blocks to it. gpt-4.1 is the
// current-generation successor to gpt-4o: stronger visual reasoning, a larger
// context window for the keyframe sequences a video expands into, and cheaper.
export const VISION_CHAT_MODEL = "gpt-4.1";
// Speech-to-text model for audio attachments and the audio track lifted out
// of videos. gpt-4o-transcribe supersedes whisper-1 with better accuracy on
// accented English, Sanskrit terms, and noisy ritual recordings.
export const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
