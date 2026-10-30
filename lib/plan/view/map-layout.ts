// The community map's layout, in plain numbers so it can be tested: the bounds that fit the store and
// the places shown, and how far to nudge pins that would land on each other (or under the store's
// pill) so every listed place keeps its own numbered pin. Nothing is folded away or clustered.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A screen rectangle pins stay out of (the store's pill). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A pin's diameter on the map, in CSS pixels, and the picked pin's. */
export const PIN_PX = 24;
export const PIN_PICKED_PX = 32;

/** [[west, south], [east, north]] around every point; a lone point gets a small box (about 250 m). */
export function boundsOf(points: readonly LatLon[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const pad = 0.00225;
  if (e - w < pad && n - s < pad) {
    const lat = (n + s) / 2;
    const lon = (e + w) / 2;
    return [
      [lon - pad, lat - pad],
      [lon + pad, lat + pad],
    ];
  }
  return [
    [w, s],
    [e, n],
  ];
}

const overlap = (a: ScreenRect, b: ScreenRect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** A label may touch this much (square pixels) of something else and still show. */
const LABEL_SLACK = 24;

/**
 * Which side of its pin each name label goes on: the right if it is clear of the store's pill, the
 * other pins, the labels already placed and the map's edge, else the left, else neither ("hidden": the
 * pin keeps its number and the list names it). `width` 0 means the pin has no label.
 */
export function labelSides(pins: readonly (ScreenPoint & { width: number })[], options: { avoid?: ScreenRect | null; pin?: number; frame?: ScreenRect } = {}): ("right" | "left" | "hidden")[] {
  const r = (options.pin ?? PIN_PX) / 2;
  const discs: ScreenRect[] = pins.map((p) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r }));
  const placed: ScreenRect[] = options.avoid ? [options.avoid] : [];
  const frame = options.frame;
  return pins.map((p, i) => {
    if (p.width <= 0) return "right";
    const right = { x0: p.x + r + 4, y0: p.y - 9, x1: p.x + r + 4 + p.width, y1: p.y + 9 };
    const left = { x0: p.x - r - 4 - p.width, y0: p.y - 9, x1: p.x - r - 4, y1: p.y + 9 };
    // A label cut off by the map's edge costs the most.
    const outside = (rect: ScreenRect) => (frame ? ((rect.x1 - rect.x0) * (rect.y1 - rect.y0) - overlap(rect, frame)) * 4 : 0);
    const cost = (rect: ScreenRect) => outside(rect) + [...placed, ...discs.filter((_, j) => j !== i)].reduce((sum, o) => sum + overlap(rect, o), 0);
    const side = cost(right) <= LABEL_SLACK ? "right" : cost(left) <= LABEL_SLACK ? "left" : "hidden";
    if (side !== "hidden") placed.push(side === "left" ? left : right);
    return side;
  });
}

/** The golden angle: points that sit exactly on top of each other fan out in different directions. */
const GOLDEN = 2.399963229728653;

/**
 * Nudges for pins that would overlap on screen: each pair closer than `min` pixels is pushed apart
 * along the line between them (points on the same spot fan out by the golden angle), and any pin over
 * `avoid` is pushed above or below it. Returns one [dx, dy] per point, in pixels. Deterministic: the
 * same screen positions always give the same nudges.
 */
export function spreadPins(points: readonly ScreenPoint[], options: { min?: number; avoid?: ScreenRect | null; iterations?: number } = {}): [number, number][] {
  const min = options.min ?? PIN_PX + 3;
  const avoid = options.avoid ?? null;
  const iterations = options.iterations ?? 80;
  const pos = points.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min - 0.01) continue;
        if (d < 0.01) {
          const angle = (j + i * 0.5) * GOLDEN;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = (min - Math.hypot(b.x - a.x, b.y - a.y)) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (avoid) {
      const r = min / 2;
      for (const p of pos) {
        if (p.x > avoid.x0 - r && p.x < avoid.x1 + r && p.y > avoid.y0 - r && p.y < avoid.y1 + r) {
          const mid = (avoid.y0 + avoid.y1) / 2;
          p.y = p.y <= mid ? avoid.y0 - r : avoid.y1 + r;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pos.map((p, i) => [Math.round((p.x - points[i]!.x) * 10) / 10, Math.round((p.y - points[i]!.y) * 10) / 10]);
}
