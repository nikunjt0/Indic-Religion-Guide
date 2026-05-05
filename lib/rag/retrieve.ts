import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebase/admin";
import { EMBED_MODEL, openai } from "../openai";
import type {
  ChunkDoc,
  RitualGuide,
  SourceDoc,
  Tradition,
  UserProfile,
} from "../types/firestore";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return res.data[0].embedding as number[];
}

// All traditions currently represented in the chunks collection. When a user
// has selected this whole set (or nothing), filtering is a no-op.
const ALL_TRADITIONS: Tradition[] = ["hindu", "jain"];

// Pull the user's effective tradition list out of a profile, falling back to
// the legacy single-tradition field. Returns the universe ALL_TRADITIONS when
// nothing is set so callers don't have to special-case undefined.
export function effectiveTraditions(
  profile: Partial<UserProfile> | null | undefined,
): Tradition[] {
  if (profile?.traditions && profile.traditions.length > 0) {
    return profile.traditions;
  }
  if (profile?.traditionPreference) return [profile.traditionPreference];
  return ALL_TRADITIONS;
}

const COMPARE_REGEX = /\b(vs\.?|versus|compared?(\s+(to|with))?|differ(ence|s|ent)?|contrast|both\s+(traditions?|hindu|jain))\b/i;
const HINDU_MENTION_REGEX = /\b(hindu(ism)?|vedic|vedas?|upanishads?|puranas?|smriti|gita|bhagavad|shaiv(a|ism)|vaishnav(a|ism)|smarta|shakta|brahmin|krishna|rama\b|vishnu|shiva|devi|durga|ganesha|lakshmi|saraswati|ayurved(a|ic)|doshas?|vata|pitta|kapha|tridoshas?|panchakarma|rasayana|abhyanga|shirodhara|charaka|sushruta|vagbhata)\b/i;
const JAIN_MENTION_REGEX = /\b(jain(ism|a)?|tirthankar(a)?s?|digambara|sh?vetambara|kundakunda|tattvartha|samayasara|pravachanasara|jina|mahavira|parshv?anatha?|agamas?(?!\s*sutra))\b/i;

// Returns true when the question references a tradition the user hasn't
// selected, or explicitly compares traditions. Caller broadens retrieval to
// all traditions in that case so cross-tradition questions still work.
export function isCrossTraditionQuestion(
  question: string,
  userTraditions: Tradition[],
): boolean {
  if (COMPARE_REGEX.test(question)) return true;
  if (!userTraditions.includes("jain") && JAIN_MENTION_REGEX.test(question)) {
    return true;
  }
  if (!userTraditions.includes("hindu") && HINDU_MENTION_REGEX.test(question)) {
    return true;
  }
  return false;
}

// Resolve which traditions retrieval should consider given the user's profile
// and the question. Cross-tradition questions broaden to ALL_TRADITIONS.
export function resolveRetrievalTraditions(
  profile: Partial<UserProfile> | null | undefined,
  question: string,
): Tradition[] {
  const user = effectiveTraditions(profile);
  if (isCrossTraditionQuestion(question, user)) return ALL_TRADITIONS;
  return user;
}

export async function findNearestChunks(
  queryVector: number[],
  k = 8,
  allowedTraditions?: Tradition[],
): Promise<(ChunkDoc & { source_title: string })[]> {
  const traditions = allowedTraditions ?? ALL_TRADITIONS;
  // Only apply a server-side prefilter when narrowing to a single tradition —
  // that's the only case that needs a composite vector index. When the set is
  // {hindu, jain} (i.e. all known traditions), skip the filter entirely.
  const isFiltered =
    traditions.length === 1 && ALL_TRADITIONS.includes(traditions[0]);
  const baseCollection = adminDb.collection("chunks");

  // Ayurveda is the indigenous medical system of the subcontinent and was
  // shared across Hindu and Jain communities historically; we tag it
  // tradition="hindu" in the corpus, but it should retrieve for non-Hindu
  // users too. When narrowing to a single non-Hindu tradition, run a parallel
  // ayurveda-only query and merge by distance so healing/remedy questions
  // surface ayurvedic sources alongside the user's own tradition.
  const queryRefs: FirebaseFirestore.Query[] = [];
  if (isFiltered) {
    queryRefs.push(baseCollection.where("tradition", "==", traditions[0]));
    if (traditions[0] !== "hindu") {
      queryRefs.push(baseCollection.where("text_type", "==", "ayurveda"));
    }
  } else {
    queryRefs.push(baseCollection);
  }

  const snaps = await Promise.all(
    queryRefs.map((q) =>
      q
        .findNearest({
          vectorField: "embedding",
          queryVector: FieldValue.vector(queryVector),
          limit: k,
          distanceMeasure: "COSINE",
          distanceResultField: "_distance",
        })
        .get(),
    ),
  );

  // Merge across queries by distance, dedupe by id, take top K. Distances are
  // comparable across the parallel queries because both use the same metric
  // and query vector.
  const all = snaps.flatMap((s) =>
    s.docs.map((d) => d.data() as ChunkDoc & { _distance: number }),
  );
  all.sort((a, b) => a._distance - b._distance);
  const seen = new Set<string>();
  const chunks: ChunkDoc[] = [];
  for (const c of all) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const { _distance: _d, ...chunk } = c;
    chunks.push(chunk as ChunkDoc);
    if (chunks.length >= k) break;
  }

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
      const userRegions =
        profile?.regions && profile.regions.length > 0
          ? profile.regions
          : profile?.region
            ? [profile.region]
            : [];
      if (userRegions.some((r) => g.appliesTo.regions.includes(r))) score += 1;
      return { g, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((x) => x.g);
}
