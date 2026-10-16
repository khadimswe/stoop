// Names and ranks the places in a Qloo heatmap. Qloo returns geohash cells with coordinates, not
// place names, so each cell is labeled with the nearest US metro area (Census CBSA centroid) when it
// lies within that metro's reach. The name is only a label: the receipt is Qloo's cells and lift.
//
// Ranking (Gate 2, docs/data-check.md): a cell's heatmap affinity is a percentile within its own
// response and tracks popularity (correlation 0.955 on fixtures/probe-insights.json heatmap-us).
// Correcting with a fit on popularity (residual lift) left the same few dense metros on top for
// every product (Vallejo, Santa Cruz, San Francisco, Honolulu in the top 5 for 6 of 9), so cities
// are ranked by reference-corrected lift instead:
//   1. Every heatmap is re-ranked on one shared grid: the cells that all reference audiences have.
//      Responses hold different cell sets (6,062 to 11,858 cells), so this makes the percentiles
//      comparable. It is the one place Stoop compares Qloo numbers across calls, and it compares
//      rank positions on the same cells, never raw affinity. Entity and tag scores stay one-call.
//   2. A cell's lift is this audience's percentile minus the mean percentile of the reference
//      audiences (the 9 recorded candidates, frozen in data/geo/reference-heatmap.json). Shared
//      effects such as density cancel. For a candidate inside the reference set the mean leaves it
//      out (leave-one-out), which makes each cell's 9 lifts sum to zero: some separation between
//      candidates is built into the method, so the evidence is what lands where, not the overlap.
//   3. Only cells with real signal for this audience count (MIN_CELL_POPULARITY), a metro needs
//      MIN_CELLS of them, and the ranking shrinks by cell count (SHRINK_CELLS).
import data from "../../data/geo/us-metros.json" with { type: "json" };
import { residualLift } from "../qloo/lift";
import { normalizeName } from "../qloo/match";

export { localityEcho } from "../qloo/types";

export interface Metro {
  geoid: string;
  /** Census name, e.g. "San Francisco-Oakland-Fremont, CA". */
  name: string;
  lat: number;
  lon: number;
  landSqMi: number;
}

export const METROS: readonly Metro[] = data.metros;
export const MIN_CELLS = 3;
export const MIN_CELL_POPULARITY = 0.7;
/**
 * Ranking shrinks a metro's mean lift toward zero by n / (n + SHRINK_CELLS), so a metro that
 * over-indexes across 7 cells outranks a 3-cell blip with a slightly higher mean. Receipts show
 * the unshrunk mean.
 */
export const SHRINK_CELLS = 2;

/**
 * Metros whose first-listed Census city is not a fair label for an ad setting. Kiryas Joel is a
 * village that is home to one religious community; naming a setting after it would read as
 * targeting that community, so the metro is labeled by its next principal city.
 */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  "Kiryas Joel-Poughkeepsie-Newburgh, NY": "Poughkeepsie, NY",
  // Census names, not how people say them.
  "Urban Honolulu, HI": "Honolulu, HI",
};

/** "San Francisco-Oakland-Fremont, CA" -> "San Francisco, CA". The label used in copy and prompts. */
export function shortMetroName(metro: Pick<Metro, "name">): string {
  const override = LABEL_OVERRIDES[metro.name];
  if (override) return override;
  const [cities, states = ""] = metro.name.split(", ");
  // "Louisville/Jefferson County, KY-IN" -> "Louisville, KY"
  const city = cities.split(/-+/)[0].split("/")[0];
  return states ? `${city}, ${states.split("-")[0]}` : city;
}

const RAD = Math.PI / 180;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** How far from its centroid a metro claims cells: its equal-area radius plus 10%, at least 40 km (one geohash-4 cell). */
export function metroReachKm(metro: Metro): number {
  return Math.max(40, Math.sqrt((metro.landSqMi * 2.59) / Math.PI) * 1.1);
}

// Heatmap cells repeat across audiences and runs, so the default lookup is cached per geohash.
const metroByGeohash = new Map<string, Metro | null>();

