import { EMBED_MODEL, openai } from "../../lib/openai";

const BATCH_SIZE = 100;

async function embedBatch(inputs: string[], attempt = 0): Promise<number[][]> {
  try {
    const res = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: inputs,
    });
    return res.data.map((d) => d.embedding as number[]);
  } catch (err: unknown) {
    if (attempt >= 5) throw err;
    const delay = 1000 * 2 ** attempt;
    console.warn(
      `  embed retry ${attempt + 1} in ${delay}ms — ${(err as Error).message}`,
    );
    await new Promise((r) => setTimeout(r, delay));
    return embedBatch(inputs, attempt + 1);
  }
}

export async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch);
    out.push(...vectors);
  }
  return out;
}
