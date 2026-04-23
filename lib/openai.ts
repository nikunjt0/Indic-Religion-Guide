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