/** The nearest metro whose reach covers the point, or null for rural cells. Cached per geohash for the default list. */
export function nearestMetro(point: { lat: number; lon: number; geohash?: string }, metros: readonly Metro[] = METROS): Metro | null {
  if (metros === METROS && point.geohash !== undefined) {
    const cached = metroByGeohash.get(point.geohash);
    if (cached !== undefined) return cached;
    const found = scanMetros(point, metros);
    metroByGeohash.set(point.geohash, found);
    return found;
  }
  return scanMetros(point, metros);
}

function scanMetros(point: { lat: number; lon: number }, metros: readonly Metro[]): Metro | null {
  let best: Metro | null = null;
  let bestKm = Infinity;
  for (const metro of metros) {
    // Cheap box check first: one degree of latitude is about 111 km.
    if (Math.abs(metro.lat - point.lat) > 4) continue;
    const km = haversineKm(point, metro);
    if (km < bestKm) {
      bestKm = km;
      best = metro;
    }
  }
  return best && bestKm <= metroReachKm(best) ? best : null;
}

export interface HeatmapPoint {
  geohash: string;
  lat: number;
  lon: number;
  affinity: number;
  popularity: number;
}

export interface MetroLift {
  metro: Metro;
  /** Qloo cells inside the metro's reach with real signal for this audience. */
  cells: number;
  /** Mean lift of those cells. Positive means this audience ranks the place higher than the reference audiences do. */
  lift: number;
  /** The ranking score: lift shrunk by cell count (see SHRINK_CELLS). */
  score: number;
  /** Mean cell popularity (signal density) for this audience. */
  popularity: number;
  /** The metro's strongest cell, for the receipt. */
  topCell: { geohash: string; lift: number };
}

/** Per-cell percentile totals across the reference audiences, on the shared grid, so a mean (or a leave-one-out mean) is one division. */
export type ReferenceHeatmap = ReadonlyMap<string, { sum: number; n: number }>;

/**
 * Re-ranks a heatmap's affinity as percentiles (0 to 1) on the whole `grid`. Cells outside the grid
 * are dropped. Grid cells this heatmap lacks count as tied at the bottom, so a sparser (live)
 * heatmap stays on the reference's scale: its cells keep the rank they would have had.
 * Ties keep Qloo's order.
 */
export function gridPercentiles(cells: readonly HeatmapPoint[], grid: ReadonlySet<string> | ReadonlyMap<string, unknown>): HeatmapPoint[] {
  const shared = cells.filter((cell) => grid.has(cell.geohash));
  const missing = Math.max(grid.size - shared.length, 0);
  const order = shared.map((cell, index) => ({ cell, index })).sort((a, b) => a.cell.affinity - b.cell.affinity || a.index - b.index);
  const last = Math.max(grid.size - 1, 1);
  const percentile = new Map(order.map(({ cell }, rank) => [cell.geohash, (missing + rank) / last]));
  return shared.map((cell) => ({ ...cell, affinity: percentile.get(cell.geohash) as number }));
}

/** Share of the grid a heatmap covers. A live run below COVERAGE_FLOOR gets a "thin heatmap" flag. */
export const COVERAGE_FLOOR = 0.95;
export function gridCoverage(cells: readonly HeatmapPoint[], grid: ReadonlySet<string> | ReadonlyMap<string, unknown>): number {
  const present = new Set(cells.filter((c) => grid.has(c.geohash)).map((c) => c.geohash));
  return grid.size === 0 ? 0 : present.size / grid.size;
}

/** The reference: the cells every audience has, with each audience's percentile on that grid summed per cell. */
export function buildReferenceHeatmap(audiences: readonly (readonly HeatmapPoint[])[]): Map<string, { sum: number; n: number }> {
  const counts = new Map<string, number>();
  for (const cells of audiences) for (const cell of new Set(cells.map((c) => c.geohash))) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  const grid = new Set([...counts].filter(([, n]) => n === audiences.length).map(([geohash]) => geohash));
  const reference = new Map<string, { sum: number; n: number }>();
  for (const cells of audiences) {
    for (const cell of gridPercentiles(cells, grid)) {
      const entry = reference.get(cell.geohash) ?? { sum: 0, n: 0 };
      entry.sum += cell.affinity;
      entry.n += 1;
      reference.set(cell.geohash, entry);
    }
  }
  return reference;
}

