"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: "#fff8ec", color: "#2a1810" }}
      >
        <h1 className="text-2xl font-semibold">Something went wrong.</h1>
        <p className="text-sm opacity-70">{error.message}</p>
        <button
          onClick={reset}
          className="rounded-full border px-4 py-2 text-sm"
          style={{ borderColor: "#d4b283", color: "#8a3412" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
