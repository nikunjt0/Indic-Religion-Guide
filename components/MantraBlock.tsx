export default function MantraBlock({
  mantra,
}: {
  mantra: {
    text: string;
    transliteration?: string;
    meaning?: string;
  };
}) {
  return (
    <div className="rounded-lg border border-border-warm bg-saffron-soft/50 p-3.5 text-sm">
      <p
        lang="sa"
        className="devanagari text-base leading-relaxed text-maroon"
      >
        {mantra.text}
      </p>
      {mantra.transliteration ? (
        <p className="mt-1 text-xs italic text-saffron-dark">
          {mantra.transliteration}
        </p>
      ) : null}
      {mantra.meaning ? (
        <p className="mt-1 text-xs text-muted">{mantra.meaning}</p>
      ) : null}
    </div>
  );
}
