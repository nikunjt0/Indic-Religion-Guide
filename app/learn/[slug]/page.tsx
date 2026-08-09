import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { PublicAnswer } from "@/lib/types/companion";

const BASE_URL = (
  process.env.PUBLIC_APP_URL ??
  process.env.APP_PUBLIC_URL ??
  "https://example.com"
).replace(/\/$/, "");

async function fetchAnswer(slug: string): Promise<PublicAnswer | null> {
  await connection();
  const snap = await adminDb
    .collection("publicAnswers")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const answer = snap.docs[0].data() as PublicAnswer;
  // Unpublished content is never served publicly — not even by direct URL.
  return answer.reviewStatus === "published" ? answer : null;
}

export async function generateMetadata({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const answer = await fetchAnswer(slug);
  if (!answer) return { title: "Not found" };
  const canonical = `${BASE_URL}/learn/${answer.slug}`;
  return {
    title: answer.titleTag,
    description: answer.metaDescription,
    alternates: { canonical },
    robots:
      answer.indexingStatus === "index"
        ? { index: true, follow: true }
        : { index: false, follow: true },
    openGraph: {
      title: answer.titleTag,
      description: answer.metaDescription,
      type: "article",
      url: canonical,
    },
  };
}

async function AnswerBody({ params }: { params: PageProps<"/learn/[slug]">["params"] }) {
  const { slug } = await params;
  const answer = await fetchAnswer(slug);
  if (!answer) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: answer.question,
    description: answer.metaDescription,
    dateModified: answer.lastReviewedAt ? new Date(answer.lastReviewedAt).toISOString() : undefined,
    mainEntityOfPage: `${BASE_URL}/learn/${answer.slug}`,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav className="text-sm text-neutral-500">
        <Link href="/learn" className="hover:underline">
          Learn Hinduism
        </Link>{" "}
        / <span className="capitalize">{answer.category.replace(/-/g, " ")}</span>
      </nav>
      <h1 className="mt-3 text-3xl font-semibold">{answer.question}</h1>

      <p className="mt-5 text-lg leading-relaxed">{answer.shortAnswer}</p>

      <section className="prose mt-6 max-w-none whitespace-pre-wrap leading-relaxed">
        {answer.fullAnswer}
      </section>

      {answer.perspectives && (
        <section className="mt-8">
          <h2 className="text-xl font-medium">How Hindu traditions see this</h2>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{answer.perspectives}</p>
        </section>
      )}

      {answer.practicalTakeaway && (
        <section className="mt-8">
          <h2 className="text-xl font-medium">Practical takeaway</h2>
          <p className="mt-2 leading-relaxed">{answer.practicalTakeaway}</p>
        </section>
      )}

      {answer.childExplanation && (
        <section className="mt-8 rounded-lg bg-amber-50 p-4">
          <h2 className="text-lg font-medium">Explaining it to children</h2>
          <p className="mt-2 leading-relaxed">{answer.childExplanation}</p>
        </section>
      )}

      {answer.sourceRefs && answer.sourceRefs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-medium">Sources</h2>
          <ul className="mt-2 list-disc pl-5 text-neutral-700">
            {answer.sourceRefs.map((s, i) => (
              <li key={i}>
                {s.title}
                {s.reference ? ` — ${s.reference}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {answer.relatedSlugs && answer.relatedSlugs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-medium">Related questions</h2>
          <ul className="mt-2 space-y-1">
            {answer.relatedSlugs.map((s) => (
              <li key={s}>
                <Link className="text-blue-700 hover:underline" href={`/learn/${s}`}>
                  {s.replace(/-/g, " ")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <aside className="mt-10 rounded-lg border border-neutral-200 p-5">
        <p className="font-medium">Learn Hinduism one idea at a time.</p>
        <p className="mt-1 text-neutral-600">
          Get one short, sourced teaching by text each morning — including the free 21-day
          Hinduism 101 series.
        </p>
      </aside>

      {answer.lastReviewedAt && (
        <p className="mt-6 text-sm text-neutral-500">
          Last reviewed {new Date(answer.lastReviewedAt).toLocaleDateString("en-US", { dateStyle: "long" })}
          {answer.reviewers?.length ? ` by ${answer.reviewers.join(", ")}` : ""}.
        </p>
      )}
    </main>
  );
}

export default function PublicAnswerPage({ params }: PageProps<"/learn/[slug]">) {
  return (
    <Suspense fallback={null}>
      <AnswerBody params={params} />
    </Suspense>
  );
}
