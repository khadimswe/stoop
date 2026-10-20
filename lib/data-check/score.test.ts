import { describe, expect, it } from "vitest";
import { CANDIDATES } from "../demo/candidates";
import { findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { demographicsResponse, insightsEntitiesResponse } from "../qloo/types";
import { controlText, loadRuns } from "./plan";
import { METROS } from "../geo/metros";
import {
  ageGap,
  bucketsForBand,
  buildPanel,
  choicePosition,
  cityRank,
  guessedMetro,
  meanSkew,
  moodTerm,
  musicTerm,
  pickSegmentBuckets,
  rankedBuckets,
  signalLevel,
  topOverlap,
} from "./score";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const insights = ifRecorded(() => readFixtureFile(findFixture("probe-insights") as string));

describe("Control text to tag queries", () => {
  it("pulls the genre phrase out of each committed Control's music style", () => {
    const terms = Object.fromEntries(CANDIDATES.map((c) => [c.slug, musicTerm(controlText(c, loadRuns(c.slug)).music)]));
    expect(terms).toMatchObject({
      "apparel-everyday": "Lo-fi hip hop",
      "food-hot-sauce": "funk-soul",
      "food-coffee": "acoustic indie folk",
      "startup-bike-light": "downtempo electronic",
      "home-candles": "indie folk",
    });
  });

  it("takes the mood's lead word", () => {
    expect(moodTerm("Calm, confident, tactile, quietly satisfying")).toBe("Calm");
    expect(moodTerm("Quiet relief")).toBe("Quiet relief");
  });
});

describeRecorded("demographics", () => {
  const skew = meanSkew(demographicsResponse.parse(recorded(insights, "demographics").body));

  it("averages Qloo's per-seed skews", () => {
    // Recorded 24_and_younger skews for the three apparel seeds: 0.24, 0.03 and 0.38.
    expect(skew.age["24_and_younger"]).toBeCloseTo((0.24 + 0.03 + 0.38) / 3, 10);
    expect(rankedBuckets(skew.age)[0]).toBe("24_and_younger");
  });

  it("picks two segments that are not neighbors when it can", () => {
    const [first, second] = pickSegmentBuckets(skew.age);
    expect(first).toBe("24_and_younger");
    expect(second).not.toBe("25_to_29");
  });

  const pool = readFixtureFile(findFixture("pool-audience") as string);
  const poolSkew = (slug: string) => meanSkew(demographicsResponse.parse(recorded(pool, `${slug}--demographics`).body)).age;

  it("never makes an under-indexed bucket a segment", () => {
    // The bike light: only 45 to 54 over-indexes.
    expect(pickSegmentBuckets(poolSkew("startup-bike-light"))).toEqual(["45_to_54"]);
  });

  it("counts an age gap only when Qloo's top bucket clearly beats every stated one", () => {
    // Pet hats: 18 to 24 (0.22) against a stated 35 to 44 (0.19) is a near tie, not a gap.
    expect(ageGap(poolSkew("pets-outfits"), bucketsForBand("25 to 40"))).toBe(false);
    // Hot sauce: 55 and older (0.21) against a stated best of 0.06.
    expect(ageGap(poolSkew("food-hot-sauce"), bucketsForBand("25 to 40"))).toBe(true);
  });

  it("maps a stated band to the Qloo buckets it overlaps", () => {
    expect(bucketsForBand("College students and young adults, 18 to 24, who want basics")).toEqual(["24_and_younger"]);
    expect(bucketsForBand("Home cooks, 25 to 40.")).toEqual(["25_to_29", "30_to_34", "35_to_44"]);
    expect(bucketsForBand("no band")).toEqual([]);
    // Touching a bucket by a year or two doesn't state it; a very narrow band states the bucket it falls in.
    expect(bucketsForBand("Commuters, 25 to 45")).toEqual(["25_to_29", "30_to_34", "35_to_44"]);
    expect(bucketsForBand("Remote workers, 28 to 45")).toEqual(["30_to_34", "35_to_44"]);
    expect(bucketsForBand("Grad students, 21 to 22")).toEqual(["24_and_younger"]);
    expect(bucketsForBand("Early-career, 29 to 30")).toEqual(["25_to_29", "30_to_34"]);
  });
});

describe("topOverlap", () => {
  it("is the Jaccard overlap of the first n ids", () => {
    expect(topOverlap(["a", "b", "c"], ["b", "c", "d"], 3)).toBeCloseTo(2 / 4);
    expect(topOverlap(["a"], ["b"])).toBe(0);
    expect(topOverlap([], [])).toBe(0);
  });
});

describeRecorded("buildPanel on a recorded list", () => {
  const artists = insightsEntitiesResponse.parse(recorded(insights, "artist-take50").body);
  const pool = artists.map((e, i) => ({ id: e.id, name: e.name, popularity: e.popularity ?? 0, source: `s${i % 10}`, request: "artist-take50" }));

  it("spreads 25 entries across popularity, at most 3 per source, deterministically", () => {
    const panel = buildPanel(pool);
    expect(panel).toHaveLength(25);
    expect(new Set(panel.map((p) => p.id)).size).toBe(25);
    const perSource = new Map<string, number>();
    for (const p of panel) perSource.set(p.source, (perSource.get(p.source) ?? 0) + 1);
    for (const count of perSource.values()) expect(count).toBeLessThanOrEqual(3);
    const pops = pool.map((p) => p.popularity).sort((a, b) => a - b);
    expect(panel[0].popularity).toBe(pops[0]);
    expect(buildPanel(pool)).toEqual(panel);
  });

  it("never includes an excluded id", () => {
    const exclude = new Set(pool.slice(0, 10).map((p) => p.id.toUpperCase()));
    for (const p of buildPanel(pool, { exclude })) expect(exclude.has(p.id)).toBe(false);
  });

  it("refuses a pool too small to fill the panel", () => {
    expect(() => buildPanel(pool.slice(0, 10))).toThrow(/Only 10 eligible/);
  });
});

describe("signal levels", () => {
  const panel = Array.from({ length: 25 }, (_, i) => 0.8 + i * 0.005);

  it("counts picks that beat at least 75% of the panel", () => {
    expect(signalLevel([0.99, 0.98, 0.97, 0.5], panel)).toEqual({ level: "rich", strong: 3 });
    expect(signalLevel([0.99, 0.5], panel)).toEqual({ level: "thin", strong: 1 });
    expect(signalLevel([0.5], panel)).toEqual({ level: "none", strong: 0 });
  });

  it("says when a choice is below the panel median, and has no position when Qloo did not return it", () => {
    expect(choicePosition(0.812, panel)).toMatchObject({ beats: 3, of: 25, belowMedian: true });
    expect(choicePosition(undefined, panel)).toBeNull();
  });
});

describe("cityRank", () => {
  const ranked = ["Boulder, CO", "San Francisco-Oakland-Fremont, CA", "New York-Newark-Jersey City, NY-NJ", "Portland-South Portland, ME"].map((name) => {
    const metro = METROS.find((m) => m.name === name);
    if (!metro) throw new Error(name);
    return metro;
  });

  it("finds a guessed city among the ranked metros, by any city in the metro name", () => {
    expect(cityRank("Oakland", ranked, METROS)).toBe(2);
    expect(cityRank("Brooklyn", ranked, METROS)).toBe(3);
    expect(cityRank("Los Angeles", ranked, METROS)).toBeNull();
  });

  it("reads a bare famous name as the famous city: Portland means Oregon, not Maine", () => {
    expect(guessedMetro("Portland", METROS)?.name).toBe("Portland-Vancouver-Hillsboro, OR-WA");
    expect(cityRank("Portland", ranked, METROS)).toBeNull();
  });
});
