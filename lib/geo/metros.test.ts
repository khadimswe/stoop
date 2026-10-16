import { describe, expect, it } from "vitest";
import { findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { CANDIDATES } from "../demo/candidates";
import { heatmapResponse } from "../qloo/types";
import { readFileSync } from "node:fs";
import {
  buildReferenceHeatmap,
  gridCoverage,
  gridPercentiles,
  liftByMetro,
  localityMatch,
  localityMatchesMetro,
  METROS,
  MIN_CELL_POPULARITY,
  nearestMetro,
  residualLiftByMetro,
  shortMetroName,
} from "./metros";

const byName = (name: string) => {
  const metro = METROS.find((m) => m.name === name);
  if (!metro) throw new Error(`no metro ${name}`);
  return metro;
};

describe("metro list", () => {
  it("holds the 393 Census metropolitan areas, with no em dashes in names", () => {
    expect(METROS).toHaveLength(393);
    for (const metro of METROS) expect(metro.name).not.toContain(String.fromCharCode(0x2014));
  });

  it("shortens names to the first city and state", () => {
    expect(shortMetroName(byName("San Francisco-Oakland-Fremont, CA"))).toBe("San Francisco, CA");
    expect(shortMetroName(byName("Scranton--Wilkes-Barre, PA"))).toBe("Scranton, PA");
    expect(shortMetroName(byName("Boulder, CO"))).toBe("Boulder, CO");
    expect(shortMetroName({ name: "New York-Newark-Jersey City, NY-NJ" })).toBe("New York, NY");
  });

  it("never labels a setting with a village that is home to one religious community", () => {
    expect(shortMetroName(byName("Kiryas Joel-Poughkeepsie-Newburgh, NY"))).toBe("Poughkeepsie, NY");
  });

  it("uses everyday names where Census names differ", () => {
    expect(shortMetroName(byName("Urban Honolulu, HI"))).toBe("Honolulu, HI");
    expect(shortMetroName(byName("Louisville/Jefferson County, KY-IN"))).toBe("Louisville, KY");
  });
});

describe("nearestMetro", () => {
  it("names a point inside a metro", () => {
    expect(nearestMetro({ lat: 40.015, lon: -105.27 })?.name).toBe("Boulder, CO");
    expect(nearestMetro({ lat: 33.749, lon: -84.388 })?.name).toBe("Atlanta-Sandy Springs-Roswell, GA");
  });

  it("leaves rural points unnamed", () => {
    // Central Nevada, far from any metro.
    expect(nearestMetro({ lat: 39.0, lon: -117.0 })).toBeNull();
  });
});

describe("city ranking on the recorded candidate heatmaps", () => {
  const pool = readFixtureFile(findFixture("pool-audience") as string);
  const heatmaps = Object.fromEntries(CANDIDATES.map((c) => [c.slug, heatmapResponse.parse(recorded(pool, `${c.slug}--heatmap`).body)]));
  const reference = buildReferenceHeatmap(Object.values(heatmaps));
  const rankings = new Map(CANDIDATES.map((c) => [c.slug, liftByMetro(heatmaps[c.slug], reference, { own: true })]));
  const ranked = (slug: string) => rankings.get(slug) ?? [];
  const top5 = (list: { metro: { name: string } }[]) => list.slice(0, 5).map((m) => shortMetroName(m.metro));
  const meanOverlap = (lists: string[][]) => {
    let total = 0;
    let pairs = 0;
    for (let a = 0; a < lists.length; a++) {
      for (let b = a + 1; b < lists.length; b++) {
        const shared = lists[a].filter((x) => lists[b].includes(x)).length;
        total += shared / (new Set([...lists[a], ...lists[b]]).size || 1);
        pairs++;
      }
    }
    return total / pairs;
  };

  it("counts only cells with real signal, ranked by lift, each pointing at a real Qloo cell", () => {
    const list = ranked("food-hot-sauce");
    const hashes = new Set(heatmaps["food-hot-sauce"].map((c) => c.geohash));
    expect(list.length).toBeGreaterThan(20);
    for (const m of list) {
      expect(m.cells).toBeGreaterThanOrEqual(3);
      expect(m.popularity).toBeGreaterThanOrEqual(MIN_CELL_POPULARITY);
      expect(hashes.has(m.topCell.geohash)).toBe(true);
    }
    for (let i = 1; i < list.length; i++) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score);
  });

  it("is specific to the product: small-batch hot sauce lands in Louisiana", () => {
    expect(top5(ranked("food-hot-sauce")).filter((name) => name.endsWith(", LA")).length).toBeGreaterThanOrEqual(2);
  });

  it("ranks a consistent metro above a 3-cell blip with a higher mean", () => {
    const [first] = ranked("food-hot-sauce");
    expect(first.cells).toBeGreaterThan(3);
  });

  it("gives different products different cities, unlike residual lift", () => {
    const reference5 = CANDIDATES.map((c) => top5(ranked(c.slug)));
    const residual5 = CANDIDATES.map((c) => top5(residualLiftByMetro(heatmaps[c.slug])));
    expect(meanOverlap(reference5)).toBeLessThan(0.05);
    expect(meanOverlap(residual5)).toBeGreaterThan(meanOverlap(reference5));
  });

  it("ranks every heatmap on one shared grid of cells", () => {
    const grid = [...reference.keys()];
    for (const cells of Object.values(heatmaps)) {
      const ranked = gridPercentiles(cells, reference);
      expect(ranked).toHaveLength(grid.length);
      expect(Math.min(...ranked.map((c) => c.affinity))).toBe(0);
      expect(Math.max(...ranked.map((c) => c.affinity))).toBe(1);
    }
    for (const entry of reference.values()) expect(entry.n).toBe(CANDIDATES.length);
  });

  it("keeps a sparser heatmap on the reference's scale: missing grid cells count as tied at the bottom", () => {
    const cells = heatmaps["food-hot-sauce"];
    const full = new Map(gridPercentiles(cells, reference).map((c) => [c.geohash, c.affinity]));
    // Drop the lowest 40% of this audience's grid cells, as a sparse live heatmap might.
    const sorted = gridPercentiles(cells, reference).sort((a, b) => a.affinity - b.affinity);
    const kept = new Set(sorted.slice(Math.floor(sorted.length * 0.4)).map((c) => c.geohash));
    const sparse = cells.filter((c) => kept.has(c.geohash));
    expect(gridCoverage(sparse, reference)).toBeLessThan(0.7);
    for (const cell of gridPercentiles(sparse, reference)) expect(cell.affinity).toBeCloseTo(full.get(cell.geohash) as number, 10);
  });

  it("matches the frozen reference file", () => {
    const file = JSON.parse(readFileSync("data/geo/reference-heatmap.json", "utf8")) as { cells: Record<string, [number, number]> };
    expect(Object.keys(file.cells).length).toBe(reference.size);
    for (const [hash, { sum, n }] of reference) {
      expect(file.cells[hash][1]).toBe(n);
      expect(file.cells[hash][0]).toBeCloseTo(sum, 5);
    }
  });

  it("with leave-one-out, sums each cell's lifts to zero across the reference audiences (separation is partly built in)", () => {
    const [hash] = reference.keys();
    const lifts = CANDIDATES.map((c) => {
      const cell = gridPercentiles(heatmaps[c.slug], reference).find((x) => x.geohash === hash) as { affinity: number };
      const ref = reference.get(hash) as { sum: number; n: number };
      return cell.affinity - (ref.sum - cell.affinity) / (ref.n - 1);
    });
    expect(lifts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10);
  });

  it("leaves the audience's own cells out of the reference", () => {
    const solo = buildReferenceHeatmap([heatmaps["food-hot-sauce"]]);
    // With only itself in the reference, leave-one-out leaves nothing to compare against.
    expect(liftByMetro(heatmaps["food-hot-sauce"], solo, { own: true })).toEqual([]);
  });
});

