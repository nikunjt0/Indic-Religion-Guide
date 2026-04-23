import type { TextType, Tradition } from "../../lib/types/firestore";

export interface SourceManifestEntry {
  title: string;
  tradition: Tradition;
  text_type: TextType;
  book?: string;
  translator?: string | null;
  language: "sanskrit" | "english" | "bilingual";
  tags: string[];
}

// Keyed by basename (filename without directory). Translator is null when unknown —
// the RAG prompt handles missing translator gracefully.
export const manifest: Record<string, SourceManifestEntry> = {
  "RigVeda.pdf": {
    title: "Rig Veda",
    tradition: "hindu",
    text_type: "veda",
    translator: null,
    language: "bilingual",
    tags: ["veda", "shruti", "mantra"],
  },
  "YajurVeda.pdf": {
    title: "Yajur Veda",
    tradition: "hindu",
    text_type: "veda",
    translator: null,
    language: "bilingual",
    tags: ["veda", "shruti", "yajna"],
  },
  "SamaVeda.pdf": {
    title: "Sama Veda",
    tradition: "hindu",
    text_type: "veda",
    translator: null,
    language: "bilingual",
    tags: ["veda", "shruti", "chant"],
  },
  "AtharvaVeda.pdf": {
    title: "Atharva Veda",
    tradition: "hindu",
    text_type: "veda",
    translator: null,
    language: "bilingual",
    tags: ["veda", "shruti"],
  },
  "IshaUpanishad.pdf": {
    title: "Isha Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "KenaUpanishad.pdf": {
    title: "Kena Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "KathaUpanishad.pdf": {
    title: "Katha Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "PrashnaUpanishad.pdf": {
    title: "Prashna Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "MundakaUpanishad.pdf": {
    title: "Mundaka Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "MandukyaUpanishad.pdf": {
    title: "Mandukya Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "TaittiriyaUpanishad.pdf": {
    title: "Taittiriya Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "Aiterreya&TaittiriyaUpanishads.pdf": {
    title: "Aitareya and Taittiriya Upanishads",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "BrihadaranyakaUpanishad.pdf": {
    title: "Brihadaranyaka Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "Chhandogya_Upanishad.pdf": {
    title: "Chhandogya Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "ManuSmriti.pdf": {
    title: "Manu Smriti",
    tradition: "hindu",
    text_type: "smriti",
    translator: null,
    language: "bilingual",
    tags: ["smriti", "dharma-shastra", "manu"],
  },
  "YajnavalkyaSmriti.pdf": {
    title: "Yajnavalkya Smriti",
    tradition: "hindu",
    text_type: "smriti",
    translator: null,
    language: "bilingual",
    tags: ["smriti", "dharma-shastra"],
  },
  "SriParasharaSmrithi.pdf": {
    title: "Parashara Smriti",
    tradition: "hindu",
    text_type: "smriti",
    translator: null,
    language: "bilingual",
    tags: ["smriti", "dharma-shastra"],
  },
  "BhagvadGita.pdf": {
    title: "Bhagavad Gita",
    tradition: "hindu",
    text_type: "gita",
    translator: null,
    language: "bilingual",
    tags: ["gita", "smriti", "krishna", "vedanta"],
  },
};

export function lookupManifest(filename: string): SourceManifestEntry | null {
  return manifest[filename] ?? null;
}
