import { REGIONS, REGIONS_BY_SLUG } from "../../lib/regions.ts";
import type { ProfileCity, UserProfile } from "../../lib/types/firestore.ts";
import { INDIAN_LANGUAGES } from "../../lib/languages.ts";
import { imessageUsersCol } from "./firestore.ts";
import { log } from "./logger.ts";

export type OnboardingState =
  | "intro"
  | "ask_name"
  | "ask_city"
  | "ask_languages"
  | "ask_additional"
  | "complete";

export interface IMessageUser extends Partial<UserProfile> {
  handleId: string;
  handle: string;
  chatGuid?: string;
  onboardingState: OnboardingState;
  /** Comp flag — full access without paying. Defaults true while we grow the tester pool. */
  freeTestingUser?: boolean;
  /** Synced mirror of the Stripe subscription (lib/billing/membership.ts). */
  billing?: unknown;
}

export async function getOrCreate(
  handleId: string,
  handle: string,
  chatGuid: string,
): Promise<{ user: IMessageUser; created: boolean }> {
  const ref = imessageUsersCol().doc(handleId);
  const snap = await ref.get();
  if (snap.exists) {
    const user = snap.data() as IMessageUser;
    if (!user.chatGuid && chatGuid) {
      await ref.update({ chatGuid });
      user.chatGuid = chatGuid;
    }
    return { user, created: false };
  }
  const now = Date.now();
  const user: IMessageUser = {
    handleId,
    handle,
    chatGuid,
    onboardingState: "intro",
    freeTestingUser: true,
    traditions: ["hindu"],
    traditionPreference: "hindu",
    experienceLevel: "beginner",
    language: "english",
    isAnonymous: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(user);
  return { user, created: true };
}

async function patch(handleId: string, updates: Partial<IMessageUser>): Promise<void> {
  await imessageUsersCol()
    .doc(handleId)
    .set({ ...updates, updatedAt: Date.now() }, { merge: true });
}

// Step-by-step prompts. The intro is several messages concatenated with
// blank lines so they render as a single iMessage but read like a brief
// introduction. The bridge will split into separate sends if it exceeds the
// SMS-segment cap.
const INTRO = [
  "🪔 Namaste, and welcome — I'm so glad you're here. I'm the Guru, a friendly guide to Hindu practice, here for you whenever a question comes up.",
  "Ask me anything about ritual, scripture, fasting, meditation, doctrine, or your daily sadhana — and I'll always point you to the texts the answer comes from (Vedas, Upanishads, Smritis, Gita, Agamas, Ayurveda).",
  "To start, I'd love to get to know you with four quick questions, so I can tailor everything to you.",
].join("\n\n");

export const PROMPTS: Record<OnboardingState, string> = {
  intro: INTRO,
  ask_city: "Which city or region in India are you most connected to? (e.g. Chennai, Pune, Delhi)",
  ask_name: "What's your full name?",
  ask_languages:
    "Which languages can you read? Reply with a comma-separated list (e.g. English, Hindi, Tamil). If unsure, just reply 'English'.",
  ask_additional:
    "Anything else I should know? — sect, lineage, deities you favor, books to lean on or avoid. Reply 'skip' if none.",
  complete: "You're set. Ask me anything about practice, ritual, or doctrine.",
};

// What we emit to the user *after* advancing to the named state. Returns an
// array because some transitions emit multiple messages (intro + first
// question; final completion confirmation by itself).
export function promptsFor(state: OnboardingState): string[] {
  switch (state) {
    case "intro":
      return [PROMPTS.intro];
    case "ask_city":
    case "ask_name":
    case "ask_languages":
    case "ask_additional":
    case "complete":
      return [PROMPTS[state]];
  }
}

// --- city / region resolution -------------------------------------------------

function resolveCityByAlias(input: string): { region: ReturnType<typeof aliasHit>; name: string } | null {
  const needle = input.trim().toLowerCase();
  const region = aliasHit(needle);
  if (!region) return null;
  return { region, name: titleCase(needle) };
}

function aliasHit(needle: string) {
  let best: { region: (typeof REGIONS)[number]; score: number } | null = null;
  for (const r of REGIONS) {
    for (const alias of r.aliases ?? []) {
      if (
        needle === alias ||
        needle.startsWith(`${alias} `) ||
        needle.startsWith(`${alias},`) ||
        needle.includes(` ${alias} `) ||
        needle.endsWith(` ${alias}`)
      ) {
        const score = alias.length;
        if (!best || score > best.score) best = { region: r, score };
      }
    }
  }
  return best?.region ?? null;
}

function titleCase(s: string): string {
  return s
    .split(/(\s+)/)
    .map((w) => (w.match(/^\w/) ? w[0].toUpperCase() + w.slice(1) : w))
    .join("");
}

// --- per-state input handlers -------------------------------------------------

export interface AdvanceResult {
  next: OnboardingState;
  reply: string[];
  // If true, this turn was a validation reject — re-ask the same state.
  reject?: boolean;
}

export async function advance(
  user: IMessageUser,
  input: string,
): Promise<AdvanceResult> {
  const text = (input ?? "").trim();
  switch (user.onboardingState) {
    case "intro":
      // Intro is auto-advanced when the GURU trigger fires — index.ts handles
      // this directly. If we ever land here with a user message, advance to
      // ask_name.
      await patch(user.handleId, { onboardingState: "ask_name" });
      return { next: "ask_name", reply: [PROMPTS.intro, PROMPTS.ask_name] };

    case "ask_city": {
      if (text.length < 2) {
        return { next: "ask_city", reply: ["I didn't catch that. " + PROMPTS.ask_city], reject: true };
      }
      const hit = resolveCityByAlias(text);
      let cities: ProfileCity[];
      let regions: string[];
      if (hit && hit.region) {
        cities = [{ name: hit.name, lat: hit.region.lat, lon: hit.region.lon, regionSlug: hit.region.slug }];
        regions = [hit.region.slug];
      } else {
        // Fall back to Nominatim geocoder. If still nothing, keep the raw name
        // and tag regionSlug "unknown" so onboarding doesn't stall.
        const geo = await geocode(text);
        if (geo) {
          const slug = geo.regionSlug;
          cities = [{ name: geo.name, lat: geo.lat, lon: geo.lon, regionSlug: slug }];
          regions = slug === "unknown" ? [] : [slug];
        } else {
          cities = [{ name: text, lat: 0, lon: 0, regionSlug: "unknown" }];
          regions = [];
        }
      }
      await patch(user.handleId, {
        cities,
        regions,
        region: regions[0] ?? null,
        onboardingState: "ask_languages",
      });
      return { next: "ask_languages", reply: [PROMPTS.ask_languages] };
    }

    case "ask_name": {
      if (text.length < 2 || text.length > 80 || !/[a-zA-Zऀ-ॿ]/.test(text)) {
        return {
          next: "ask_name",
          reply: ["I need a name with at least one letter, 2–80 characters. " + PROMPTS.ask_name],
          reject: true,
        };
      }
      const parts = text.split(/\s+/);
      const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
      await patch(user.handleId, {
        displayName: text,
        lastName,
        onboardingState: "ask_city",
      });
      return { next: "ask_city", reply: [PROMPTS.ask_city] };
    }

    case "ask_languages": {
      const parsed = parseLanguages(text);
      await patch(user.handleId, {
        languages: parsed,
        language: parsed[0]?.toLowerCase() ?? "english",
        onboardingState: "ask_additional",
      });
      return { next: "ask_additional", reply: [PROMPTS.ask_additional] };
    }

    case "ask_additional": {
      const skip = /^\s*(skip|none|no|n\/a|na)\s*$/i.test(text);
      const additionalInfo = skip ? null : text.slice(0, 2000);
      await patch(user.handleId, {
        additionalInfo,
        onboardingState: "complete",
      });
      return { next: "complete", reply: [PROMPTS.complete] };
    }

    case "complete":
      // Caller should route to the RAG path — not advance().
      return { next: "complete", reply: [] };
  }
}

function parseLanguages(input: string): string[] {
  const raw = input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (raw.length === 0) return ["English"];
  // Title-case + match against the suggestion list when possible for canonical
  // names; otherwise keep the user's spelling capped at 30 chars.
  const suggestionsLower = new Map(
    INDIAN_LANGUAGES.map((s) => [s.toLowerCase(), s] as const),
  );
  return raw.map((entry) => {
    const matched = suggestionsLower.get(entry.toLowerCase());
    if (matched) return matched;
    return titleCase(entry).slice(0, 30);
  });
}

// --- geocoder fallback --------------------------------------------------------

const NOMINATIM_UA = "indic-religion-guide-bridge (contact: nikunjt0@gmail.com)";

interface GeoHit {
  name: string;
  lat: number;
  lon: number;
  regionSlug: string;
}

async function geocode(q: string): Promise<GeoHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "in,np,bt,bd,lk,pk");
  url.searchParams.set("accept-language", "en");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
    });
    if (!res.ok) {
      log.warn(`geocoder ${res.status} for "${q}"`);
      return null;
    }
    const raw = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      address?: Record<string, string>;
    }>;
    const first = raw[0];
    if (!first) return null;
    const a = first.address ?? {};
    const name =
      a.city || a.town || a.village || a.municipality || a.county ||
      first.display_name.split(",")[0];
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    // Use the existing classifier (alias + nearest centroid).
    const region = classifyByCoords(name ?? q, lat, lon);
    return {
      name: name ?? q,
      lat,
      lon,
      regionSlug: region?.slug ?? "unknown",
    };
  } catch (err) {
    log.warn(`geocoder threw: ${(err as Error).message}`);
    return null;
  }
}

function classifyByCoords(name: string, lat: number, lon: number) {
  // Mini-version of lib/regions.ts classifyCityToRegion — avoid pulling in the
  // module to keep the dependency surface narrow and avoid haversine import.
  const needle = name.trim().toLowerCase();
  const aliased = aliasHit(needle);
  if (aliased) return aliased;
  let nearest: { region: (typeof REGIONS)[number]; dist: number } | null = null;
  for (const r of REGIONS) {
    const dLat = ((r.lat - lat) * Math.PI) / 180;
    const dLon = ((r.lon - lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) *
        Math.cos((r.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const dist = 2 * 6371 * Math.asin(Math.sqrt(a));
    if (!nearest || dist < nearest.dist) nearest = { region: r, dist };
  }
  return nearest?.region ?? null;
}

// Suppress unused-import warning for REGIONS_BY_SLUG in case the import is
// kept for future use — referenced here so the linter doesn't strip it.
void REGIONS_BY_SLUG;
