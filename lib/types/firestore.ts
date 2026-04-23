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
  | "ritual_manual";

export interface UserProfile {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  lastName?: string | null;
  region?: string | null;
  language: string;
  sect?: Sect | null;
  traditionPreference?: Tradition | null;
  experienceLevel: ExperienceLevel;
  deityPreference?: string[];
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

export interface MatchedGuideRef {
  slug: string;
  title: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
