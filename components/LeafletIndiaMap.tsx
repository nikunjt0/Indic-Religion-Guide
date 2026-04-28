"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { REGIONS_BY_SLUG, ZONE_COLORS } from "@/lib/regions";

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lon: number;
  regionSlug: string;
}

interface Props {
  pins: MapPin[];
  // When the user clicks empty map area, we ask the parent to add a pin at
  // that location. The parent does reverse geocoding + region classification.
  onAddAtCoord: (lat: number, lon: number) => void;
  onRemove: (id: string) => void;
  // Optional: flies the map to a coordinate. Updated via prop so the parent
  // controls focus (e.g. after a successful geocode from the search bar).
  focus?: { lat: number; lon: number; zoom?: number } | null;
}

// Leaflet's bundled marker images resolve relative to the CSS file, which
// doesn't survive Next.js's bundler. Pointing to unpkg ensures icons render
// without copying PNGs into /public.
function fixDefaultIcon() {
  type IconPrototype = L.Icon.Default & { _getIconUrl?: unknown };
  delete (L.Icon.Default.prototype as IconPrototype)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Why imperative? react-leaflet 5.0's MapContainer never clears its internal
// `mapInstanceRef` on cleanup, so on certain remount paths (React 19 strict
// mode + Next.js soft navigation, e.g. /ask → /profile) the new mount races
// against a stale ref and Leaflet throws "Map container is being reused by
// another instance". Owning the L.Map lifecycle directly here makes teardown
// deterministic — every unmount calls `map.remove()` and we drop the ref.
export default function LeafletIndiaMap({
  pins,
  onAddAtCoord,
  onRemove,
  focus,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  // Keep the latest callback handlers in a ref so the click listener (bound
  // once at map init) sees fresh closures without us tearing the map down.
  const handlersRef = useRef({ onAddAtCoord, onRemove });
  handlersRef.current = { onAddAtCoord, onRemove };

  // Map init / teardown — runs once per mount.
  useEffect(() => {
    fixDefaultIcon();
    const container = containerRef.current;
    if (!container) return;

    // Defensive: if a prior unmount didn't clear `_leaflet_id` (e.g. an
    // exception during teardown), wipe it before init so Leaflet doesn't
    // refuse to attach.
    type LeafletContainer = HTMLElement & { _leaflet_id?: number };
    const containerWithId = container as LeafletContainer;
    if (containerWithId._leaflet_id != null) {
      delete containerWithId._leaflet_id;
    }

    const map = L.map(container, {
      center: [22.5, 79],
      zoom: 4,
      minZoom: 3,
      maxZoom: 12,
      scrollWheelZoom: true,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      handlersRef.current.onAddAtCoord(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers with the `pins` prop. Diff against the existing marker map so
  // we don't tear down/rebuild every marker on each render.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = markersRef.current;
    const seen = new Set<string>();

    for (const p of pins) {
      seen.add(p.id);
      const region = REGIONS_BY_SLUG[p.regionSlug];
      const color = region ? ZONE_COLORS[region.zone] : "#8f2f0a";
      const prior = existing.get(p.id);
      if (prior) {
        prior.setLatLng([p.lat, p.lon]);
        prior.setIcon(pinIcon(color));
        continue;
      }
      const marker = L.marker([p.lat, p.lon], { icon: pinIcon(color) }).addTo(
        map,
      );
      const popupHtml = document.createElement("div");
      popupHtml.style.minWidth = "160px";
      popupHtml.innerHTML = `
        <div style="font-weight:600;">${escapeHtml(p.name)}</div>
        <div style="font-size:12px;color:#6b5740;">Region: ${escapeHtml(
          region?.name ?? "unclassified",
        )}</div>
        <button type="button" data-remove style="margin-top:6px;font-size:12px;color:#8f2f0a;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;">Remove this city</button>
      `;
      const removeBtn = popupHtml.querySelector<HTMLButtonElement>(
        "[data-remove]",
      );
      removeBtn?.addEventListener("click", () => {
        handlersRef.current.onRemove(p.id);
        marker.closePopup();
      });
      marker.bindPopup(popupHtml);
      existing.set(p.id, marker);
    }

    // Drop markers that disappeared from the prop list.
    for (const [id, marker] of existing) {
      if (!seen.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }
  }, [pins]);

  // Fly to a focused coordinate when the parent updates the prop.
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo([focus.lat, focus.lon], focus.zoom ?? 8, {
      duration: 0.8,
    });
  }, [focus]);

  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-border-warm">
      <div
        ref={containerRef}
        style={{ height: 380, width: "100%", background: "#f7ecd4" }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
