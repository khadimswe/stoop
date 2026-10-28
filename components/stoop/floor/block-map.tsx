"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { cn } from "cn";

/** OpenFreeMap's positron style: free, keyless; its tiles, glyphs and sprites share one origin (see lib/security/csp.ts). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
/** MapLibre's worker, served from our own origin (copied from the package into public/maplibre). */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const NEXT_DOOR_M = 120;

export interface MapPlace {
  id: string;
  n: number;
  name: string;
  point: { lat: number; lon: number } | null;
  distanceM: number | null;
  /** The plan uses it: a filled pin. */
  used: boolean;
}

type MapLib = typeof import("maplibre-gl");

/** The 1.5 km ring around the center, as a closed line. */
function ring(center: { lat: number; lon: number }, meters: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= 96; k++) {
    const a = (k / 96) * 2 * Math.PI;
    out.push([center.lon + (meters * Math.sin(a)) / (111_320 * Math.cos((center.lat * Math.PI) / 180)), center.lat + (meters * Math.cos(a)) / 110_540]);
  }
  return out;
}

/** Warm grey, quiet: recolors positron's layers and hides its place labels so the pins carry the map. */
function quiet(map: import("maplibre-gl").Map) {
  for (const layer of map.getStyle().layers ?? []) {
    try {
      const id = layer.id;
      if (layer.type === "background") map.setPaintProperty(id, "background-color", "#efeeea");
      else if (layer.type === "fill" && /water/.test(id)) map.setPaintProperty(id, "fill-color", "#cdd5da");
      else if (layer.type === "fill" && /park|wood|grass/.test(id)) map.setPaintProperty(id, "fill-color", "#dfe4d7");
      else if (layer.type === "fill" && /residential|landuse/.test(id)) map.setPaintProperty(id, "fill-color", "#e9e7e2");
      else if (layer.type === "fill" && /building/.test(id)) map.setPaintProperty(id, "fill-color", "#e2e0da");
      if (layer.type === "symbol" && /poi/.test(id)) map.setLayoutProperty(id, "visibility", "none");
      if (layer.type === "symbol" && /highway|road|transportation/.test(id)) {
        map.setLayoutProperty(id, "text-size", 10);
        map.setPaintProperty(id, "text-color", "#6b6b70");
      }
    } catch {
      // A layer without that property: leave it as the style has it.
    }
  }
}

/** The font the style's own labels use, so the pin numbers render with glyphs the tile host serves. */
function styleFont(map: import("maplibre-gl").Map): string[] {
  for (const layer of map.getStyle().layers ?? []) {
    const font = layer.type === "symbol" ? (layer.layout as Record<string, unknown> | undefined)?.["text-font"] : undefined;
    if (Array.isArray(font) && font.every((f) => typeof f === "string")) return font as string[];
  }
  return ["Noto Sans Regular"];
}

/**
 * The block on a real map (MapLibre GL, OpenFreeMap tiles), loaded only when it is on screen: the
 * store (or the event place) as an ink pill with the lime signal, places within about 120 m folded
 * into "+N next door", numbered pins by distance (filled when the plan uses the place), clustered so
 * they never overlap, and the dashed 1.5 km ring. Tapping a pin calls `onPick`. If the map can't
 * load, it says so and the list beside it still works.
 */
