// The block map's geometry: places around the store (or the event place) on a small square, with
// walking rings. Equirectangular at this scale (a couple of kilometers) is accurate to well under a
// dot. Pure, so the map component and the tests share it. Without Qloo coordinates the map falls back
// to distance only: a place's direction is never invented.

/** Walking rings: about 5 and 10 minutes on foot. */
export const WALK_RINGS = [
  { meters: 400, label: "5 min" },
  { meters: 800, label: "10 min" },
] as const;

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;

export interface MapPoint {
  id: string;
  /** SVG units, the center at (size / 2, size / 2), north up. */
  x: number;
  y: number;
  /** Meters from the center. */
  meters: number;
}

/** Meters east and north of the center. */
export function offsetMeters(center: { lat: number; lon: number }, point: { lat: number; lon: number }): { east: number; north: number } {
  return {
    east: (point.lon - center.lon) * M_PER_DEG_LON * Math.cos((center.lat * Math.PI) / 180),
    north: (point.lat - center.lat) * M_PER_DEG_LAT,
  };
}

/**
 * Places with coordinates, projected onto a `size` square whose edge is `radiusM` (plus a margin)
 * from the center. Places beyond the radius are pulled onto its edge, never dropped.
 */
export function projectPlaces(
  center: { lat: number; lon: number },
  radiusM: number,
  places: readonly { id: string; point: { lat: number; lon: number } | null }[],
  size = 320,
  margin = 18,
): MapPoint[] {
  const scale = (size / 2 - margin) / radiusM;
  return places.flatMap((p) => {
    if (!p.point) return [];
    const { east, north } = offsetMeters(center, p.point);
    const meters = Math.hypot(east, north);
    const k = meters > radiusM ? radiusM / meters : 1;
    return [{ id: p.id, x: size / 2 + east * k * scale, y: size / 2 - north * k * scale, meters }];
  });
}

/** A ring's radius in SVG units on the same square. */
export function ringRadius(meters: number, radiusM: number, size = 320, margin = 18): number {
  return (meters / radiusM) * (size / 2 - margin);
}

/** Where a place sits on the distance strip, 0 at the store, `width` at the search radius. */
export function stripX(meters: number, radiusM: number, width: number): number {
  return Math.min(1, Math.max(0, meters / radiusM)) * width;
}

/** The map shows directions only when enough places have coordinates; else the distance strip. */
export function mapMode(places: readonly { point: unknown }[]): "map" | "strip" {
  return places.filter((p) => p.point).length >= 3 ? "map" : "strip";
}
