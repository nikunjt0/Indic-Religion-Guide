// Domain of a question, used to steer both retrieval (which kind of text to
// surface) and the prompt (which kind of answer to commit to). Kept free of any
// firebase/server dependency so both lib/rag/retrieve.ts and lib/rag/prompt.ts
// can import it without prompt.ts pulling in firebase-admin.
//
// "wellness" = physical health / food / remedies → favor Ayurveda, give a
//   concrete remedy.
// "custom"   = living custom: how a wedding, festival, samskara, naming, attire,
//   or family/community rite is ACTUALLY performed by a region/sect/community.
//   The authority is established tradition, not a Vedic verse — the corpus does
//   not contain these specifics, so the model commits from its own well-
//   established knowledge (see buildUserPrompt's custom directive).
// "dharma"   = everything else (the default) → favor scripture: Gita,
//   Upanishads, and dharma-shastra (smriti + dharma sutras).
export type QueryDomain = "wellness" | "custom" | "dharma";

// Only clearly physical-health / food / remedy language flips a question to the
// wellness domain. Emotional and mental topics (anxiety, anger, fear, grief,
// desire) deliberately stay "dharma" — those are Gita/Upanishad territory, not
// Ayurveda. "Fasting" is intentionally absent: ekadashi/vrata fasting is
// dharmic, handled by smriti and the ritual manuals.
const WELLNESS_RE =
  /\b(food|diet|dietary|meal|nutrition|recipe|cook(ing)?|eat(ing)?|illness|sick(ness)?|disease|symptom|fever|cough|cold|flu|congestion|headache|migraine|nausea|nauseous|vomit(ing)?|diarrhea|constipation|indigestion|digest(ion|ive)?|bloat(ed|ing)?|acidity|acid\s*reflux|reflux|gastric|gastritis|ulcer|heartburn|stomach|tummy|belly|abdomen|abdominal|gut|bowel|intestin(e|es|al)|gas|gassy|cramp(s|ing)?|hurt(s|ing)?|queasy|puk(e|ing)|throw(ing)?\s*up|threw\s*up|pain|ache|aching|sore|sprain|wound|rash|itch(ing|y)?|skin|acne|eczema|hair|dandruff|weight|obesity|sleep|insomnia|fatigue|tired(ness)?|exhaust(ed|ion)|immun(e|ity)|detox|cleanse|herb(s|al)?|remedy|remedies|medicine|medicinal|treatment|cure|heal(ing)?|relief|relieve|dose|dosage|dosha|vata|pitta|kapha|ayurved(a|ic)|tonic|metabolism|throat|sneez(e|ing)|sniffle|arthritis|joint\s*pain|knee\s*pain|back\s*pain|menstru(al|ation)|period\s*pain|cramps)\b/i;

// Living-custom language: a specific rite/ceremony/celebration as it is actually
// performed by a region, sect, or family. These are governed by established
// tradition, not by a retrievable verse. Biased toward high-precision custom
// terms (named rites and ceremonies) so it does not swallow doctrinal questions;
// generic "festival"/"attire"/"dress" only flip the domain when paired with a
// community/region/family/celebration cue (handled by COMMUNITY_CUE_RE below).
const CUSTOM_RE =
  /\b(wedding|marriage|marry(ing)?|vivah(a|am)?|shaadi|shadi|kalyanam|nuptial|bride|groom|betroth(al|ed)?|engagement|sangeet|haldi|mehndi|mehendi|baraat|saptapadi|saptpadi|kanyadan(a|am)?|mangalsutra|mangalya|thali\s*(tying|kettu)?|muhurt(a|ham|am)?|nichayartham|nichayathartham|sumangali|oonjal|kasi\s*yatra|naming\s+(a\s+)?(child|baby|ceremony)|namakaran(a|am)?|naamkaran|cradle\s*ceremony|annaprashan(a)?|mundan|chudakaran(a|am)?|tonsure|upanayan(a|am)?|janeu|thread\s*ceremony|sacred\s*thread|seemantham|seemandham|baby\s*shower|valaikappu|griha\s*pravesh(am)?|housewarming|grah\s*shanti|funeral|last\s*rites|antyesti|antim\s*sanskar|cremation|shraddh(a|am)?|tarpan(a|am)?|pind\s*dan|death\s*anniversary)\b/i;

// Generic topic words (festival/ceremony/attire/dress/custom/tradition) only
// signal a living-custom question when ALSO tied to a community/region/family
// context cue. "What is Diwali" and "how do I perform daily puja" stay dharma;
// "how does my community celebrate Diwali" and "what do we wear for the festival
// in my region" are custom. The two regexes are deliberately AND-ed so a bare
// procedural or doctrinal question is never miscaught.
const COMMUNITY_TOPIC_RE =
  /\b(festival|celebrat(e|ed|ion|ing)|ceremony|ceremonies|custom(s)?|tradition(s|al)?|attire|dress|clothing|outfit|saree|sari|wear|food\s+custom)\b/i;

const COMMUNITY_CONTEXT_RE =
  /\b((my|our|their|the)\s+(community|region|family|caste|sect|sampradaya|people)|regional|in\s+my\s+(region|area|community|family|state))\b/i;

export function classifyDomain(question: string): QueryDomain {
  // Custom first: a "regional wedding food custom" is custom, not wellness.
  if (CUSTOM_RE.test(question)) return "custom";
  // Generic celebration/attire/custom language only counts when tied to a
  // community/region/family context cue.
  if (COMMUNITY_TOPIC_RE.test(question) && COMMUNITY_CONTEXT_RE.test(question)) {
    return "custom";
  }
  if (WELLNESS_RE.test(question)) return "wellness";
  return "dharma";
}
