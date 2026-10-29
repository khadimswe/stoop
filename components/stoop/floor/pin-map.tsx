"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/**
 * "Drop a pin": the store's point on a real map. Drag the pin, or tap the map, to put it on the
 * store's door; `onChange` gets the new point. If the map can't load, the address alone still works.
 */
export function PinMap({ point, onChange, className }: { point: { lat: number; lon: number }; onChange: (p: { lat: number; lon: number }) => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  const marker = useRef<import("maplibre-gl").Marker | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let stopped = false;
    let map: import("maplibre-gl").Map | null = null;
    (async () => {
      try {
        const lib = await import("maplibre-gl");
        if (stopped || !box.current) return;
        lib.setWorkerUrl(WORKER_URL);
        map = new lib.Map({ container: box.current, style: STYLE_URL, center: [point.lon, point.lat], zoom: 16, attributionControl: { compact: true }, cooperativeGestures: true });
        map.on("error", () => !stopped && map && !map.isStyleLoaded() && setFailed(true));
        const el = document.createElement("div");
        el.className = "size-5 rounded-[5px] border-[2.5px] border-white bg-[#111113] shadow-[0_0_0_2px_#111113]";
        const m = new lib.Marker({ element: el, draggable: true }).setLngLat([point.lon, point.lat]).addTo(map);
        marker.current = m;
        m.on("dragend", () => {
          const ll = m.getLngLat();
          change.current({ lat: ll.lat, lon: ll.lng });
        });
        map.on("click", (e) => {
          m.setLngLat(e.lngLat);
          change.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        });
      } catch {
        if (!stopped) setFailed(true);
      }
    })();
    return () => {
      stopped = true;
      map?.remove();
      marker.current = null;
    };
    // Built once; later points move the pin (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([point.lon, point.lat]);
  }, [point.lat, point.lon]);

  return (
    <div className={cn("relative overflow-hidden rounded-[20px] bg-[#e9e7e2]", className)}>
      <div ref={box} role="application" aria-label="Map: drag the pin onto the store's door" className="h-full w-full" />
      {failed && <p className="absolute inset-x-0 bottom-3 text-center text-xs text-fl-dim">The map didn&apos;t load. The address is enough.</p>}
    </div>
  );
}
