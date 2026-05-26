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
  UserProfile,
} from "@/lib/types/firestore";

const SECTS: { value: Sect; label: string }[] = [
  { value: "smarta", label: "Smarta" },
  { value: "vaishnava", label: "Vaishnava" },
  { value: "shaiva", label: "Shaiva" },
  { value: "shakta", label: "Shakta" },
];

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
    cities: seedCities(initial),
    languages: seedLanguages(initial),
    sect: (initial?.sect ?? "") as Sect | "",
    experienceLevel: initial?.experienceLevel ?? "beginner",
    deityPreference: (initial?.deityPreference ?? []).join(", "),
    additionalInfo: initial?.additionalInfo ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
        traditions: ["hindu"],
        traditionPreference: "hindu",
        experienceLevel: state.experienceLevel,
        deityPreference: state.deityPreference
          ? state.deityPreference
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        additionalInfo: state.additionalInfo.trim() || null,
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

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
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
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground/90">
          Additional info
        </span>
        <span className="text-xs text-foreground/65">
          Free-form instructions for the guru. For example: &ldquo;ignore the
          Vedas and classical texts, focus only on the Upanishads and Gita,&rdquo;
          or &ldquo;skip Sanskrit, English only.&rdquo;
        </span>
        <textarea
          className={`${fieldClass} min-h-[5.5rem] resize-y`}
          placeholder="Anything else we should know?"
          value={state.additionalInfo}
          onChange={(e) =>
            setState({ ...state, additionalInfo: e.target.value })
          }
          maxLength={2000}
        />
      </label>
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
