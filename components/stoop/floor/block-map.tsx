"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { boundsOf, labelSides, PIN_PICKED_PX, PIN_PX, spreadPins } from "@/lib/plan/view/map-layout";
import { cn } from "cn";

/** OpenFreeMap's positron style: free, keyless; its tiles, glyphs and sprites share one origin (see lib/security/csp.ts). */
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
/** MapLibre's worker, served from our own origin (copied from the package into public/maplibre). */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const INK = "#111113";
const SIGNAL = "#c8f03c";
/** MapLibre sets its own font on the map; pins, labels and the callout use the floor's UI font, upright. */
const UI_FONT = "[font-family:var(--font-ui)] not-italic";

export interface MapPlace {
  id: string;
  /** The pin number: the same number the list shows (places by distance from the store). */
  n: number;
  name: string;
  point: { lat: number; lon: number } | null;
  distanceM: number | null;
  /** The plan uses it: a filled ink pin. */
  used: boolean;
  /** For the picked place's callout: "Food spot", "440 m", and Qloo's own description. */
  kindLabel?: string;
  distanceText?: string | null;
  why?: string | null;
}

type GLMap = import("maplibre-gl").Map;
type GLMarker = import("maplibre-gl").Marker;
type GLPopup = import("maplibre-gl").Popup;
type Pin = { marker: GLMarker; el: HTMLDivElement; place: MapPlace; offset: [number, number] };

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
function quiet(map: GLMap) {
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

/** A pin: a numbered disc (ink when the plan uses the place), with its name beside it when labeled. */
function pinElement(p: MapPlace, interactive: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.pin = String(p.n);
  el.dataset.used = p.used ? "true" : "false";
  el.className = cn("flex items-center justify-center", interactive && "cursor-pointer");
  el.style.width = `${PIN_PX}px`;
  el.style.height = `${PIN_PX}px`;
  const disc = document.createElement("span");
  disc.className = cn(
    "fl-pin flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-fl-ink text-[11px] leading-none font-semibold tabular-nums transition-[width,height,box-shadow] motion-reduce:transition-none",
    UI_FONT,
    p.used ? "bg-fl-ink text-white" : "bg-white text-fl-ink",
  );
  disc.textContent = String(p.n);
  el.append(disc);
  const name = document.createElement("span");
  name.className = cn("fl-pin-name pointer-events-none absolute top-1/2 hidden -translate-y-1/2 rounded-[4px] bg-white/95 px-1 py-px text-[11px] leading-4 font-semibold whitespace-nowrap text-fl-ink", UI_FONT);
  name.textContent = p.name;
  el.append(name);
  return el;
}

/** The picked place's callout: its number and name, kind and distance, and Qloo's own description. */
function calloutElement(p: MapPlace): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cn("flex max-w-[240px] flex-col gap-0.5 text-fl-ink", UI_FONT);
  el.dataset.callout = String(p.n);
  const title = document.createElement("p");
  title.className = "text-[13px] leading-[18px] font-semibold";
  title.textContent = `${p.n} · ${p.name}`;
  el.append(title);
  const meta = [p.kindLabel, p.distanceText].filter(Boolean).join(" · ");
  if (meta) {
    const m = document.createElement("p");
    m.className = "text-xs leading-4 text-fl-dim";
    m.textContent = meta;
    el.append(m);
  }
  if (p.why) {
    const why = document.createElement("p");
    why.className = "mt-1 text-xs leading-4 text-fl-muted";
    why.textContent = p.why;
    el.append(why);
    const from = document.createElement("p");
    from.className = "mt-1 flex items-center gap-1.5 text-[11px] leading-4 font-medium text-fl-dim";
    const mark = document.createElement("i");
    mark.setAttribute("aria-hidden", "true");
    mark.className = "block size-2 rounded-[2px] bg-fl-ink";
    from.append(mark, document.createTextNode("Qloo's description"));
    el.append(from);
  }
  return el;
}

/** The callout sits clear of the picked pin, wherever the pin was nudged to. */
function popupOffset([dx, dy]: [number, number]) {
  const r = PIN_PICKED_PX / 2 + 4;
  const d = r * 0.7;
  return {
    center: [dx, dy] as [number, number],
    top: [dx, dy + r] as [number, number],
    bottom: [dx, dy - r] as [number, number],
    left: [dx + r, dy] as [number, number],
    right: [dx - r, dy] as [number, number],
    "top-left": [dx + d, dy + d] as [number, number],
    "top-right": [dx - d, dy + d] as [number, number],
    "bottom-left": [dx + d, dy - d] as [number, number],
    "bottom-right": [dx - d, dy - d] as [number, number],
  };
}

