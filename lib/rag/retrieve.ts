import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebase/admin";
import { EMBED_MODEL, openai } from "../openai";
import type {
  ChunkDoc,
  RitualGuide,
  SourceDoc,
  UserProfile,
} from "../types/firestore";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return res.data[0].embedding as number[];
}

export async function findNearestChunks(
  queryVector: number[],
  k = 8,
): Promise<(ChunkDoc & { source_title: string })[]> {
  const snap = await adminDb
    .collection("chunks")
    .findNearest({
      vectorField: "embedding",
      queryVector: FieldValue.vector(queryVector),
      limit: k,
      distanceMeasure: "COSINE",
    })
    .get();

  const chunks = snap.docs.map((d) => d.data() as ChunkDoc);
  const sourceIds = Array.from(new Set(chunks.map((c) => c.sourceId)));
  const titleMap = new Map<string, string>();

  // Resolve source titles in batches of 10 (Firestore `in` cap).
  for (let i = 0; i < sourceIds.length; i += 10) {
    const batch = sourceIds.slice(i, i + 10);
    if (batch.length === 0) continue;
    const srcSnap = await adminDb
      .collection("sources")
      .where("__name__", "in", batch)
      .get();
    for (const doc of srcSnap.docs) {
      const data = doc.data() as SourceDoc;
      titleMap.set(doc.id, data.title);
    }
  }

  return chunks.map((c) => ({
    ...c,
    source_title: titleMap.get(c.sourceId) ?? c.sourceId,
  }));
}

const RITUAL_KEYWORDS: [RegExp, string[]][] = [
  [/\bpuja\b|\bworship\b/i, ["puja", "daily-practice"]],
  [/\babhishek/i, ["abhishekam"]],
  [/\baarti\b|\barti\b/i, ["aarti"]],
  [/\baltar\b|\bmandir\b|\bpuja\s+room\b/i, ["home-altar"]],
  [/\bnaivedya\b|\boffer(ing)?s?\b|\bprasad\b/i, ["naivedya", "offerings"]],
  [/\bpradakshin/i, ["pradakshina"]],
  [/\bekadashi\b|\bfast/i, ["fasting", "ekadashi"]],
  [/\bjapa\b|\bmala\b|\bmantra\b/i, ["japa", "mantra"]],
  [/\btemple\b|\bdarshan\b/i, ["temple"]],
  [/\bsadhana\b|\bdaily\s+practice\b|\broutine\b/i, ["sadhana", "daily-practice"]],
];

export async function matchGuides(
  question: string,
  profile: Partial<UserProfile> | null,
  limit = 3,
): Promise<RitualGuide[]> {
  const tagSet = new Set<string>();
  for (const [re, tags] of RITUAL_KEYWORDS) {
    if (re.test(question)) for (const t of tags) tagSet.add(t);
  }

  if (tagSet.size === 0) return [];

  // Firestore array-contains-any is limited to 10 values.
  const tags = Array.from(tagSet).slice(0, 10);
  const snap = await adminDb
    .collection("ritualGuides")
    .where("tradition", "==", profile?.traditionPreference ?? "hindu")
    .where("tags", "array-contains-any", tags)
    .limit(limit * 3)
    .get();

  const scored = snap.docs
    .map((d) => {
      const g = d.data() as RitualGuide;
      let score = g.tags.filter((t) => tagSet.has(t)).length;
      if (profile?.sect && g.appliesTo.sects.includes(profile.sect)) score += 1;
      if (profile?.region && g.appliesTo.regions.includes(profile.region)) score += 1;
      return { g, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((x) => x.g);
}
