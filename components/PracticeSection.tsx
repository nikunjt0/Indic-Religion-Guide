export default function PracticeSection({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gold/50 bg-saffron-soft/40 px-5 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
        In practice
      </h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {content}
        {streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-saffron/70" />
        ) : null}
      </p>
    </section>
  );
}
