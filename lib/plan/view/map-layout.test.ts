import { describe, expect, it } from "vitest";
import { boundsOf, labelSides, PIN_PX, spreadPins } from "./map-layout";

const after = (points: { x: number; y: number }[], nudges: [number, number][]) => points.map((p, i) => ({ x: p.x + nudges[i]![0], y: p.y + nudges[i]![1] }));
const closest = (points: { x: number; y: number }[]) => {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) best = Math.min(best, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
  return best;
};

describe("boundsOf", () => {
  it("fits every point", () => {
    expect(
      boundsOf([
        { lat: 41.85, lon: -87.66 },
        { lat: 41.87, lon: -87.64 },
        { lat: 41.86, lon: -87.67 },
      ]),
    ).toEqual([
      [-87.67, 41.85],
      [-87.64, 41.87],
    ]);
  });

  it("gives a lone point a small box, and nothing for no points", () => {
    const b = boundsOf([{ lat: 41.85, lon: -87.66 }])!;
    expect(b[0][0]).toBeLessThan(-87.66);
    expect(b[1][1]).toBeGreaterThan(41.85);
    expect(boundsOf([])).toBeNull();
  });
});

describe("labelSides", () => {
  it("puts a label on the right unless the right covers the store's pill", () => {
    expect(labelSides([{ x: 100, y: 100, width: 80 }])).toEqual(["right"]);
    expect(labelSides([{ x: 100, y: 100, width: 80 }], { avoid: { x0: 110, y0: 90, x1: 200, y1: 110 } })).toEqual(["left"]);
  });

  it("keeps a label inside the map", () => {
    expect(labelSides([{ x: 300, y: 100, width: 80 }], { frame: { x0: 0, y0: 0, x1: 340, y1: 340 } })).toEqual(["left"]);
  });

  it("keeps two labels from covering each other", () => {
    expect(
      labelSides([
        { x: 100, y: 100, width: 80 },
        { x: 190, y: 102, width: 80 },
      ]),
    ).toEqual(["left", "right"]);
  });

  it("hides a label that would cover a pin on either side", () => {
    expect(
      labelSides([
        { x: 100, y: 100, width: 80 },
        { x: 150, y: 100, width: 0 },
        { x: 50, y: 100, width: 0 },
      ])[0],
    ).toBe("hidden");
  });
});

describe("spreadPins", () => {
  it("leaves pins that do not touch where they are", () => {
    expect(
      spreadPins([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("pushes pins on the same spot apart so each stays visible", () => {
    const points = [
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 52, y: 49 },
    ];
    const moved = after(points, spreadPins(points));
    expect(closest(moved)).toBeGreaterThanOrEqual(PIN_PX);
  });

  it("keeps pins out from under the store's pill", () => {
    const points = [{ x: 30, y: 2 }];
    const [[, dy]] = spreadPins(points, { avoid: { x0: -14, y0: -15, x1: 90, y1: 15 } }) as [[number, number]];
    expect(2 + dy).toBeGreaterThan(15);
  });

  it("is deterministic", () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ x: (i % 3) * 4, y: Math.floor(i / 3) * 4 }));
    expect(spreadPins(points)).toEqual(spreadPins(points));
  });
});
