import type { ChunkDoc, RitualGuide, UserProfile } from "../types/firestore";

export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT = `You are a ritual-practice guide for Hindu traditions. You answer questions about how to perform rituals (puja, abhishekam, aarti, fasting, japa, etc.) grounded strictly in the sources provided.

HARD RULES:
1. Never invent quotes, chapters, verses, or page numbers. If the provided context does not support a claim, say so explicitly.
2. Every scriptural quotation MUST be followed by a citation in the form [source_title, chapter.verse, p.PAGE]. Use only fields present in the provided chunks.
3. When a curated ritual guide is provided, use it as the canonical procedure. Use primary-text chunks to quote supporting passages.
4. The user's surname, region, or sect personalize variants ONLY. They never determine authority or correctness. Do not assume a surname implies a sect.
5. If the question's answer depends materially on sect (Shaiva/Vaishnava/Smarta/Shakta), region, or setting (home/temple), and that information is not in the profile or the question, ask ONE clarifying question before answering.
6. Prefer "commonly practiced in [region] by [sect]" framing over "the correct way." Where traditions differ, state the difference.
7. Keep answers under 500 words unless step-by-step procedure requires more. Use numbered steps for procedures.`;

interface BuildArgs {
  question: string;
  profile: Partial<UserProfile> | null;
  clarifications?: Record<string, string>;
  chunks: ChunkDoc[];
  guides: RitualGuide[];
}

export function buildUserPrompt({
  question,
  profile,
  clarifications,
  chunks,
  guides,
}: BuildArgs): string {
  const profileLines = profile
    ? [
        `Region: ${profile.region ?? "unknown"}`,
        `Language: ${profile.language ?? "english"}`,
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

  const chunkBlock =
    chunks.length === 0
      ? "No matched primary-text chunks."
      : chunks
          .map((c) => {
            const title = sourceTitleFromChunk(c);
            const ref = `${title}${c.chapter ? `, ${c.chapter}${c.verse ? `.${c.verse}` : ""}` : ""}, p.${c.page}`;
            return `[${ref}]\n${c.text.trim()}`;
          })
          .join("\n\n---\n\n");

  return `USER PROFILE:
${profileLines}

PRIOR CLARIFICATIONS:
${clarLines}

MATCHED RITUAL GUIDES:
${guideBlock}

RELEVANT PRIMARY-TEXT CHUNKS:
${chunkBlock}

QUESTION:
${question}`;
}

function sourceTitleFromChunk(c: ChunkDoc): string {
  // chunks don't store source_title; the caller should attach it before prompt assembly.
  // The retrieval layer resolves sourceId -> title and stashes it on the chunk object.
  return (c as ChunkDoc & { source_title?: string }).source_title ?? c.sourceId;
}
