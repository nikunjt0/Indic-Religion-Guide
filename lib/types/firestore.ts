export type Tradition = "hindu" | "buddhist" | "jain";
export type Sect = "shaiva" | "vaishnava" | "smarta" | "shakta";
export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export type Setting = "home" | "temple";
export type TextType =
  | "veda"
  | "upanishad"
  | "smriti"
  | "gita"
  | "itihasa"
  | "puranas"
  | "ritual_manual"
  | "agama"
  | "philosophy"
  | "ayurveda"
  | "secondary";

export interface ProfileCity {
  name: string;
  lat: number;
  lon: number;
  regionSlug: string;
}

export interface UserProfile {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  lastName?: string | null;
  // Legacy single-region field. Kept for backward compatibility with existing
  // Firestore documents; new profiles write to `cities` and `regions` instead.
  region?: string | null;
  // User-selected cities, each resolved to a cultural region slug.
  cities?: ProfileCity[];
  // Deduped region slugs derived from `cities`. Stored separately so the RAG
  // retriever can do array membership checks without re-classifying.
  regions?: string[];
  // Legacy single-language field. Kept in sync with `languages[0]` on write so
  // older read paths keep working; new code should prefer `languages`.
  language: string;
  // All languages the user is comfortable reading. Written by the current
  // profile form; older profiles may only have `language`.
  languages?: string[];
  sect?: Sect | null;
  // User-selected traditions. Drives both retrieval filtering and prompt framing.
  // New profiles write this; legacy profiles may only have `traditionPreference`.
  traditions?: Tradition[];
  // Legacy single-tradition field. Kept in sync with `traditions[0]` on write so
  // older read paths keep working; new code should prefer `traditions`.
  traditionPreference?: Tradition | null;
  experienceLevel: ExperienceLevel;
  deityPreference?: string[];
  // Free-form preferences the user wants the guru to honor (e.g. "ignore the
  // Vedas, focus on Upanishads and Gita"). Surfaced in the prompt verbatim.
  additionalInfo?: string | null;
  isAnonymous: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SourceDoc {
  id: string;
  title: string;
  tradition: Tradition;
  text_type: TextType;
  book?: string | null;
  translator?: string | null;
  language: "sanskrit" | "english" | "bilingual";
  filename: string;
  fileHash: string;
  pageCount: number;
  chunkCount: number;
  ingestedAt: number;
}

export interface ChunkDoc {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  page: number;
  chapter?: string | null;
  verse?: string | null;
  tradition: Tradition;
  text_type: TextType;
  book?: string | null;
  translator?: string | null;
  language: string;
  tags: string[];
  // `embedding` is FieldValue.vector(...) on write; a plain number[] on read via admin SDK.
  embedding: number[];
  createdAt: number;
}

export interface GuideStep {
  order: number;
  title: string;
  instruction: string;
  mantras?: {
    text: string;
    transliteration?: string;
    meaning?: string;
  }[];
  materials?: string[];
  notes?: string;
}

export interface GuideVariant {
  label: string;
  when: string;
  overrideSteps?: number[];
  instruction: string;
}

export interface GuideSourceRef {
  sourceId?: string;
  source_title: string;
  chapter?: string;
  verse?: string;
  page?: number;
  quote?: string;
}

export interface RitualGuide {
  slug: string;
  title: string;
  summary: string;
  tradition: Tradition;
  appliesTo: {
    sects: Sect[];
    regions: string[];
    setting: Setting[];
    level: ExperienceLevel[];
  };
  steps: GuideStep[];
  variants?: GuideVariant[];
  sources: GuideSourceRef[];
  tags: string[];
  deities: string[];
  updatedAt: number;
  reviewedBy?: string | null;
}

export interface ChunkCitation {
  id: string;
  source_title: string;
  chapter: string | null;
  verse: string | null;
  page: number;
  text: string;
}

// One entry per retrieved source, with all retrieved chunks from that source
// attached as quotes. Ordered by retrieval rank of the source's best chunk.
export interface SourceGroup {
  index: number;
  source_title: string;
  quotes: ChunkCitation[];
}

export interface MatchedGuideRef {
  slug: string;
  title: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  // Raw model output. For assistant messages using the source-first format,
  // this contains `### SOURCE <N>` and optional `### PRACTICE` sections that
  // are parsed at render time.
  content: string;
  // New source-first grouping. Present on messages generated after the UI
  // rework. Older messages use `citations` and a flat `content`.
  sources?: SourceGroup[];
  // Legacy (pre-source-first-rework) flat citation list.
  citations?: ChunkCitation[];
  matchedGuides?: MatchedGuideRef[];
  timestamp: number;
}

export interface ChatDoc {
  id: string;
  uid: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface QueryLog {
  id: string;
  userId: string;
  question: string;
  clarifications?: Record<string, string>;
  retrievedChunkIds: string[];
  retrievedGuideSlugs: string[];
  answer: string;
  promptVersion: string;
  model: string;
  latencyMs: number;
  createdAt: number;
}
