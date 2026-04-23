import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import StepList from "@/components/StepList";
import { adminDb } from "@/lib/firebase/admin";
import type { RitualGuide } from "@/lib/types/firestore";

async function fetchGuide(slug: string): Promise<RitualGuide | null> {
  await connection();
  const snap = await adminDb.collection("ritualGuides").doc(slug).get();
  return snap.exists ? (snap.data() as RitualGuide) : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/guides/[slug]">) {
  const { slug } = await params;
  return { title: `${slug} — Indic Religion Guide` };
}

async function GuideBody({
  params,
}: {
  params: PageProps<"/guides/[slug]">["params"];
}) {
  const { slug } = await params;
  const guide = await fetchGuide(slug);
  if (!guide) notFound();

  return (
    <>
      <header className="flex flex-col gap-3 rounded-2xl border border-border-warm bg-surface/80 p-6">
        <h1 className="font-display text-3xl font-semibold text-maroon sm:text-4xl">
          {guide.title}
        </h1>
        <p className="text-sm leading-relaxed text-foreground/80">
          {guide.summary}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Meta
            label="Sects"
            value={guide.appliesTo.sects.join(", ") || "any"}
          />
          <Meta
            label="Regions"
            value={guide.appliesTo.regions.join(", ") || "any"}
          />
          <Meta label="Setting" value={guide.appliesTo.setting.join(", ")} />
          <Meta label="Level" value={guide.appliesTo.level.join(", ")} />
        </dl>
      </header>

      <section>
        <h2 className="mb-4 font-display text-2xl font-semibold text-maroon">
          Steps
        </h2>
        <StepList steps={guide.steps} />
      </section>

      {guide.variants && guide.variants.length > 0 ? (
        <section>
          <h2 className="mb-4 font-display text-2xl font-semibold text-maroon">
            Variants
          </h2>
          <ul className="flex flex-col gap-3">
            {guide.variants.map((v, i) => (
              <li
                key={i}
                className="rounded-xl border border-border-warm bg-surface p-4 text-sm"
              >
                <p className="font-semibold text-saffron-dark">
                  {v.label}{" "}
                  <span className="font-mono text-xs text-muted">
                    ({v.when})
                  </span>
                </p>
                <p className="mt-1 text-foreground/80">{v.instruction}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {guide.sources && guide.sources.length > 0 ? (
        <section>
          <h2 className="mb-4 font-display text-2xl font-semibold text-maroon">
            Source pointers
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {guide.sources.map((s, i) => (
              <li
                key={i}
                className="rounded-xl border border-border-warm bg-surface p-3"
              >
                <span className="font-mono text-xs text-saffron-dark">
                  [{s.source_title}
                  {s.chapter ? `, ${s.chapter}${s.verse ? `.${s.verse}` : ""}` : ""}
                  {s.page ? `, p.${s.page}` : ""}]
                </span>
                {s.quote ? (
                  <p className="mt-1 italic text-foreground/80">
                    &ldquo;{s.quote}&rdquo;
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export default function GuideDetailPage({
  params,
}: PageProps<"/guides/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <BackLink href="/guides" label="All guides" />
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <GuideBody params={params} />
      </Suspense>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-saffron-soft/60 px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-saffron-dark">
        {label}
      </dt>
      <dd className="mt-0.5 text-foreground/85">{value}</dd>
    </div>
  );
}