export function BlockMap({
  center,
  radiusM,
  places,
  picked,
  onPick,
  interactive = true,
  className,
  label,
}: {
  center: { lat: number; lon: number; label: string };
  radiusM: number;
  places: readonly MapPlace[];
  picked?: string | null;
  onPick?: (id: string) => void;
  interactive?: boolean;
  className?: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const pickRef = useRef(onPick);
  const [state, setState] = useState<"waiting" | "loading" | "ready" | "failed">("waiting");
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  // Load only when the map scrolls near the screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState((s) => (s === "waiting" ? "loading" : s));
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (state !== "loading" || !box.current) return;
    let stopped = false;
    let map: import("maplibre-gl").Map | null = null;
    const near = places.filter((p) => p.distanceM !== null && p.distanceM < NEXT_DOOR_M).length;
    const pinned = places.filter((p) => p.point && (p.distanceM === null || p.distanceM >= NEXT_DOOR_M));
    (async () => {
      let lib: MapLib;
      try {
        lib = await import("maplibre-gl");
      } catch {
        if (!stopped) setState("failed");
        return;
      }
      if (stopped || !box.current) return;
      lib.setWorkerUrl(WORKER_URL);
      map = new lib.Map({
        container: box.current,
        style: STYLE_URL,
        center: [center.lon, center.lat],
        zoom: 13.4,
        attributionControl: { compact: false },
        interactive,
        cooperativeGestures: interactive,
        fadeDuration: 0,
      });
      mapRef.current = map;
      const timeout = window.setTimeout(() => !stopped && map && !map.loaded() && setState((s) => (s === "loading" ? "failed" : s)), 12_000);
      map.on("error", () => {
        if (!stopped && map && !map.isStyleLoaded()) setState("failed");
      });
      map.on("load", () => {
        window.clearTimeout(timeout);
        if (stopped || !map) return;
        quiet(map);
        const font = styleFont(map);
        map.addSource("ring", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring(center, radiusM) } } });
        map.addLayer({ id: "ring", type: "line", source: "ring", paint: { "line-color": "#141416", "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [3, 3] } });
        map.addSource("places", {
          type: "geojson",
          cluster: true,
          clusterRadius: 22,
          clusterMaxZoom: 17,
          data: {
            type: "FeatureCollection",
            features: pinned.map((p) => ({ type: "Feature", properties: { id: p.id, n: String(p.n), used: p.used ? 1 : 0 }, geometry: { type: "Point", coordinates: [p.point!.lon, p.point!.lat] } })),
          },
        });
        map.addLayer({ id: "clusters", type: "circle", source: "places", filter: ["has", "point_count"], paint: { "circle-color": "#ffffff", "circle-radius": 13, "circle-stroke-color": "#141416", "circle-stroke-width": 1.5 } });
        map.addLayer({ id: "cluster-count", type: "symbol", source: "places", filter: ["has", "point_count"], layout: { "text-field": ["concat", ["get", "point_count_abbreviated"], "+"], "text-font": font, "text-size": 10, "text-allow-overlap": true }, paint: { "text-color": "#141416" } });
        map.addLayer({
          id: "pins",
          type: "circle",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": ["case", ["==", ["get", "used"], 1], "#141416", "#ffffff"], "circle-radius": 10, "circle-stroke-color": "#141416", "circle-stroke-width": 1.5 },
        });
        map.addLayer({
          id: "pin-n",
          type: "symbol",
          source: "places",
          filter: ["!", ["has", "point_count"]],
          layout: { "text-field": ["get", "n"], "text-font": font, "text-size": 10, "text-allow-overlap": true },
          paint: { "text-color": ["case", ["==", ["get", "used"], 1], "#ffffff", "#141416"] },
        });
        const store = document.createElement("div");
        store.className = "flex h-[30px] items-center gap-[7px] rounded-[9px] bg-[#141416] pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap text-white shadow-[0_0_0_2.5px_#fff]";
        const sq = document.createElement("i");
        sq.className = "block size-[11px] rounded-[3px] bg-[#c8f03c]";
        store.append(sq, document.createTextNode(center.label));
        if (near > 0) {
          const b = document.createElement("b");
          b.className = "font-medium text-[#c9ccd1]";
          b.textContent = `+${near} next door`;
          store.append(b);
        }
        new lib.Marker({ element: store, anchor: "left", offset: [-14, 0] }).setLngLat([center.lon, center.lat]).addTo(map);
        if (interactive) {
          map.on("click", "pins", (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (typeof id === "string") pickRef.current?.(id);
          });
          map.on("click", "clusters", async (e) => {
            const f = e.features?.[0];
            const src = map?.getSource("places") as import("maplibre-gl").GeoJSONSource | undefined;
            if (!f || !src || !map) return;
            const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
            map.easeTo({ center: (f.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom, duration: reduced ? 0 : 300 });
          });
          for (const layer of ["pins", "clusters"]) {
            map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => map && (map.getCanvas().style.cursor = ""));
          }
        }
        setState("ready");
      });
    })();
    return () => {
      stopped = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once per mount; its data comes from a recorded or finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === "loading"]);

  // Center on a picked place from the list.
  useEffect(() => {
    const map = mapRef.current;
    const p = places.find((x) => x.id === picked);
    if (!map || state !== "ready" || !p?.point) return;
    map.easeTo({ center: [p.point.lon, p.point.lat], duration: reduced ? 0 : 300 });
  }, [picked, places, state, reduced]);

  return (
    <div className={cn("relative overflow-hidden rounded-[20px] bg-[#e9e7e2]", className)}>
      <div ref={box} role="img" aria-label={label} className="h-full w-full" />
      {state !== "ready" && (
        <p className="absolute inset-x-0 bottom-3 text-center text-xs text-fl-dim">{state === "failed" ? "The map didn't load. The list below has every place." : "Loading the map..."}</p>
      )}
    </div>
  );
}
