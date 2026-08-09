import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { PublicAnswer } from "@/lib/types/companion";

export const metadata = {
  title: "Learn Hinduism — clear, sourced answers | Indic Religion Guide",
  description:
    "Clear, source-grounded answers to real questions about Hinduism — dharma, karma, the Bhagavad Gita, puja, festivals, and teaching children.",
};

async function fetchPublished(): Promise<PublicAnswer[]> {
  await connection();
  const snap = await adminDb
    .collection("publicAnswers")
    .where("reviewStatus", "==", "published")
    .get();
  return snap.docs
    .map((d) => d.data() as PublicAnswer)
    .sort((a, b) => a.question.localeCompare(b.question));
}

async function LearnIndex() {
  const answers = await fetchPublished();
  const byCategory = new Map<string, PublicAnswer[]>();
  for (const a of answers) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Learn Hinduism</h1>
      <p className="mt-3 text-neutral-600">
        Reviewed, source-grounded answers to real questions — written for curious beginners and
        diaspora families, honest about where Hindu traditions differ.
      </p>
      {answers.length === 0 ? (
        <p className="mt-8 text-neutral-500">
          The learning library is being reviewed and will appear here soon.
        </p>
      ) : (
        [...byCategory.entries()].map(([category, list]) => (
          <section key={category} className="mt-8">
            <h2 className="text-xl font-medium capitalize">{category.replace(/-/g, " ")}</h2>
            <ul className="mt-3 space-y-2">
              {list.map((a) => (
                <li key={a.slug}>
                  <Link className="text-blue-700 hover:underline" href={`/learn/${a.slug}`}>
                    {a.question}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}

export default function LearnPage() {
  return (
    <Suspense fallback={null}>
      <LearnIndex />
    </Suspense>
  );
}
