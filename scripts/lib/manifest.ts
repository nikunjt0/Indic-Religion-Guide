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

  // --- Jain texts ---

  // Canonical (Agama)
  "Jain_Sutra_Excerpts_Aagam.pdf": {
    title: "Jain Agama Sutra Excerpts",
    tradition: "jain",
    text_type: "agama",
    translator: null,
    language: "bilingual",
    tags: ["agama", "sutra", "canon", "shvetambara"],
  },
  "jainSutrasPart2.pdf": {
    title: "Jain Sutras, Part II (Sacred Books of the East, Vol. 45)",
    tradition: "jain",
    text_type: "agama",
    translator: "Hermann Jacobi",
    language: "english",
    tags: ["agama", "sutra", "canon", "uttaradhyayana", "sutrakritanga", "shvetambara"],
  },

  // Foundational philosophical texts
  "TattvarthaSutra.pdf": {
    title: "Tattvartha Sutra",
    tradition: "jain",
    text_type: "philosophy",
    book: "Tattvartha Sutra",
    translator: null,
    language: "bilingual",
    tags: ["philosophy", "umasvati", "tattvartha", "metaphysics", "ethics"],
  },
  "Samaysaar.pdf": {
    title: "Samayasara",
    tradition: "jain",
    text_type: "philosophy",
    book: "Samayasara",
    translator: null,
    language: "bilingual",
    tags: ["philosophy", "kundakunda", "digambara", "soul", "atma"],
  },
  "pravachansaar.pdf": {
    title: "Pravachanasara",
    tradition: "jain",
    text_type: "philosophy",
    book: "Pravachanasara",
    translator: null,
    language: "bilingual",
    tags: ["philosophy", "kundakunda", "digambara", "doctrine"],
  },

  // Secondary scholarly works
  "Jains_Dundas.pdf": {
    title: "The Jains (Dundas)",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "overview", "history"],
  },
  "Jainism_360.pdf": {
    title: "Jainism 360",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "overview", "introduction"],
  },
  "Cort on Material Religion.pdf": {
    title: "Cort on Jain Material Religion",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "material-religion", "ritual", "cort"],
  },
  "Hegewald Jain temples.pdf": {
    title: "Hegewald on Jain Temples",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "temple", "architecture", "hegewald"],
  },
  "Humphrey-ASPECTSJAINPUJA-1984.pdf": {
    title: "Aspects of Jain Puja (Humphrey, 1984)",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "puja", "ritual", "humphrey"],
  },
  "The Perfect Body of the Jina and His Imperfect Image file86546.pdf": {
    title: "The Perfect Body of the Jina and His Imperfect Image",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "iconography", "jina", "image"],
  },

  // Practice/ritual manuals — Pratikraman (repentance avashyaka), Samayika
  // (equanimity meditation), Shravakacara (lay code of conduct, vows, daily
  // duties), Preksha Dhyana (Terapanth meditation system).
  "Pratikraman-English-full-Version.pdf": {
    title: "Pratikraman (English Full Version)",
    tradition: "jain",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["ritual", "pratikraman", "repentance", "avashyaka", "shvetambara"],
  },
  "PRatikraman - Narendra.pdf": {
    title: "Pratikraman (Narendra)",
    tradition: "jain",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["ritual", "pratikraman", "repentance", "avashyaka"],
  },
  "SAMAYIK.pdf": {
    title: "Samayik",
    tradition: "jain",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["ritual", "samayika", "meditation", "avashyaka", "equanimity"],
  },
  "SRVKACAR.pdf": {
    title: "Shravakacara",
    tradition: "jain",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["ritual", "shravakacara", "ethics", "laity", "vrata", "anuvrata"],
  },
  "preksha_dhyana.pdf": {
    title: "Preksha Dhyana",
    tradition: "jain",
    text_type: "ritual_manual",
    translator: null,
    language: "english",
    tags: ["ritual", "meditation", "preksha-dhyana", "mahapragya", "terapanth"],
  },

  // Doctrinal / philosophical reference (Todarmal's Moksha Marg Prakashak is
  // a foundational Digambara exposition of the path to liberation).
  "Moksha Marg Prakashak.pdf": {
    title: "Moksha Marg Prakashak (Todarmal)",
    tradition: "jain",
    text_type: "philosophy",
    translator: null,
    language: "english",
    tags: ["philosophy", "digambara", "todarmal", "soul", "moksha", "doctrine"],
  },

  // Secondary scholarly and introductory works.
  "12FACETSOFREALITY.pdf": {
    title: "Twelve Facets of Reality",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "anupreksha", "bhavana", "philosophy", "contemplation"],
  },
  "AHIMSA.pdf": {
    title: "Ahimsa (Jain)",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "ahimsa", "ethics"],
  },
  "First step to JAINISN book 1.pdf": {
    title: "First Step to Jainism, Book 1",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "introduction", "overview"],
  },
  "First step to JAINISN  book 2.pdf": {
    title: "First Step to Jainism, Book 2",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "introduction", "overview"],
  },
  "HANDBOOK of Jainology.pdf": {
    title: "Handbook of Jainology",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "reference", "overview"],
  },
  "Perspectives&PhilosophyInJainism.pdf": {
    title: "Perspectives & Philosophy in Jainism",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "philosophy", "scholarship"],
  },
  "Vardhaman.pdf": {
    title: "Vardhaman (Mahavira biography)",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "biography", "mahavira", "tirthankara"],
  },
  "jainpathtopurification.pdf": {
    title: "The Jaina Path of Purification (Jaini)",
    tradition: "jain",
    text_type: "secondary",
    translator: null,
    language: "english",
    tags: ["secondary", "scholarship", "overview", "ratnatraya", "moksha", "ahimsa", "jaini"],
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
};

export function lookupManifest(filename: string): SourceManifestEntry | null {
  return manifest[filename] ?? null;
}
