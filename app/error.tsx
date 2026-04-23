"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-maroon">
        Something went wrong.
      </h1>
      <p className="text-sm text-foreground/75">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-full border border-border-strong bg-surface px-5 py-2 text-sm font-semibold text-saffron-dark transition hover:bg-saffron-soft"
      >
        Try again
      </button>
    </main>
  );
}
