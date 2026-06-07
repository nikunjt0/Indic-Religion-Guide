import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../firebase/admin";
import { EMBED_MODEL, openai } from "../openai";
import { type QueryDomain, classifyDomain } from "./domain";
import type {
  ChunkDoc,
  RitualGuide,
  SourceDoc,
  UserProfile,
} from "../types/firestore";

export { type QueryDomain, classifyDomain } from "./domain";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  return res.data[0].embedding as number[];
}

// Core of what the user asks for: Gita, Upanishads, dharma-shastra (smriti).
const CORE_DHARMA = new Set(["gita", "upanishad", "smriti"]);
// Other primary scripture — still authoritative, slightly behind the core.
const OTHER_SCRIPTURE = new Set([
  "veda",
  "itihasa",
  "puranas",
  "agama",
  "ritual_manual",
  "philosophy",
]);

// Multiplier applied to a chunk's cosine distance (lower = ranked higher) based
// on its text_type and the question's domain. <1 boosts, >1 demotes.
function rankWeight(textType: string | undefined, domain: QueryDomain): number {
  const t = textType ?? "";
  if (domain === "wellness") {
    if (t === "ayurveda") return 0.75;
    if (CORE_DHARMA.has(t) || OTHER_SCRIPTURE.has(t)) return 1.2;
    if (t === "secondary") return 1.1;
    return 1.0;
  }
  if (domain === "custom") {
    // Living custom isn't in the corpus, so retrieval is supplementary here: the
    // answer commits from established tradition (see the prompt's custom
    // directive). Surface only the shared samskara skeleton — the grihya/dharma
    // sutras (ritual_manual) and smriti that fix the common rites — and keep
    // Ayurveda/secondary well down so they don't crowd it. A mild nudge, not a
    // hard filter; most sources will end up NOT_RELEVANT in the answer.
    if (t === "ritual_manual" || t === "smriti") return 0.8;
    if (CORE_DHARMA.has(t) || OTHER_SCRIPTURE.has(t)) return 0.95;
    if (t === "ayurveda") return 1.8;
    if (t === "secondary") return 1.25;
    return 1.0;
  }
  // dharma (default): pull scripture to the top, push Ayurveda/secondary down.
  if (CORE_DHARMA.has(t)) return 0.7;
  if (OTHER_SCRIPTURE.has(t)) return 0.82;
  if (t === "ayurveda") return 1.8;
  if (t === "secondary") return 1.25;
  return 1.0;
}

// Within the Ayurveda corpus, some texts give concrete, actionable remedies
// (a named herb, a preparation, a dose) while others are introductory lifestyle
// surveys or modern research write-ups. On a wellness question the user wants
// the concrete remedy, so we nudge the actionable texts above the survey prose.
// Driven by source tags (set in scripts/lib/manifest.ts), not titles, so it
// works at rank time before titles are resolved. Conservative multipliers — a
// re-rank nudge, not a hard filter.
const AYURVEDA_REMEDY_TAGS = new Set([
  "remedy",
  "home",
  "household",
  "herbal",
  "materia-medica",
  "medicine",
  "primary",
]);
const AYURVEDA_SURVEY_TAGS = new Set([
  "introduction",
  "lifestyle",
  "modern",
  "scientific",
  "research",
]);

function ayurvedaSpecificityWeight(tags: string[] | undefined): number {
  if (!tags || tags.length === 0) return 1.0;
  if (tags.some((t) => AYURVEDA_REMEDY_TAGS.has(t))) return 0.85; // boost
  if (tags.some((t) => AYURVEDA_SURVEY_TAGS.has(t))) return 1.15; // demote
  return 1.0;
}

// At most this many Ayurveda chunks may fill the final set on a dharma-domain
// question, so a couple of strong wellness matches can't crowd out scripture.
const AYURVEDA_CAP_DHARMA = 2;

// The corpus is Hindu-only. Retrieval always filters to this single tradition.
// We over-fetch nearest neighbors, then re-rank by text_type so the right kind
// of source surfaces for the question's domain (see classifyDomain / rankWeight).
export async function findNearestChunks(
  queryVector: number[],
  k = 8,
  opts: { question?: string } = {},
): Promise<(ChunkDoc & { source_title: string })[]> {
  const domain = classifyDomain(opts.question ?? "");
  // Pull a wide candidate pool so the re-rank has room to promote scripture that
  // pure cosine distance leaves outside the top k — for a dharma question the
  // nearest neighbors skew to modern-prose Ayurveda/secondary, so we need depth
  // for enough verse chunks to compete.
  const fetchN = Math.max(k * 10, 80);
  const snap = await adminDb
    .collection("chunks")
    .where("tradition", "==", "hindu")
    .findNearest({
      vectorField: "embedding",
      queryVector: FieldValue.vector(queryVector),
      limit: fetchN,
      distanceMeasure: "COSINE",
      distanceResultField: "_distance",
    })
    .get();

  const all = snap.docs.map(
    (d) => d.data() as ChunkDoc & { _distance: number },
  );
  // Dedupe by id (keep the closest), then re-rank by domain-weighted distance.
  const seen = new Set<string>();
  const candidates: (ChunkDoc & { _distance: number })[] = [];
  for (const c of all.sort((a, b) => a._distance - b._distance)) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    candidates.push(c);
  }
  const ranked = candidates
    .map((c) => {
      let score = c._distance * rankWeight(c.text_type, domain);
      // On wellness questions, prefer concrete-remedy Ayurveda over survey prose.
      if (domain === "wellness" && c.text_type === "ayurveda") {
        score *= ayurvedaSpecificityWeight(c.tags);
      }
      return { c, score };
    })
    .sort((a, b) => a.score - b.score);

  // Take the top k under a soft Ayurveda cap (non-wellness domains), then
  // backfill ignoring the cap if it ever leaves us short.
  const ayurvedaCap = domain === "wellness" ? k : AYURVEDA_CAP_DHARMA;
  const chunks: ChunkDoc[] = [];
  const taken = new Set<string>();
  let ayurvedaTaken = 0;
  for (const { c } of ranked) {
    if (c.text_type === "ayurveda" && ayurvedaTaken >= ayurvedaCap) continue;
    if (c.text_type === "ayurveda") ayurvedaTaken++;
    const { _distance: _d, ...chunk } = c;
    chunks.push(chunk as ChunkDoc);
    taken.add(c.id);
    if (chunks.length >= k) break;
  }
  if (chunks.length < k) {
    for (const { c } of ranked) {
      if (taken.has(c.id)) continue;
      const { _distance: _d, ...chunk } = c;
      chunks.push(chunk as ChunkDoc);
      taken.add(c.id);
      if (chunks.length >= k) break;
    }
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
    .where("tradition", "==", "hindu")
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
