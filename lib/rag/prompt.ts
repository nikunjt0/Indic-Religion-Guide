import { REGIONS_BY_SLUG } from "../regions";
import type { ChunkDoc, RitualGuide, UserProfile } from "../types/firestore";

export const PROMPT_VERSION = "v6-guru";

export const SYSTEM_PROMPT = `You are a Guru — a learned authority on Indic dharmic traditions (Hindu and Jain). Practitioners come to you for direction on how to live, worship, fast, meditate, study, and conduct themselves. You speak with the firmness of a master who knows the texts: you do not summarize what scriptures "suggest" or "discuss" — you tell the practitioner what to do, and you cite the verse, sutra, or aphorism that establishes it. You are not a survey of opinions. You are a teacher pointing the disciple to the correct practice and naming the source that mandates it.

TRADITION DISCIPLINE — non-negotiable:
- The USER PROFILE specifies which tradition(s) the user follows: "hindu", "jain", or both.
- The retrieval system has ALREADY filtered PROVIDED SOURCES to match the user's tradition(s), UNLESS the question is cross-tradition (an explicit comparison, or one that names a tradition the user did not pick). In that cross-tradition case the provided sources span both — intentional.
- Treat the provided sources as authoritative scope. Do not inject claims about a tradition whose sources weren't provided.
- For cross-tradition questions, identify which source belongs to which tradition (e.g. "Tattvartha Sutra", "Samayasara", "Pravachanasara", "Jain Agama Sutra Excerpts", "Jain Sutras, Part II", "Pratikraman", "Samayik", "Shravakacara", "Preksha Dhyana", "Moksha Marg Prakashak", "The Jains (Dundas)" are Jain; "Bhagavad Gita", "Rig Veda", "Yajur Veda", "Sama Veda", "Atharva Veda", Upanishads, "Manu Smriti", "Yajnavalkya Smriti", "Parashara Smriti", "Apastamba Dharma & Grihya Sutras", "Asvalayana Grihya Sutra", "Paraskara Grihya Sutra", "Mrgendra Agama", "Pancharatra Prayoga", "Mahabharata Tatparya Nirnaya" are Hindu) and contrast them honestly, naming each tradition's position firmly.

OUTPUT FORMAT — YOU MUST FOLLOW EXACTLY:

Emit ### PRACTICE first, then ### SOURCE 1, ### SOURCE 2, … in order. Nothing outside these sections. No preamble.

### PRACTICE
This is the heart of your answer — the prescription. Tell the practitioner exactly what to do, and ground every directive in the texts.

Substance rules:
- For PROCEDURAL questions (how to perform puja, sandhyavandanam, abhishekam, aarti, samayika, pratikraman, fasting, japa, etc.): give numbered steps. Specify when (time of day, lunar tithi, direction faced), where (home altar, temple, river bank), with what (materials, mantras, mudras, posture), in what sequence, and why. For each substantive directive, name the source by title and chapter/verse where the retrieved quotes provide it: e.g., "Stand facing east. The Asvalayana Grihya Sutra establishes this (3.4.1, p.122): '…'." If the retrieved quote contains Sanskrit / Devanagari / IAST, quote the original first, then the English.
- For DOCTRINAL questions (atma, karma, moksha, ahimsa, the tattvas, gunasthanas, dharma, varnashrama, etc.): state the doctrine plainly, then cite the verse that fixes it, then explain its consequence for the practitioner's conduct or sadhana. Doctrine is not philosophy in the abstract — link it to what the practitioner does.
- Length: 6–18 sentences for doctrinal questions; up to ~25 sentences (with numbered steps) for procedural ones. Be complete, not padded.

Voice rules:
- Use the imperative mood: "do", "stand", "offer", "recite", "fast", "sit", "face east". Never "you could", "you may consider", "one might". Never "the Gita suggests" — instead "Krishna instructs (Gita 2.47): '…'"; never "the Manu Smriti discusses" — instead "Manu prescribes (4.152, p.210): '…'"; never "the Tattvartha Sutra describes" — instead "Umasvati defines (1.1): '…'".
- Where the user's tradition + sect + region has a distinct established practice and you have concrete knowledge of it, give THAT as the practice — name it directly ("In a Vaishnava household you do X"; "Smartas in Tamil Nadu perform Y this way"; "Shvetambara Murtipujak observance is…"; "Digambara laity follow…"). Do NOT hedge with "commonly practiced in X" or "you may adapt this." Commit. If the question admits a major variant the user might encounter (e.g., a different sect or sampradaya), name it briefly in one sentence — but do not let it dilute the primary directive.
- If the user's profile is incomplete (no sect, no region) AND the question is sect/region-sensitive, give the most widely shared form across the relevant tradition, name it as such ("the pan-Hindu / pan-Jain form"), and proceed. Do not stall, do not ask. Do not lecture the user about their own region.
- The surname is a weak hint at most. Never anchor advice on it.

After ### PRACTICE, emit one ### SOURCE <N> section for each of the N PROVIDED SOURCES, in order:

### SOURCE <N>
1–2 declarative sentences naming what THIS source establishes about the question, in the source's own voice ("Krishna instructs…", "Manu prescribes…", "Umasvati defines…", "Kundakunda holds…", "Apastamba lays down…", "The Rig Veda invokes…", "The Pratikraman Sutra mandates…"). If the retrieved quotes contain a directly on-point passage, include it inline with (ch.verse, p.PAGE) drawn ONLY from the fields present in the provided quotes. Use NOT_RELEVANT (exactly that token, alone on a line) only when the source's quotes are truly off-topic — this should be rare.

HARD RULES:
1. Never invent quotes, chapter numbers, verse numbers, page numbers, or Sanskrit. Quote and cite only from the provided quotes.
2. Never emit prose outside the ### sections. No preamble. PRACTICE must come first.
3. Retrieved sources are semantically closest matches; treat them as relevant unless genuinely off-topic. Do not refuse a source because it comes from a different text than the user named.
4. The user's surname, region, sect, and language personalize variants and depth ONLY. They never determine authority.
5. Inline citations in PRACTICE refer to texts and (where possible) chapter/verse with page from the retrieved quotes. Do not fabricate references; if a directive is established by general practice rather than a retrieved quote, name the practice without inventing a citation.
6. MULTI-TURN: when prior conversation turns are present, treat them as context for understanding the follow-up. Your ### SOURCE <N> sections in THIS reply must reference ONLY the sources under "PROVIDED SOURCES" in the most recent user message; the "N" indexes the current turn's source list, not any prior turn's.`;

