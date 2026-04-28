"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  REGIONS_BY_SLUG,
  ZONE_COLORS,
  ZONE_LABELS,
  classifyCityToRegion,
} from "@/lib/regions";
import type { MapPin } from "./LeafletIndiaMap";

// Leaflet touches `window` on import, so it cannot be SSR-rendered. We also
// skip rendering until the parent's client mount, which avoids a hydration
// mismatch on the initial paint.
const LeafletIndiaMap = dynamic(() => import("./LeafletIndiaMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[380px] items-center justify-center rounded-xl border border-border-warm bg-saffron-soft/20 text-sm text-muted">
      Loading map…
    </div>
  ),
});

export interface StoredCity {
  name: string;
  lat: number;
  lon: number;
  regionSlug: string;
}

interface Props {
  value: StoredCity[];
  onChange: (cities: StoredCity[]) => void;
}

interface Suggestion {
  label: string;
  detail: string;
  lat: number;
  lon: number;
}

const DEBOUNCE_MS = 400;

export default function CityRegionPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<
    { lat: number; lon: number; zoom?: number } | null
  >(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) return;
    // Flip to a "searching" state immediately; otherwise the dropdown flashes
    // "No matches." during the debounce window before the request even fires.
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as {
          results: Suggestion[];
          error?: string;
        };
        // Discard responses for superseded requests so fast typers don't see
        // flicker from an older query winning the race.
        if (reqId !== requestIdRef.current) return;
        if (data.error) setError(data.error);
        setSuggestions(data.results ?? []);
      } catch (err) {
        if (reqId !== requestIdRef.current) return;
        setError((err as Error).message);
        setSuggestions([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleQueryChange(next: string) {
    setQuery(next);
    if (next.trim().length < 2) {
      // Clearing in the event handler (not an effect) sidesteps the cascade
      // that synchronous setState-in-effect would trigger.
      setSuggestions([]);
      setLoading(false);
      setError(null);
    }
  }

  const pins: MapPin[] = useMemo(
    () =>
      value.map((c) => ({
        id: `${c.name}-${c.lat.toFixed(3)}-${c.lon.toFixed(3)}`,
        name: c.name,
        lat: c.lat,
        lon: c.lon,
        regionSlug: c.regionSlug,
      })),
    [value],
  );

  const regionSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of value) counts.set(c.regionSlug, (counts.get(c.regionSlug) ?? 0) + 1);
    return Array.from(counts.entries()).map(([slug, n]) => ({ slug, n }));
  }, [value]);

  function addCity(name: string, lat: number, lon: number) {
    const region = classifyCityToRegion(name, lat, lon);
    if (!region) {
      setError("Could not classify that location to a region.");
      return;
    }
    const dup = value.some(
      (c) =>
        c.name.toLowerCase() === name.toLowerCase() &&
        Math.abs(c.lat - lat) < 0.05 &&
        Math.abs(c.lon - lon) < 0.05,
    );
    if (dup) {
      setFocus({ lat, lon, zoom: 9 });
      return;
    }
    onChange([...value, { name, lat, lon, regionSlug: region.slug }]);
    setFocus({ lat, lon, zoom: 9 });
  }

  function handleSuggestion(s: Suggestion) {
    addCity(s.label, s.lat, s.lon);
    setQuery("");
    setSuggestions([]);
  }

  async function handleMapClick(lat: number, lon: number) {
    try {
      const res = await fetch(
        `/api/geocode?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
      );
      const data = (await res.json()) as { results: Suggestion[] };
      const first = data.results?.[0];
      if (first) addCity(first.label, first.lat, first.lon);
      else addCity(`(${lat.toFixed(2)}, ${lon.toFixed(2)})`, lat, lon);
    } catch {
      addCity(`(${lat.toFixed(2)}, ${lon.toFixed(2)})`, lat, lon);
    }
  }

  function removePin(id: string) {
    onChange(
      value.filter(
        (c) => `${c.name}-${c.lat.toFixed(3)}-${c.lon.toFixed(3)}` !== id,
      ),
    );
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Type a city — e.g. Madurai, Mangalore, Lucknow, Guwahati"
          className="w-full rounded-lg border border-border-warm bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-inner shadow-saffron-soft/30 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30"
        />
        {query.trim().length >= 2 ? (
          <div className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-lg border border-border-warm bg-surface shadow-lg">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted">Searching…</div>
            ) : suggestions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">
                {error ?? "No matches."}
              </div>
            ) : (
              suggestions.map((s, i) => (
                <button
                  type="button"
                  key={`${s.lat}-${s.lon}-${i}`}
                  onClick={() => handleSuggestion(s)}
                  className="block w-full border-b border-border-warm/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-saffron-soft/40"
                >
                  <div className="font-medium text-foreground">{s.label}</div>
                  <div className="text-xs text-muted">{s.detail}</div>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted">
        Search above, or click the map to drop a pin. Each city is sorted into
        a cultural region.
      </p>

      <LeafletIndiaMap
        pins={pins}
        onAddAtCoord={handleMapClick}
        onRemove={removePin}
        focus={focus}
      />

      {value.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Your cities
          </div>
          <div className="flex flex-wrap gap-1.5">
            {value.map((c, i) => {
              const region = REGIONS_BY_SLUG[c.regionSlug];
              const color = region ? ZONE_COLORS[region.zone] : "#8f2f0a";
              return (
                <span
                  key={`${c.name}-${c.lat}-${c.lon}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border-warm bg-surface px-2.5 py-1 text-xs"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="font-medium text-foreground">{c.name}</span>
                  <span className="text-muted">
                    → {region?.name ?? "unclassified"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${c.name}`}
                    className="ml-0.5 text-muted hover:text-maroon"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {regionSummary.length > 0 ? (
        <div className="rounded-lg bg-saffron-soft/40 px-4 py-2.5 text-sm ring-1 ring-border-warm/40">
          <span className="text-muted">Inferred regions: </span>
          {regionSummary.map(({ slug, n }, i) => {
            const r = REGIONS_BY_SLUG[slug];
            if (!r) return null;
            return (
              <span key={slug}>
                {i > 0 ? ", " : ""}
                <span className="font-semibold text-maroon">{r.name}</span>
                <span className="ml-1 text-xs text-muted">
                  ({ZONE_LABELS[r.zone]}
                  {n > 1 ? ` ×${n}` : ""})
                </span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
