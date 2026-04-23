import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-8 px-6 pt-16 pb-12 text-center sm:pt-24">
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-saffron-soft via-transparent to-transparent blur-2xl"
          />
          <Image
            src="/Ornate-Dharma-Wheel.svg"
            alt="Dharma Wheel"
            width={140}
            height={140}
            priority
            className="drop-shadow-sm"
          />
        </div>
        <div className="flex flex-col gap-4">
          <p className="om-divider text-xs uppercase tracking-[0.35em] text-saffron-dark">
            <span className="devanagari text-base">ॐ</span>
            <span>sanatana · vidya</span>
            <span className="devanagari text-base">ॐ</span>
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-maroon sm:text-6xl">
            Practice, grounded in the texts.
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-foreground/80 sm:text-lg">
            An Indic religion guide that answers ritual-practice questions by
            citing the Vedas, Upanishads, Smritis, and Gita — and falls back to
            curated ritual procedures when the texts don&apos;t spell it out.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/ask"
            className="rounded-full bg-saffron px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark"
          >
            Ask a question
          </Link>
          <Link
            href="/guides"
            className="rounded-full border border-border-strong bg-surface px-7 py-3 text-sm font-semibold text-saffron-dark transition hover:bg-saffron-soft"
          >
            Browse ritual guides
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-6 py-10 sm:grid-cols-3">
        <Layer
          number="A"
          title="Primary texts"
          body="Every scriptural quote comes with a citation — source, chapter, verse, page. The model never invents quotes."
        />
        <Layer
          number="B"
          title="Ritual guides"
          body="Curated procedures for daily puja, abhishekam, aarti, fasting, and more. Because the Upanishads don't tell you how to set up an altar."
        />
        <Layer
          number="C"
          title="Your profile"
          body="Your sect, region, language, and experience level shape which variant of a ritual we describe — but never determine authority."
        />
      </section>

      <footer className="mx-auto w-full max-w-5xl px-6 py-10 text-center text-xs text-muted">
        Beginner content. Where traditions differ, we say so.
      </footer>
    </main>
  );
}

function Layer({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border-warm bg-surface/80 p-6 shadow-[0_1px_0_rgba(124,45,18,0.04)] transition hover:border-border-strong hover:bg-surface">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-saffron-soft font-mono text-[11px] font-semibold text-saffron-dark">
        {number}
      </span>
      <h3 className="font-display text-xl font-semibold text-maroon">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-foreground/75">{body}</p>
    </div>
  );
}
