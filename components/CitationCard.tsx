interface ChunkCitation {
  id: string;
  source_title: string;
  chapter: string | null;
  verse: string | null;
  page: number;
  text: string;
}

export default function CitationCard({ chunk }: { chunk: ChunkCitation }) {
  const ref = [
    chunk.source_title,
    chunk.chapter && chunk.verse
      ? `${chunk.chapter}.${chunk.verse}`
      : chunk.chapter ?? null,
    `p.${chunk.page}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="rounded-xl border border-border-warm bg-surface p-4 text-sm shadow-sm">
      <header className="mb-2 font-mono text-xs font-medium text-saffron-dark">
        [{ref}]
      </header>
      <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">
        {chunk.text}
      </p>
    </article>
  );
}
