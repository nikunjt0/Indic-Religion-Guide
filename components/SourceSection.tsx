"use client";

import { useState } from "react";
import CitationCard from "@/components/CitationCard";
import type { SourceGroup } from "@/lib/types/firestore";

export default function SourceSection({
  source,
  summary,
  streaming,
  defaultOpen = false,
}: {
  source: SourceGroup;
  summary: string;
  streaming?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = summary.trim();
  const isNotRelevant = trimmed.toUpperCase() === "NOT_RELEVANT";
  const waitingForSummary = streaming && !trimmed;

  return (
    <article className="overflow-hidden rounded-2xl border border-border-warm bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-saffron-soft/30"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-saffron-dark">
            Source
          </span>
          <span className="font-display text-base font-semibold text-maroon">
            {source.source_title}
          </span>
          <span className="text-[11px] text-muted">
            {source.quotes.length} {source.quotes.length === 1 ? "quote" : "quotes"}
          </span>
        </div>
        <span
          className={`text-saffron-dark transition ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-border-warm bg-saffron-soft/20 px-5 py-4">
          {source.quotes.map((q) => (
            <CitationCard key={q.id} chunk={q} />
          ))}
        </div>
      ) : null}

      <div className="border-t border-border-warm px-5 py-4 text-sm leading-relaxed">
        {isNotRelevant ? (
          <p className="text-muted italic">
            This source does not directly address the question.
          </p>
        ) : trimmed ? (
          <p className="whitespace-pre-wrap text-foreground/90">
            {trimmed}
            {streaming ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-saffron/70" />
            ) : null}
          </p>
        ) : waitingForSummary ? (
          <p className="flex items-center gap-2 text-muted">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-saffron" />
            Reading…
          </p>
        ) : (
          <p className="text-muted italic">No summary generated.</p>
        )}
      </div>
    </article>
  );
}
