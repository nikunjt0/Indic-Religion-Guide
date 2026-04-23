import Link from "next/link";
import BackLink from "@/components/BackLink";
import AskClient from "./ask-client";

export const metadata = {
  title: "Ask — Indic Religion Guide",
};

export default function AskPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <BackLink href="/" label="Back to home" />
      <header className="flex items-start justify-between gap-4 rounded-2xl border border-border-warm bg-surface/80 p-5">
        <div>
          <h1 className="font-display text-3xl font-semibold text-maroon">
            Ask
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-foreground/75">
            Ask a practice question. We&apos;ll cite primary texts where we can
            and fall back to curated ritual guides for procedure.
          </p>
        </div>
        <Link
          href="/chats"
          className="shrink-0 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-xs font-semibold text-saffron-dark transition hover:bg-saffron-soft"
        >
          History
        </Link>
      </header>
      <AskClient />
    </main>
  );
}
