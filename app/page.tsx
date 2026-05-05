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
            citing the exact texts our traditions are built on.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/ask"
            className="rounded-full bg-saffron px-7 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-saffron-dark"
          >
            Ask a question
          </Link>
        </div>
      </section>
    </main>
  );
}
