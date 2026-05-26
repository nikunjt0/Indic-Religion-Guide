import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import PracticeSection from "@/components/PracticeSection";
import SourceSection from "@/components/SourceSection";
import { adminDb } from "@/lib/firebase/admin";
import { parseSections } from "@/lib/rag/parseSections";
import type {
  MatchedGuideRef,
  SourceGroup,
} from "@/lib/types/firestore";

interface ShareDoc {
  shortId: string;
  question: string;
  answer: string;
  sources: SourceGroup[];
  matchedGuides: MatchedGuideRef[];
  createdAt: number;
}

async function fetchShare(id: string): Promise<ShareDoc | null> {
  await connection();
  const snap = await adminDb.collection("shares").doc(id).get();
  return snap.exists ? (snap.data() as ShareDoc) : null;
}

export async function generateMetadata({ params }: PageProps<"/q/[id]">) {
  const { id } = await params;
  const share = await fetchShare(id);
  if (!share) return { title: "Quote not found — Indic Religion Guide" };
  const parsed = parseSections(share.answer);
  const description = (parsed.practice ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return {
    title: share.question.slice(0, 90),
    description: description || undefined,
    openGraph: {
      title: share.question.slice(0, 90),
      description: description || undefined,
      type: "article",
    },
  };
}

async function ShareBody({
  params,
}: {
  params: PageProps<"/q/[id]">["params"];
}) {
  const { id } = await params;
  const share = await fetchShare(id);
  if (!share) notFound();

  const parsed = parseSections(share.answer);
  const visibleSources = share.sources.filter((s) => {
    const summary = (parsed.bySourceIndex[s.index] ?? "").trim();
    return summary.toUpperCase() !== "NOT_RELEVANT";
  });

  return (
    <>
      <header className="flex flex-col gap-3 rounded-2xl border border-border-warm bg-surface/80 p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
          Question
        </p>
        <h1 className="font-display text-2xl font-semibold text-maroon sm:text-3xl">
          {share.question}
        </h1>
      </header>

      {parsed.practice ? (
        <PracticeSection content={parsed.practice} />
      ) : (
        <div className="rounded-2xl border border-border-warm bg-surface px-5 py-4 text-sm leading-relaxed text-foreground/90">
          <p className="whitespace-pre-wrap">{share.answer}</p>
        </div>
      )}

      {visibleSources.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-maroon">
            Sources
          </h2>
          {visibleSources.map((s) => (
            <SourceSection
              key={`${s.index}-${s.source_title}`}
              source={s}
              summary={parsed.bySourceIndex[s.index] ?? ""}
              defaultOpen
            />
          ))}
        </section>
      ) : null}
    </>
  );
}

export default function SharePage({ params }: PageProps<"/q/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <BackLink href="/" label="Indic Guide" />
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <ShareBody params={params} />
      </Suspense>
    </main>
  );
}
