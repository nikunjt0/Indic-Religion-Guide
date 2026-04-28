import type { UserProfile } from "../types/firestore";

const RITUAL_REGEX = /\b(puja|abhishek|aarti|arti|shraddha|vrata|homa|yajna|japa|mantra|fast(ing)?|ekadashi|sandhyavandan|temple)\b/i;

const SECT_REGEX = /\b(shaiva|vaishnava|smarta|shakta|shiva|vishnu|krishna|rama|devi|shakti)\b/i;

const REGION_REGEX = /\b(tamil|telugu|kannada|malayalam|marathi|gujarati|bengali|punjabi|north\s+ind|south\s+ind|east\s+ind|west\s+ind|kerala|karnataka|andhra)\b/i;

const SETTING_REGEX = /\b(home|temple|mandir)\b/i;

export interface ClarifyResult {
  needed: boolean;
  question?: string;
  options?: { key: string; label: string }[];
  field?: "sect" | "region" | "setting";
}

export function decideClarification(
  question: string,
  profile: Partial<UserProfile> | null,
  priorClarifications?: Record<string, string>,
): ClarifyResult {
  // Only ask if the question is about a ritual.
  if (!RITUAL_REGEX.test(question)) return { needed: false };

  // The sect clarification (Smarta/Vaishnava/Shaiva/Shakta) is Hindu-specific.
  // Skip it for users who only follow Jain — they won't have a Hindu sect to
  // pick, and we don't want to interrogate them about a category that doesn't
  // apply.
  const traditions =
    profile?.traditions && profile.traditions.length > 0
      ? profile.traditions
      : profile?.traditionPreference
        ? [profile.traditionPreference]
        : [];
  const followsHindu = traditions.length === 0 || traditions.includes("hindu");
  if (!followsHindu) return { needed: false };

  const known = {
    sect:
      profile?.sect ||
      priorClarifications?.sect ||
      SECT_REGEX.test(question) ||
      null,
    region:
      (profile?.regions && profile.regions.length > 0) ||
      profile?.region ||
      priorClarifications?.region ||
      REGION_REGEX.test(question) ||
      null,
    setting:
      priorClarifications?.setting || SETTING_REGEX.test(question) || null,
  };

  // If ANY of the three is known, we have enough signal — don't interrogate.
  if (known.sect || known.region || known.setting) return { needed: false };

  return {
    needed: true,
    field: "sect",
    question:
      "To give you a more grounded answer, which tradition do you want me to use? (You can also say 'any' and I'll answer with the widely shared version.)",
    options: [
      { key: "smarta", label: "Smarta (pan-Hindu, ishta-devata based)" },
      { key: "vaishnava", label: "Vaishnava (Vishnu / Krishna)" },
      { key: "shaiva", label: "Shaiva (Shiva)" },
      { key: "shakta", label: "Shakta (Devi)" },
      { key: "any", label: "Any — give me the common version" },
    ],
  };
}