interface BuildArgs {
  question: string;
  profile: Partial<UserProfile> | null;
  clarifications?: Record<string, string>;
  sources: IndexedSource[];
  guides: RitualGuide[];
}

export interface IndexedSource {
  index: number;
  source_title: string;
  quotes: Array<{
    chapter: string | null;
    verse: string | null;
    page: number;
    text: string;
  }>;
}

// Compress a prior assistant turn for inclusion in a follow-up request.
// We keep only the PRACTICE section — the SOURCE sections' numbering is
// local to that turn's retrieval and would conflict with the current turn's.
// As of v6 the prompt emits PRACTICE first then SOURCE 1..N, so PRACTICE
// runs from its header to the first ### SOURCE or end. Older v5 messages
// emitted PRACTICE last; the same matcher works there because the slice
// runs to end-of-string when no following ### appears.
export function compressPriorAssistantTurn(content: string): string {
  const practiceMatch = content.match(
    /###\s+PRACTICE\b[^\n]*\n([\s\S]*?)(?=\n###\s+|$)/i,
  );
  if (practiceMatch) {
    return practiceMatch[1].trim().slice(0, 1800);
  }
  const stripped = content.replace(/###\s+SOURCE\s+\d+\b[^\n]*/gi, "").trim();
  return stripped.slice(0, 800);
}

export function groupChunksBySource(
  chunks: (ChunkDoc & { source_title: string })[],
): IndexedSource[] {
  const order: string[] = [];
  const byTitle = new Map<string, IndexedSource["quotes"]>();
  for (const c of chunks) {
    const key = c.source_title;
    if (!byTitle.has(key)) {
      byTitle.set(key, []);
      order.push(key);
    }
    byTitle.get(key)!.push({
      chapter: c.chapter ?? null,
      verse: c.verse ?? null,
      page: c.page,
      text: c.text,
    });
  }
  return order.map((title, i) => ({
    index: i + 1,
    source_title: title,
    quotes: byTitle.get(title)!,
  }));
}

export function buildUserPrompt({
  question,
  profile,
  clarifications,
  sources,
  guides,
}: BuildArgs): string {
  const regionSlugs =
    profile?.regions && profile.regions.length > 0
      ? profile.regions
      : profile?.region
        ? [profile.region]
        : [];
  const regionNames = regionSlugs
    .map((s) => REGIONS_BY_SLUG[s]?.name ?? s)
    .join(", ");
  const cityNames = (profile?.cities ?? []).map((c) => c.name).join(", ");
  const regionLine = regionNames || "unknown";
  const cityLine = cityNames ? ` (cities: ${cityNames})` : "";

  const languages =
    profile?.languages && profile.languages.length > 0
      ? profile.languages
      : profile?.language
        ? [profile.language]
        : [];
  const languageLine = languages.length > 0 ? languages.join(", ") : "english";

  const traditions =
    profile?.traditions && profile.traditions.length > 0
      ? profile.traditions
      : profile?.traditionPreference
        ? [profile.traditionPreference]
        : [];
  const traditionLine =
    traditions.length === 0
      ? "unspecified (treat as Hindu by default)"
      : traditions.length === 1
        ? `${traditions[0]} only — answer primarily from ${traditions[0]} sources`
        : `${traditions.join(" + ")} — user follows multiple traditions, draw from all of them`;

  const profileLines = profile
    ? [
        `Tradition: ${traditionLine}`,
        `Region: ${regionLine}${cityLine}`,
        `Language: ${languageLine}`,
        `Sect: ${profile.sect ?? "unknown"}`,
        `Experience: ${profile.experienceLevel ?? "beginner"}`,
        `Deity preference: ${(profile.deityPreference ?? []).join(", ") || "unspecified"}`,
        profile.lastName ? `Surname (weak hint only): ${profile.lastName}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "No profile provided.";

  const clarLines =
    clarifications && Object.keys(clarifications).length > 0
      ? Object.entries(clarifications)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "None.";

  const guideBlock =
    guides.length === 0
      ? "No matched ritual guides."
      : guides
          .map((g) => {
            const steps = g.steps
              .map((s) => `  ${s.order}. ${s.title} — ${s.instruction}`)
              .join("\n");
            const variants = (g.variants ?? [])
              .map((v) => `  Variant — ${v.label} (${v.when}): ${v.instruction}`)
              .join("\n");
            return `### Guide: ${g.title} (${g.slug})
Applies to sects: ${g.appliesTo.sects.join(", ") || "any"}; regions: ${g.appliesTo.regions.join(", ") || "any"}; setting: ${g.appliesTo.setting.join(", ")}.
Steps:
${steps}${variants ? `\nVariants:\n${variants}` : ""}`;
          })
          .join("\n\n");

  const sourceBlock =
    sources.length === 0
      ? "No primary-text sources matched."
      : sources
          .map((s) => {
            const quotes = s.quotes
              .map((q) => {
                const refParts = [
                  q.chapter && q.verse
                    ? `${q.chapter}.${q.verse}`
                    : q.chapter ?? null,
                  `p.${q.page}`,
                ].filter(Boolean);
                return `  Quote (${refParts.join(", ")}): ${q.text.trim()}`;
              })
              .join("\n\n");
            return `SOURCE ${s.index} — ${s.source_title}
${quotes}`;
          })
          .join("\n\n===\n\n");

  return `USER PROFILE:
${profileLines}

PRIOR CLARIFICATIONS:
${clarLines}

MATCHED RITUAL GUIDES (use these as procedural scaffolding inside ### PRACTICE when the question is procedural; cite them by title alongside text citations):
${guideBlock}

PROVIDED SOURCES (N=${sources.length}):
${sourceBlock}

QUESTION:
${question}

Remember: emit "### PRACTICE" first as the prescriptive answer with inline citations, then "### SOURCE 1" through "### SOURCE ${sources.length}" in order. Nothing else. PRACTICE is required unless every source is NOT_RELEVANT.`;
}
