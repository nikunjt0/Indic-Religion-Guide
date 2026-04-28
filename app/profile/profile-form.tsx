"use client";

import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CityRegionPicker, {
  type StoredCity,
} from "@/components/CityRegionPicker";
import LanguagePicker from "@/components/LanguagePicker";
import { getClientDb } from "@/lib/firebase/client";
import { REGIONS_BY_SLUG } from "@/lib/regions";
import type {
  ExperienceLevel,
  ProfileCity,
  Sect,
  Tradition,
  UserProfile,
} from "@/lib/types/firestore";

const SECTS: { value: Sect; label: string }[] = [
  { value: "smarta", label: "Smarta" },
  { value: "vaishnava", label: "Vaishnava" },
  { value: "shaiva", label: "Shaiva" },
  { value: "shakta", label: "Shakta" },
];

const TRADITIONS: { value: Tradition; label: string }[] = [
  { value: "hindu", label: "Hindu" },
  { value: "jain", label: "Jain" },
];

function seedTraditions(initial: UserProfile | null): Tradition[] {
  if (initial?.traditions && initial.traditions.length > 0) {
    return initial.traditions;
  }
  if (initial?.traditionPreference) return [initial.traditionPreference];
  return [];
}

const LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

interface Props {
  uid: string;
  email: string | null;
  initial: UserProfile | null;
}

// Seed cities from whatever's in the stored profile. Prefer the new `cities`
// array; fall back to the legacy single `region` slug so users who set their
// profile before the rework keep their signal.
function seedCities(initial: UserProfile | null): StoredCity[] {
  if (initial?.cities && initial.cities.length > 0) return initial.cities;
  if (initial?.region) {
    const r = REGIONS_BY_SLUG[initial.region];
    if (r)
      return [
        { name: r.name, lat: r.lat, lon: r.lon, regionSlug: r.slug },
      ];
  }
  return [];
}

// Legacy profiles stored a single lowercased language slug (e.g. "english").
// Title-case it so it matches the new picker's capitalized suggestion entries.
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function seedLanguages(initial: UserProfile | null): string[] {
  if (initial?.languages && initial.languages.length > 0) return initial.languages;
  if (initial?.language) return [titleCase(initial.language)];
  return ["English"];
}

export default function ProfileForm({ uid, email, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState({
    displayName: initial?.displayName ?? "",
    lastName: initial?.lastName ?? "",
    traditions: seedTraditions(initial),
    cities: seedCities(initial),
    languages: seedLanguages(initial),
    sect: (initial?.sect ?? "") as Sect | "",
    experienceLevel: initial?.experienceLevel ?? "beginner",
    deityPreference: (initial?.deityPreference ?? []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (state.traditions.length === 0) {
      setMessage("Please select at least one tradition (Hindu, Jain, or both).");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const now = Date.now();
      const regions = Array.from(
        new Set(state.cities.map((c) => c.regionSlug)),
      );
      const cities: ProfileCity[] = state.cities.map((c) => ({
        name: c.name,
        lat: c.lat,
        lon: c.lon,
        regionSlug: c.regionSlug,
      }));
      const payload: Partial<UserProfile> = {
        uid,
        displayName: state.displayName || null,
        email,
        lastName: state.lastName || null,
        cities,
        regions,
        // Keep the legacy single slug in sync with the primary city so older
        // read paths keep working until they're migrated.
        region: regions[0] ?? null,
        languages: state.languages,
        // Mirror the primary language into the legacy single-string field so
        // older read paths (and the prompt's fallback) still get a value.
        language: state.languages[0] ?? "",
        sect: state.sect || null,
        traditions: state.traditions,
        // Mirror the primary tradition into the legacy single field for older
        // reads (e.g. matchGuides currently uses traditionPreference).
        traditionPreference: state.traditions[0],
        experienceLevel: state.experienceLevel,
        deityPreference: state.deityPreference
          ? state.deityPreference
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        isAnonymous: !email,
        updatedAt: now,
      };
      if (!initial) payload.createdAt = now;
      await setDoc(doc(getClientDb(), "users", uid), payload, { merge: true });
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function toggleTradition(t: Tradition) {
    setState((s) => {
      const has = s.traditions.includes(t);
      const next = has
        ? s.traditions.filter((x) => x !== t)
        : [...s.traditions, t];
      return { ...s, traditions: next };
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-xl border border-saffron/40 bg-saffron-soft/40 p-4">
        <span className="text-sm font-semibold text-foreground/90">
          Which tradition(s) do you follow?
        </span>
        <p className="text-xs text-foreground/70">
          We&apos;ll cite primarily from the texts of the tradition(s) you pick.
          If you&apos;re Hindu, we&apos;ll draw on the Vedas, Upanishads, Smritis,
          and Gita. If you&apos;re Jain, we&apos;ll draw on the Agamas, Tattvartha
          Sutra, and works of Kundakunda. Pick both if you want answers from
          both. Cross-tradition questions (e.g. &ldquo;Jain vs Hindu view of X&rdquo;)
          will pull from both regardless.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {TRADITIONS.map((t) => {
            const active = state.traditions.includes(t.value);
            return (
              <button
                type="button"
                key={t.value}
                onClick={() => toggleTradition(t.value)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-saffron bg-saffron text-white shadow-sm"
                    : "border-border-strong bg-surface text-foreground/80 hover:bg-saffron-soft"
                }`}
                aria-pressed={active}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Display name">
        <input
          className={fieldClass}
          value={state.displayName}
          onChange={(e) => setState({ ...state, displayName: e.target.value })}
        />
      </Field>
      <Field label="Surname (weak hint only)">
        <input
          className={fieldClass}
          value={state.lastName}
          onChange={(e) => setState({ ...state, lastName: e.target.value })}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground/90">
          Region — cities you&apos;re culturally connected to
        </span>
        <CityRegionPicker
          value={state.cities}
          onChange={(cities) => setState({ ...state, cities })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground/90">
          Languages
        </span>
        <LanguagePicker
          value={state.languages}
          onChange={(languages) => setState({ ...state, languages })}
        />
      </div>
      {state.traditions.includes("hindu") ? (
        <Field label="Sect (leave blank if unsure)">
          <select
            className={fieldClass}
            value={state.sect}
            onChange={(e) =>
              setState({ ...state, sect: e.target.value as Sect | "" })
            }
          >
            <option value="">— unspecified —</option>
            {SECTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Experience level">
        <select
          className={fieldClass}
          value={state.experienceLevel}
          onChange={(e) =>
            setState({
              ...state,
              experienceLevel: e.target.value as ExperienceLevel,
            })
          }
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Deity preferences (comma-separated)">
        <input
          className={fieldClass}
          placeholder="e.g. shiva, ganesha"
          value={state.deityPreference}
          onChange={(e) =>
            setState({ ...state, deityPreference: e.target.value })
          }
        />
      </Field>
      <div className="flex items-center gap-3 pt-2">
        <button
          className="rounded-full bg-saffron px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark disabled:opacity-50"
          type="submit"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        {message ? (
          <span className="text-sm text-muted">{message}</span>
        ) : null}
      </div>
    </form>
  );
}

const fieldClass =
  "w-full rounded-lg border border-border-warm bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-inner shadow-saffron-soft/30 transition focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-foreground/90">{label}</span>
      {children}
    </label>
  );
}
