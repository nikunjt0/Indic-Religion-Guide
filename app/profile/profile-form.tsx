"use client";

import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getClientDb } from "@/lib/firebase/client";
import type {
  ExperienceLevel,
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

const REGIONS = [
  "north-india",
  "south-india",
  "east-india",
  "west-india",
  "tamil-nadu",
  "kerala",
  "karnataka",
  "andhra-pradesh",
  "maharashtra",
  "gujarat",
  "bengal",
  "punjab",
  "other",
];

interface Props {
  uid: string;
  email: string | null;
  initial: UserProfile | null;
}

export default function ProfileForm({ uid, email, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState({
    displayName: initial?.displayName ?? "",
    lastName: initial?.lastName ?? "",
    region: initial?.region ?? "",
    language: initial?.language ?? "english",
    sect: (initial?.sect ?? "") as Sect | "",
    experienceLevel: initial?.experienceLevel ?? "beginner",
    deityPreference: (initial?.deityPreference ?? []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const now = Date.now();
      const payload: Partial<UserProfile> = {
        uid,
        displayName: state.displayName || null,
        email,
        lastName: state.lastName || null,
        region: state.region || null,
        language: state.language,
        sect: state.sect || null,
        traditionPreference: "hindu",
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
      <Field label="Region">
        <select
          className={fieldClass}
          value={state.region}
          onChange={(e) => setState({ ...state, region: e.target.value })}
        >
          <option value="">— unspecified —</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Language">
        <select
          className={fieldClass}
          value={state.language}
          onChange={(e) => setState({ ...state, language: e.target.value })}
        >
          <option value="english">English</option>
          <option value="hindi">Hindi</option>
          <option value="tamil">Tamil</option>
          <option value="telugu">Telugu</option>
          <option value="kannada">Kannada</option>
          <option value="malayalam">Malayalam</option>
          <option value="marathi">Marathi</option>
          <option value="gujarati">Gujarati</option>
          <option value="bengali">Bengali</option>
        </select>
      </Field>
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