/**
 * The community on a real map (MapLibre GL, OpenFreeMap tiles), loaded only when it is on screen. It
 * fits the store and every place shown, with the same numbers the list uses (by distance): no place is
 * folded away or clustered, and pins that would land on each other are nudged apart. The store (or
 * the event's place) is an ink pill with the lime signal, always on top; when it is the event's place,
 * the store gets its own quieter white pill (`store`), set away from the event's. With no places, the
 * map shows the ring around the store. `insetTop` keeps pins below a badge laid over the map's top.
 * Pins the plan uses are ink
 * and carry their names. The picked place grows with a lime ring and a callout (its kind, distance
 * and Qloo's description); tapping a pin calls `onPick`. If the map can't load, it says so and the
 * list beside it still works.
 */
export function BlockMap({
  center,
  store = null,
  radiusM,
  places,
  picked,
  onPick,
  interactive = true,
  labels = "used",
  controls = false,
  insetTop = 0,
  className,
  label,
}: {
  center: { lat: number; lon: number; label: string };
  /** The store's own spot, when the map is centered on the event's place. */
  store?: { lat: number; lon: number; label: string } | null;
  radiusM: number;
  /** The places to pin; the map fits them and the store. */
  places: readonly MapPlace[];
  picked?: string | null;
  onPick?: (id: string) => void;
  interactive?: boolean;
  /** Names beside pins: the places the plan uses (default), every pin, or none. */
  labels?: "used" | "all" | "none";
  /** Zoom buttons and room at the bottom for the page's buttons (the desktop community map). */
  controls?: boolean;
  /** Where a badge laid over the map's top ends, in pixels: pins and names stay below it. */
  insetTop?: number;
  className?: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GLMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const storeRef = useRef<HTMLElement | null>(null);
  const pinsRef = useRef<Map<string, Pin>>(new Map());
  const popupRef = useRef<GLPopup | null>(null);
  const pickRef = useRef(onPick);
  const pickedRef = useRef<string | null>(picked ?? null);
  const layoutRef = useRef<() => void>(() => {});
  // Two states: whether the map has scrolled near the screen (it builds once, then) and how its load went.
  // One state for both would rebuild, and so remove, the map the moment it reports ready.
  const [near, setNear] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const reduced = usePrefersReducedMotion();
  const placesKey = places.map((p) => `${p.id}:${p.used ? 1 : 0}`).join(",");
  const shop = store;

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
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Build the map once: the quiet style, the ring and the store's pill.
  useEffect(() => {
    if (!near || !box.current) return;
    let stopped = false;
    let map: GLMap | null = null;
    const pins = pinsRef.current;
    (async () => {
      let lib: typeof import("maplibre-gl");
      try {
        lib = await import("maplibre-gl");
      } catch {
        if (!stopped) setState("failed");
        return;
      }
      if (stopped || !box.current) return;
      libRef.current = lib;
      lib.setWorkerUrl(WORKER_URL);
      // A phone page scrolls past the map with one finger; a desktop map pane does not need that guard.
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      map = new lib.Map({
        container: box.current,
        style: STYLE_URL,
        center: [center.lon, center.lat],
        zoom: 13.4,
        maxZoom: 18,
        attributionControl: false,
        interactive,
        cooperativeGestures: interactive && !wide,
        fadeDuration: 0,
      });
      mapRef.current = map;
      // The attribution stays, folded behind its info button so it never covers a pin (bottom left on
      // the desktop map, where the page's buttons take the bottom right).
      map.addControl(new lib.AttributionControl({ compact: true }), controls ? "bottom-left" : "bottom-right");
      if (interactive && controls) map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      const timeout = window.setTimeout(() => !stopped && map && !map.loaded() && setState((s) => (s === "loading" ? "failed" : s)), 12_000);
      map.on("error", () => {
        if (!stopped && map && !map.isStyleLoaded()) setState("failed");
      });
      map.on("load", () => {
        window.clearTimeout(timeout);
        if (stopped || !map) return;
        quiet(map);
        const attrib = box.current?.querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        attrib?.removeAttribute("open");
        map.addSource("ring", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring(center, radiusM) } } });
        map.addLayer({ id: "ring", type: "line", source: "ring", paint: { "line-color": INK, "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [3, 3] } });
        const store = document.createElement("div");
        store.className = cn("flex h-[30px] items-center gap-[7px] rounded-[9px] bg-fl-ink pr-2.5 pl-2 text-xs font-semibold whitespace-nowrap text-white shadow-[0_0_0_2.5px_#fff]", UI_FONT);
        store.dataset.store = center.label;
        const sq = document.createElement("i");
        sq.className = "block size-[11px] rounded-[3px] bg-fl-signal";
        store.append(sq, document.createTextNode(center.label));
        new lib.Marker({ element: store, anchor: "left", offset: [-14, 0] }).setLngLat([center.lon, center.lat]).addTo(map);
        store.style.zIndex = "5";
        storeRef.current = store;
        if (shop) {
          // The store, when the map is the event's: an ink square on the store's own spot, its name in a
          // quieter white tag hanging off the side away from the event's pill (below left when the store
          // is to the south west), so the two never sit on each other.
          const west = shop.lon <= center.lon;
          const south = shop.lat <= center.lat;
          const el = document.createElement("div");
          el.className = "relative size-3";
          el.dataset.storePin = shop.label;
          const mark = document.createElement("i");
          mark.className = "block size-3 rounded-[3px] bg-fl-ink shadow-[0_0_0_2px_#fff]";
          const tag = document.createElement("span");
          tag.className = cn(
            "pointer-events-none absolute rounded-[5px] border-[1.5px] border-fl-ink bg-white px-1.5 py-px text-[11px] leading-4 font-semibold whitespace-nowrap text-fl-ink",
            west ? "right-[calc(100%-2px)]" : "left-[calc(100%-2px)]",
            south ? "top-[calc(100%+2px)]" : "bottom-[calc(100%+2px)]",
            UI_FONT,
          );
          tag.textContent = shop.label;
          el.append(mark, tag);
          el.style.zIndex = "3";
          new lib.Marker({ element: el, anchor: "center" }).setLngLat([shop.lon, shop.lat]).addTo(map);
        }
        setState("ready");
      });
    })();
    return () => {
      stopped = true;
      popupRef.current?.remove();
      popupRef.current = null;
      for (const m of pins.values()) m.marker.remove();
      pins.clear();
      map?.remove();
      mapRef.current = null;
      storeRef.current = null;
    };
    // The map is built once per mount; the places below follow the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  // The pins: one per place shown, fitted with the store, nudged apart where they would overlap.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || state !== "ready") return;
    const pins = pinsRef.current;
    for (const m of pins.values()) m.marker.remove();
    pins.clear();
    const pinned = places.filter((p) => p.point);
    for (const p of pinned) {
      const el = pinElement(p, interactive);
      if (interactive)
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          pickRef.current?.(p.id);
        });
      const marker = new lib.Marker({ element: el, anchor: "center" }).setLngLat([p.point!.lon, p.point!.lat]).addTo(map);
      pins.set(p.id, { marker, el, place: p, offset: [0, 0] });
    }

    const labeled = (m: Pin) => m.place.id !== pickedRef.current && (labels === "all" || (labels === "used" && m.place.used));
    const layout = () => {
      const sp = map.project([center.lon, center.lat]);
      const w = storeRef.current?.offsetWidth ?? 90;
      const avoid = { x0: sp.x - 16, y0: sp.y - 17, x1: sp.x - 12 + w, y1: sp.y + 17 };
      const list = [...pins.values()];
      const points = list.map((m) => map.project([m.place.point!.lon, m.place.point!.lat]));
      const nudges = spreadPins(points, { avoid });
      const at = points.map((p, i) => ({ x: p.x + nudges[i]![0], y: p.y + nudges[i]![1] }));
      const sides = labelSides(
        at.map((p, i) => {
          const name = list[i]!.el.querySelector<HTMLElement>(".fl-pin-name");
          const show = labeled(list[i]!);
          name?.classList.toggle("hidden", !show);
          return { ...p, width: show && name ? name.offsetWidth : 0 };
        }),
        { avoid, frame: { x0: 4, y0: Math.max(4, insetTop + 2), x1: (box.current?.clientWidth ?? 400) - 4, y1: (box.current?.clientHeight ?? 340) - 4 } },
      );
      list.forEach((m, i) => {
        m.offset = nudges[i]!;
        m.marker.setOffset(m.offset);
        const name = m.el.querySelector<HTMLElement>(".fl-pin-name");
        if (name) {
          name.style.left = sides[i] === "right" ? "calc(100% + 4px)" : "";
          name.style.right = sides[i] === "left" ? "calc(100% + 4px)" : "";
          if (sides[i] === "hidden") name.classList.add("hidden");
        }
      });
      const open = pickedRef.current ? pins.get(pickedRef.current) : undefined;
      if (open && popupRef.current) popupRef.current.setOffset(popupOffset(open.offset));
    };
    layoutRef.current = layout;
    // No places yet (a new store with live maps off): show the ring Stoop maps around it.
    const fitTo = pinned.length ? [{ lat: center.lat, lon: center.lon }, ...(shop ? [shop] : []), ...pinned.map((p) => p.point!)] : ring(center, radiusM).map(([lon, lat]) => ({ lat, lon }));
    const bounds = boundsOf(fitTo);
    if (bounds) {
      const width = box.current?.clientWidth ?? 400;
      const base = controls ? { top: 64, right: 72, bottom: 104, left: 56 } : width < 480 ? { top: 44, right: 40, bottom: 32, left: 28 } : { top: 44, right: 56, bottom: 40, left: 40 };
      // A pin's top edge stays 8 px under a badge laid over the map.
      const pad = { ...base, top: Math.max(base.top, insetTop ? insetTop + PIN_PX / 2 + 8 : 0) };
      const fit = (more = 0) => map.fitBounds(bounds, { padding: { ...pad, right: pad.right + more }, maxZoom: 16, duration: 0 });
      fit();
      // The store's pill reads to the right of its point: when it would run off the map, fit again with room for it.
      const sp = map.project([center.lon, center.lat]);
      const over = sp.x - 14 + (storeRef.current?.offsetWidth ?? 90) + 12 - width;
      if (over > 0) fit(over + 12);
    }
    layout();
    map.on("zoomend", layout);
    map.on("resize", layout);
    applyPicked();
    return () => {
      map.off("zoomend", layout);
      map.off("resize", layout);
    };
    // placesKey stands for `places`; a new array with the same places keeps the pins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, placesKey, labels, interactive, center.lat, center.lon, insetTop]);

  /** Marks the picked pin (bigger, a lime ring) and opens its callout; brings it into view if it is off screen. */
  function applyPicked() {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    const id = pickedRef.current;
    for (const [key, m] of pinsRef.current) {
      const on = key === id;
      const disc = m.el.querySelector<HTMLElement>(".fl-pin");
      if (disc) {
        disc.style.width = on ? `${PIN_PICKED_PX}px` : "";
        disc.style.height = on ? `${PIN_PICKED_PX}px` : "";
        disc.style.fontSize = on ? "13px" : "";
        disc.style.boxShadow = on ? `0 0 0 2px #fff, 0 0 0 5px ${SIGNAL}` : "";
      }
      m.el.style.zIndex = on ? "4" : m.place.used ? "2" : "1";
      m.el.dataset.picked = on ? "true" : "false";
    }
    // The callout names the picked place, so its label steps aside; the others find their sides again.
    layoutRef.current();
    popupRef.current?.remove();
    popupRef.current = null;
    const m = id ? pinsRef.current.get(id) : undefined;
    if (!m || !m.place.point) return;
    // The callout opens away from the nearer edges: below a pin in the top half, to the right of a pin
    // on the left, so it stays on the map.
    const at = map.project([m.place.point.lon, m.place.point.lat]);
    const w = box.current?.clientWidth ?? 400;
    const h = box.current?.clientHeight ?? 340;
    const anchor = `${at.y + m.offset[1] < h * 0.55 ? "top" : "bottom"}-${at.x + m.offset[0] < w * 0.55 ? "left" : "right"}` as const;
    popupRef.current = new lib.Popup({
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      maxWidth: "260px",
      anchor: w < 480 ? undefined : anchor,
      offset: popupOffset(m.offset),
      className:
        "fl-callout z-[6] [&_.maplibregl-popup-content]:rounded-[12px] [&_.maplibregl-popup-content]:border [&_.maplibregl-popup-content]:border-fl-rule [&_.maplibregl-popup-content]:px-3 [&_.maplibregl-popup-content]:py-2.5 [&_.maplibregl-popup-content]:shadow-none [&_.maplibregl-popup-tip]:hidden",
    })
      .setLngLat([m.place.point.lon, m.place.point.lat])
      .setDOMContent(calloutElement(m.place))
      .addTo(map);
    const ll = new lib.LngLat(m.place.point.lon, m.place.point.lat);
    if (!map.getBounds().contains(ll)) map.easeTo({ center: ll, duration: reduced ? 0 : 300 });
  }

  // Follow the picked place from the list or a pin tap.
  useEffect(() => {
    pickedRef.current = picked ?? null;
    if (state === "ready") applyPicked();
    // applyPicked reads refs; it runs again whenever the pick or the map changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, state]);

  return (
    <div className={cn("relative overflow-hidden rounded-[20px] bg-[#e9e7e2]", className)}>
      {/* A labeled group, not an image: the map's own controls (zoom, attribution links) live inside it.
          Pins are for pointers; the list beside the map names and selects every place. */}
      <div ref={box} role="group" aria-roledescription="map" aria-label={label} className="h-full w-full" />
      {state !== "ready" && (
        <p className="absolute inset-x-0 bottom-3 text-center text-xs text-fl-dim">{state === "failed" ? "The map didn't load. The list below has every place." : "Loading the map..."}</p>
      )}
    </div>
  );
}
