import { describe, expect, it } from "vitest";
import { joinByGeohash, linearFit, median, panelPosition, rankWithin, ratioLift, residualLift, topBy } from "./lift";

describe("linearFit", () => {
  it("recovers a perfect line", () => {
    const { slope, intercept } = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(slope).toBeCloseTo(2);
    expect(intercept).toBeCloseTo(1);
  });

  it("returns slope 0 when x does not vary", () => {
    expect(linearFit([0.5, 0.5, 0.5], [1, 2, 3])).toEqual({ slope: 0, intercept: 2 });
  });

  it("rejects mismatched arrays", () => {
    expect(() => linearFit([1, 2], [1])).toThrow();
  });
});

describe("residualLift", () => {
  it("is zero when affinity is fully explained by popularity", () => {
    const cells = [0.1, 0.4, 0.7, 0.9].map((popularity) => ({ popularity, affinity: 0.2 + 0.5 * popularity }));
    for (const lift of residualLift(cells)) expect(lift).toBeCloseTo(0);
  });

  it("ranks an over-indexing area above a bigger but average one", () => {
    const cells = [
      { popularity: 0.95, affinity: 0.9 }, // big city, as expected
      { popularity: 0.5, affinity: 0.75 }, // mid-size city, loves it more than its size predicts
      { popularity: 0.3, affinity: 0.3 },
      { popularity: 0.7, affinity: 0.6 },
    ];
    const lifts = residualLift(cells);
    expect(lifts[1]).toBeGreaterThan(lifts[0]);
    expect(Math.max(...lifts)).toBe(lifts[1]);
  });
});

describe("ratioLift", () => {
  it("divides by the baseline", () => {
    expect(ratioLift(0.8, 0.4)).toBeCloseTo(2);
  });

  it("floors tiny baselines", () => {
    expect(ratioLift(0.5, 0)).toBeCloseTo(10);
    expect(ratioLift(0.5, 0.001, 0.1)).toBeCloseTo(5);
  });
});

describe("joinByGeohash", () => {
  it("keeps only cells present in both maps", () => {
    const joined = joinByGeohash(
      [
        { geohash: "dn5", v: 1 },
        { geohash: "9q8", v: 2 },
      ],
      [
        { geohash: "9q8", w: 3 },
        { geohash: "dr5", w: 4 },
      ],
    );
    expect(joined).toEqual([{ geohash: "9q8", target: { geohash: "9q8", v: 2 }, baseline: { geohash: "9q8", w: 3 } }]);
  });
});

describe("ranking helpers", () => {
  it("ranks highest first and shares rank on ties", () => {
    expect(rankWithin([0.5, 0.9, 0.5, 0.1])).toEqual([2, 1, 2, 4]);
  });

  it("takes the top n, stable on ties", () => {
    expect(topBy(["a", "b", "c", "d"], (s) => ({ a: 1, b: 3, c: 3, d: 2 })[s] ?? 0, 3)).toEqual(["b", "c", "d"]);
  });

  it("computes the median for odd, even, and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("panelPosition", () => {
  const panel = [0.1, 0.2, 0.3, 0.4, 0.5];

  it("counts how many reference items a score beats", () => {
    expect(panelPosition(0.45, panel)).toEqual({ beats: 4, of: 5, aboveMedian: true });
  });

  it("marks scores at or below the median as not above it", () => {
    expect(panelPosition(0.3, panel)).toEqual({ beats: 2, of: 5, aboveMedian: false });
  });

  it("returns null for an empty panel instead of guessing", () => {
    expect(panelPosition(0.3, [])).toEqual({ beats: 0, of: 0, aboveMedian: null });
  });
});

describe("heatmap fixtures", () => {
  it.todo("TODO(slice-2): heatmap fixture -> lift ranking, residual vs. baseline ratio");
});
