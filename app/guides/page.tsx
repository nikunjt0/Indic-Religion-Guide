import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import { adminDb } from "@/lib/firebase/admin";
import type { RitualGuide } from "@/lib/types/firestore";

export const metadata = {
  title: "Ritual guides — Indic Religion Guide",
};

async function fetchGuides(): Promise<RitualGuide[]> {
  await connection();
  const snap = await adminDb
    .collection("ritualGuides")
    .where("tradition", "==", "hindu")
    .get();
  return snap.docs
    .map((d) => d.data() as RitualGuide)
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function GuideList() {
  const guides = await fetchGuides();

  if (guides.length === 0) {
    return (
      <p className="rounded-xl border border-border-warm bg-surface p-6 text-sm text-muted">
        No guides yet. Run{" "}
        <code className="rounded bg-saffron-soft px-1.5 py-0.5 font-mono text-saffron-dark">
          npm run seed:guides
        </code>
        .
      </p>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {guides.map((g) => (
        <li key={g.slug}>
          <Link
            href={`/guides/${g.slug}`}
            className="flex h-full flex-col gap-3 rounded-2xl border border-border-warm bg-surface p-6 shadow-sm transition hover:border-saffron hover:shadow-md"
          >
            <h2 className="font-display text-xl font-semibold text-maroon">
              {g.title}
            </h2>
            <p className="flex-1 text-sm leading-relaxed text-foreground/75">
              {g.summary}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {g.tags.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs font-medium text-saffron-dark"
                >
                  {t}
                </span>
              ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function GuidesPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <BackLink href="/" label="Back to home" />
      <header className="flex flex-col gap-2 rounded-2xl border border-border-warm bg-surface/80 p-6">
        <h1 className="font-display text-3xl font-semibold text-maroon">
          Ritual guides
        </h1>
        <p className="text-sm leading-relaxed text-foreground/75">
          Curated procedures. Where traditions differ, variants are listed
          inside each guide.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <GuideList />
      </Suspense>
    </main>
  );
}
