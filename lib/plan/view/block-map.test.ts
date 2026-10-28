import { describe, expect, it } from "vitest";
import { mapMode, offsetMeters, projectPlaces, ringRadius, stripX } from "./block-map";

// Geometry only: the points here are positions on a plane, not Qloo results.
const center = { lat: 41.8576, lon: -87.6566 };

describe("the block map", () => {
  it("puts north up and east right, with meters that match the map's scale", () => {
    const north = { lat: center.lat + 400 / 110_540, lon: center.lon };
    const east = { lat: center.lat, lon: center.lon + 400 / (111_320 * Math.cos((center.lat * Math.PI) / 180)) };
    expect(offsetMeters(center, north).north).toBeCloseTo(400, 0);
    expect(offsetMeters(center, east).east).toBeCloseTo(400, 0);
    const [n, e] = projectPlaces(center, 1500, [
      { id: "n", point: north },
      { id: "e", point: east },
    ]);
    expect(n!.y).toBeLessThan(160);
    expect(n!.x).toBeCloseTo(160, 5);
    expect(e!.x).toBeGreaterThan(160);
    expect(160 - n!.y).toBeCloseTo(ringRadius(400, 1500), 1);
  });

  it("pulls far places onto the radius and leaves out places with no coordinates", () => {
    const far = { lat: center.lat + 5000 / 110_540, lon: center.lon };
    const points = projectPlaces(center, 1500, [
      { id: "far", point: far },
      { id: "none", point: null },
    ]);
    expect(points).toHaveLength(1);
    expect(160 - points[0]!.y).toBeCloseTo(ringRadius(1500, 1500), 5);
  });

  it("falls back to distance only without enough coordinates", () => {
    expect(mapMode([{ point: null }, { point: center }])).toBe("strip");
    expect(mapMode([{ point: center }, { point: center }, { point: center }])).toBe("map");
    expect(stripX(750, 1500, 300)).toBe(150);
    expect(stripX(9000, 1500, 300)).toBe(300);
  });
});
