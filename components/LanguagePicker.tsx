"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INDIAN_LANGUAGES } from "@/lib/languages";

interface Props {
  value: string[];
  onChange: (langs: string[]) => void;
}

const MAX_SUGGESTIONS = 40;

export default function LanguagePicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const selected = new Set(value.map((v) => v.toLowerCase()));
    const pool = INDIAN_LANGUAGES.filter((l) => !selected.has(l.toLowerCase()));
    if (!q) return pool.slice(0, MAX_SUGGESTIONS);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const l of pool) {
      const low = l.toLowerCase();
      if (low.startsWith(q)) starts.push(l);
      else if (low.includes(q)) contains.push(l);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [query, value]);

  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  function add(lang: string) {
    const trimmed = lang.trim();
    if (!trimmed) return;
    if (value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setQuery("");
    // Keep the dropdown open so picking multiple languages in sequence is fast.
    setOpen(true);
    inputRef.current?.focus();
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) add(suggestions[0]);
      else if (query.trim()) add(query);
    } else if (e.key === "Backspace" && !query && value.length > 0) {
      removeAt(value.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showCustomHint =
    query.trim().length > 0 &&
    !INDIAN_LANGUAGES.some(
      (l) => l.toLowerCase() === query.trim().toLowerCase(),
    ) &&
    !value.some((v) => v.toLowerCase() === query.trim().toLowerCase());

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-warm bg-surface px-3 py-2 shadow-inner shadow-saffron-soft/30 focus-within:border-saffron focus-within:ring-2 focus-within:ring-saffron/30"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-saffron-soft/60 px-2.5 py-0.5 text-xs font-medium text-maroon ring-1 ring-border-warm/40"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              className="text-muted hover:text-maroon"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={
            value.length === 0 ? "Start typing a language…" : "Add another…"
          }
          autoComplete="off"
          className="min-w-[10ch] flex-1 bg-transparent py-0.5 text-sm text-foreground focus:outline-none"
        />
      </div>

      {open && (suggestions.length > 0 || showCustomHint) ? (
        <div className="absolute left-0 right-0 top-full z-[1300] mt-1 max-h-64 overflow-auto rounded-lg border border-border-warm bg-surface shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="block w-full border-b border-border-warm/40 px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-saffron-soft/40"
            >
              {s}
            </button>
          ))}
          {showCustomHint ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(query)}
              className="block w-full border-t border-border-warm/40 bg-saffron-soft/20 px-3 py-1.5 text-left text-sm hover:bg-saffron-soft/50"
            >
              Add &ldquo;{query.trim()}&rdquo;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
