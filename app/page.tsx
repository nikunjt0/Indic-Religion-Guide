import Image from "next/image";

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
            A Hindu practice guide that answers ritual questions by citing the
            exact texts the tradition is built on. Delivered over iMessage.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-foreground/80">
            Text <strong className="font-semibold text-maroon">GURU</strong> to
            the bridge number to begin.
          </p>
          <p className="text-xs text-muted">
            You&rsquo;ll be asked a few questions, then you can ask anything.
          </p>
        </div>
      </section>
    </main>
  );
}