function rankMetros(
  cells: readonly HeatmapPoint[],
  lifts: readonly (number | null)[],
  keepCell: (cell: HeatmapPoint) => boolean,
  options: { minCells?: number; metros?: readonly Metro[] },
): MetroLift[] {
  const minCells = options.minCells ?? MIN_CELLS;
  const byMetro = new Map<string, { metro: Metro; lifts: number[]; popularity: number; top: { geohash: string; lift: number } }>();
  cells.forEach((cell, index) => {
    const lift = lifts[index];
    if (lift === null || !keepCell(cell)) return;
    const metro = nearestMetro(cell, options.metros);
    if (!metro) return;
    const entry = byMetro.get(metro.geoid) ?? { metro, lifts: [], popularity: 0, top: { geohash: cell.geohash, lift } };
    entry.lifts.push(lift);
    entry.popularity += cell.popularity;
    if (lift > entry.top.lift) entry.top = { geohash: cell.geohash, lift };
    byMetro.set(metro.geoid, entry);
  });
  return [...byMetro.values()]
    .map((e) => {
      const lift = e.lifts.reduce((a, b) => a + b, 0) / e.lifts.length;
      return {
        metro: e.metro,
        cells: e.lifts.length,
        lift,
        score: (lift * e.lifts.length) / (e.lifts.length + SHRINK_CELLS),
        popularity: e.popularity / e.lifts.length,
        topCell: e.top,
      };
    })
    .filter((m) => m.cells >= minCells)
    .sort((a, b) => b.score - a.score || a.metro.name.localeCompare(b.metro.name));
}

/**
 * Metros ranked by reference-corrected lift. When this audience is itself one of the reference
 * audiences, pass `own: true` so it is left out of the reference mean (leave-one-out).
 */
export function liftByMetro(
  cells: readonly HeatmapPoint[],
  reference: ReferenceHeatmap,
  options: { own?: boolean; minCells?: number; minCellPopularity?: number; metros?: readonly Metro[] } = {},
): MetroLift[] {
  const minPopularity = options.minCellPopularity ?? MIN_CELL_POPULARITY;
  const ranked = gridPercentiles(cells, reference);
  const lifts = ranked.map((cell) => {
    const ref = reference.get(cell.geohash) as { sum: number; n: number };
    const n = options.own ? ref.n - 1 : ref.n;
    if (n < 1) return null;
    return cell.affinity - (options.own ? ref.sum - cell.affinity : ref.sum) / n;
  });
  return rankMetros(ranked, lifts, (cell) => cell.popularity >= minPopularity, options);
}

/**
 * The method Gate 2 compared and rejected: residual lift on popularity within one response, among
 * dense metros. Kept for the data check and its tests.
 */
export function residualLiftByMetro(
  cells: readonly HeatmapPoint[],
  options: { minCells?: number; minMeanPopularity?: number; metros?: readonly Metro[] } = {},
): MetroLift[] {
  const minMean = options.minMeanPopularity ?? 0.9;
  return rankMetros(cells, residualLift(cells), () => true, options).filter((m) => m.popularity >= minMean);
}

const STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export type LocalityMatch = "exact" | "partial" | "mismatch";

/**
 * How well the locality Qloo matched fits the one asked for. "exact": the echoed name is the city,
 * in the right state. "partial": the city's name appears in a different unit of the right state
 * ("Baton Rouge, LA" matched "East Baton Rouge Parish", "Flint, MI" matched "Flint Charter
 * Township", "Jackson, MS" would match "Jackson County"). "mismatch": anything else.
 */
export function localityMatch(echo: { name: string; disambiguation: string }, label: string): LocalityMatch {
  const [city, abbr = ""] = label.split(", ");
  const state = STATES[abbr];
  const text = ` ${normalizeName(`${echo.name} ${echo.disambiguation}`)} `;
  if (state && !text.includes(` ${normalizeName(state)} `)) return "mismatch";
  if (normalizeName(echo.name) === normalizeName(city)) return "exact";
  return text.includes(` ${normalizeName(city)} `) ? "partial" : "mismatch";
}

/** True for an exact or partial match. */
export function localityMatchesMetro(echo: { name: string; disambiguation: string }, label: string): boolean {
  return localityMatch(echo, label) !== "mismatch";
}
