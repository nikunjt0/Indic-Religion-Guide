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
  "Prashna_Upanishad.pdf": {
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
  "Mandukya_Upanishad.pdf": {
    title: "Mandukya Upanishad",
    tradition: "hindu",
    text_type: "upanishad",
    translator: null,
    language: "bilingual",
    tags: ["upanishad", "shruti", "vedanta"],
  },
  "taittiriya_upanishad.pdf": {
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
  "Manu-Smriti-OCR.pdf": {
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
  "BhagavadGitaGorakhpur.pdf": {
    title: "Bhagavad Gita",
    tradition: "hindu",
    text_type: "gita",
    translator: null,
    language: "bilingual",
    tags: ["gita", "smriti", "krishna", "vedanta"],
  },

  // Procedural ritual manuals (Grhya Sutras and dharma sutras) — these
  // prescribe the actual mechanics of samskaras, sandhyavandanam, agnihotra,
  // shraddha, and householder rites that the Vedas/Upanishads only allude to.
  "apastamba__dharma_grihya_sutras.pdf": {
    title: "Apastamba Dharma & Grihya Sutras",
    tradition: "hindu",
    text_type: "ritual_manual",
    translator: null,
    language: "bilingual",
    tags: ["sutra", "grhya-sutra", "dharma-sutra", "ritual", "samskaras", "kalpa", "apastamba"],
  },
  "asvalayana-eng.pdf": {
    title: "Asvalayana Grihya Sutra",
    tradition: "hindu",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["sutra", "grhya-sutra", "ritual", "samskaras", "kalpa", "rigveda", "asvalayana"],
  },
  "paraskara_eng.pdf": {
    title: "Paraskara Grihya Sutra",
    tradition: "hindu",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["sutra", "grhya-sutra", "ritual", "samskaras", "kalpa", "yajurveda", "paraskara"],
  },

  // Sectarian agamas — the prescriptive ritual canon for Shaiva and Vaishnava
  // temple/home worship (puja paddhatis, mantra installation, image worship).
  "mrgendra-agama-vidya-pada.pdf": {
    title: "Mrgendra Agama (Vidya Pada)",
    tradition: "hindu",
    text_type: "agama",
    translator: null,
    language: "bilingual",
    tags: ["agama", "shaiva", "vidya-pada", "philosophy", "ritual"],
  },
  "pancharatraprayoga.pdf": {
    title: "Pancharatra Prayoga",
    tradition: "hindu",
    text_type: "agama",
    translator: null,
    language: "bilingual",
    tags: ["agama", "vaishnava", "pancharatra", "ritual", "puja", "temple"],
  },

  // Vedantic commentary (Madhva's compendium on the Mahabharata's purport).
  "TatparyaNirnaya.pdf": {
    title: "Mahabharata Tatparya Nirnaya",
    tradition: "hindu",
    text_type: "philosophy",
    translator: null,
    language: "bilingual",
    tags: ["commentary", "vedanta", "vaishnava", "madhva", "dvaita", "mahabharata"],
  },

  // Secondary historical / linguistic context.
  "HISTORY_OF_INDIA_FROM_THE_EARLIEST_TIME_122_AD.pdf": {
    title: "History of India from the Earliest Times to 1200 AD",
    tradition: "hindu",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "history", "context"],
  },
  "SixtyYearsSanskrit.pdf": {
    title: "Sixty Years of Sanskrit Studies",
    tradition: "hindu",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "sanskrit"],
  },

  // --- Ayurveda (Upaveda of the Atharva Veda; classified as Hindu tradition).
  // Spans the classical samhita corpus (Charaka), modern scholarly works, and
  // home/herbal remedy manuals used by laypeople.
  "Charaka-Samhita-Acharya-Charaka.pdf": {
    title: "Charaka Samhita",
    tradition: "hindu",
    text_type: "ayurveda",
    book: "Charaka Samhita",
    translator: null,
    language: "bilingual",
    tags: ["ayurveda", "samhita", "classical", "charaka", "medicine", "primary"],
  },
  "Beginners-Guide-to-Ayurveda-2021.pdf": {
    title: "Beginner's Guide to Ayurveda (2021)",
    tradition: "hindu",
    text_type: "ayurveda",
    translator: null,
    language: "english",
    tags: ["ayurveda", "introduction", "doshas", "lifestyle", "modern"],
  },
  "Ayurvedic-Home-Remedies-English.pdf": {
    title: "Ayurvedic Home Remedies",
    tradition: "hindu",
    text_type: "ayurveda",
    translator: null,
    language: "english",
    tags: ["ayurveda", "remedy", "home", "herbal", "household"],
  },
  "The-Complete-Book-of-Ayurvedic-Home-Remedies.pdf": {
    title: "The Complete Book of Ayurvedic Home Remedies",
    tradition: "hindu",
    text_type: "ayurveda",
    translator: null,
    language: "english",
    tags: ["ayurveda", "remedy", "home", "herbal", "household", "reference"],
  },
  "herbal_healing_ayurveda.pdf": {
    title: "Herbal Healing in Ayurveda",
    tradition: "hindu",
    text_type: "ayurveda",
    translator: null,
    language: "english",
    tags: ["ayurveda", "herbal", "healing", "plants", "materia-medica"],
  },
  "Scientific_Basis_for_Ayurvedic_Therapies.pdf": {
    title: "Scientific Basis for Ayurvedic Therapies",
    tradition: "hindu",
    text_type: "ayurveda",
    translator: null,
    language: "english",
    tags: ["ayurveda", "scientific", "therapy", "research", "secondary"],
  },

  // --- Bhakti / devotional poetry. These do not mandate doctrine or ritual;
  // they carry the bhava — the devotional feeling a practice is meant to invoke —
  // and supplement scripture on devotion/morality questions (see rankWeight's
  // poetry branch and the POETRY guidance in lib/rag/prompt.ts).
  "mirabai-poems.pdf": {
    title: "Mirabai (Devotional Poems)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "bilingual",
    tags: ["poetry", "bhakti", "krishna", "mirabai"],
  },
  "Kabir-Poems 07-23.pdf": {
    title: "Kabir (Poems)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "english",
    tags: ["poetry", "bhakti", "nirguna", "kabir"],
  },
  "dohawali_of_goswami_tulsidas.pdf": {
    title: "Dohawali of Goswami Tulsidas",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "bilingual",
    tags: ["poetry", "bhakti", "rama", "tulsidas"],
  },
  "kalidasa_poems.pdf": {
    title: "Kalidasa (Poems)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "bilingual",
    tags: ["poetry", "classical", "sanskrit", "kalidasa"],
  },
  "surdas_poems.pdf": {
    title: "Surdas (Poems)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "english",
    tags: ["poetry", "bhakti", "krishna", "surdas"],
  },
  "tukaram_poems.pdf": {
    title: "Tukaram (Abhangas)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "english",
    tags: ["poetry", "bhakti", "vithoba", "varkari", "tukaram"],
  },
  "namdev_poems.pdf": {
    title: "Namdev (Poems)",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "english",
    tags: ["poetry", "bhakti", "varkari", "namdev"],
  },
  "tiruppavai_of_andal.pdf": {
    title: "Tiruppavai of Andal",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "bilingual",
    tags: ["poetry", "bhakti", "vaishnava", "alvar", "andal"],
  },
  "hymns_of_the_alvars.pdf": {
    title: "Hymns of the Alvars",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "bilingual",
    tags: ["poetry", "bhakti", "vaishnava", "alvar"],
  },
  "sixty-three-nayanar-saints.pdf": {
    title: "Lives of the 63 Nayanar Saints",
    tradition: "hindu",
    text_type: "poetry",
    translator: null,
    language: "english",
    tags: ["poetry", "bhakti", "shaiva", "nayanar"],
  },
};

export function lookupManifest(filename: string): SourceManifestEntry | null {
  return manifest[filename] ?? null;
}