describe("locality echo check", () => {
  it("is exact when Qloo matched the city itself in the right state", () => {
    expect(localityMatch({ name: "Reno", disambiguation: "Reno, Washoe County, Nevada, United States" }, "Reno, NV")).toBe("exact");
  });

  it("is partial when the city's name sits in a different unit of the right state", () => {
    expect(localityMatch({ name: "East Baton Rouge Parish", disambiguation: "East Baton Rouge Parish, Louisiana, United States" }, "Baton Rouge, LA")).toBe("partial");
    expect(localityMatch({ name: "Flint Charter Township", disambiguation: "Flint Charter Township, Genesee County, Michigan, United States" }, "Flint, MI")).toBe("partial");
    expect(localityMatch({ name: "Jackson County", disambiguation: "Jackson County, Mississippi, United States" }, "Jackson, MS")).toBe("partial");
    expect(localityMatchesMetro({ name: "Jackson County", disambiguation: "Jackson County, Mississippi, United States" }, "Jackson, MS")).toBe(true);
  });

  it("is a mismatch in the wrong state or city", () => {
    expect(localityMatch({ name: "Atlanta", disambiguation: "Atlanta, Cass, Texas, United States of America" }, "Atlanta, GA")).toBe("mismatch");
    expect(localityMatch({ name: "Dallas", disambiguation: "Dallas, Texas, United States" }, "Austin, TX")).toBe("mismatch");
  });
});
