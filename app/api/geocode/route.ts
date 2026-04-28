import { NextResponse } from "next/server";

// Server-side proxy for Nominatim (OpenStreetMap) geocoding. Exists because:
// (1) Nominatim's usage policy requires a descriptive User-Agent, which
// browsers don't let JS set, and (2) keeps the UA/contact info in one place.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_UA = "indic-religion-guide (contact: nikunjt0@gmail.com)";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  // Reverse lookup (map-click → city name) runs against a different endpoint
  // but returns the same shape so the client can treat it as a 0- or 1-item
  // search result.
  if (lat && lon) {
    const rev = new URL("https://nominatim.openstreetmap.org/reverse");
    rev.searchParams.set("lat", lat);
    rev.searchParams.set("lon", lon);
    rev.searchParams.set("format", "jsonv2");
    rev.searchParams.set("addressdetails", "1");
    rev.searchParams.set("accept-language", "en");
    rev.searchParams.set("zoom", "10");
    try {
      const res = await fetch(rev, {
        headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
        next: { revalidate: 86400 },
      });
      if (!res.ok) {
        return NextResponse.json(
          { results: [], error: `geocoder ${res.status}` },
          { status: 502 },
        );
      }
      const raw = (await res.json()) as {
        display_name?: string;
        lat?: string;
        lon?: string;
        address?: Record<string, string>;
      };
      if (!raw.lat || !raw.lon)
        return NextResponse.json({ results: [] });
      const a = raw.address ?? {};
      const primary =
        a.city ||
        a.town ||
        a.village ||
        a.municipality ||
        a.county ||
        a.state_district ||
        a.state ||
        (raw.display_name ? raw.display_name.split(",")[0] : "Unknown");
      const secondary = [a.state_district, a.state, a.country]
        .filter(Boolean)
        .join(", ");
      return NextResponse.json({
        results: [
          {
            label: primary,
            detail: secondary || raw.display_name || "",
            lat: Number(raw.lat),
            lon: Number(raw.lon),
          },
        ],
      });
    } catch (err) {
      return NextResponse.json(
        { results: [], error: (err as Error).message },
        { status: 502 },
      );
    }
  }

  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  // Ask for extra candidates so that after filtering/dedup we still have
  // enough to show. We slice down to a small list below.
  url.searchParams.set("limit", "12");
  // Heavy bias toward the Indian subcontinent so "Madurai" resolves to TN, not
  // to Madurai, Sri Lanka. Users can still search freely; this just reorders.
  url.searchParams.set("countrycodes", "in,np,bt,bd,lk,pk");
  url.searchParams.set("accept-language", "en");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
      // Nominatim asks that results be cached. A 24h cache on identical queries
      // is well within their acceptable-use norms.
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { results: [], error: `geocoder ${res.status}` },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
      class?: string;
      addresstype?: string;
      address?: Record<string, string>;
    }>;
    // Only accept populated-place results. Nominatim returns all sorts of
    // hits — parks, railway stations, streets, individual buildings — and
    // those just clutter the dropdown for a "pick your city" flow.
    const PLACE_ADDRESS_KEYS = [
      "city",
      "town",
      "village",
      "municipality",
      "suburb",
      "hamlet",
    ] as const;
    const ALLOWED_ADDRESSTYPES = new Set([
      "city",
      "town",
      "village",
      "municipality",
      "suburb",
      "hamlet",
      "administrative",
    ]);
    const seen = new Set<string>();
    const results: {
      label: string;
      detail: string;
      lat: number;
      lon: number;
    }[] = [];
    for (const r of raw) {
      const a = r.address ?? {};
      const primary = PLACE_ADDRESS_KEYS.map((k) => a[k]).find(Boolean);
      if (!primary) continue;
      if (
        r.class &&
        r.class !== "place" &&
        r.class !== "boundary" &&
        !(r.addresstype && ALLOWED_ADDRESSTYPES.has(r.addresstype))
      ) {
        continue;
      }
      const secondary = [a.state_district, a.state, a.country]
        .filter(Boolean)
        .join(", ");
      // Dedupe by (place name + state) so the same city showing up under
      // different admin-boundary layers collapses to one row.
      const dedupKey = `${primary.toLowerCase()}|${(a.state ?? "").toLowerCase()}|${(a.country ?? "").toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      results.push({
        label: primary,
        detail: secondary || r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      });
      if (results.length >= 6) break;
    }
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { results: [], error: (err as Error).message },
      { status: 502 },
    );
  }
}
