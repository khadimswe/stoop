import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGE_BUCKETS } from "../qloo/constants";
import type { ExampleSlug } from "../demo/examples";
import { ledgerOf } from "../report/view/receipts";
import type { Report } from "../report/schema";
import { figurePartsAt, figureText } from "./count-up";
import { ageFigure, ageStat, cityStat, firstClause, musicStat, PROOF_PICKS, proofStats } from "./proof";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const load = (slug: ExampleSlug) => {
  const report = read(slug);
  return { report, ledger: ledgerOf(report) };
};
const DASH = String.fromCharCode(0x2014);
const BANNED = new RegExp(`real buyers|really buys|measures your buyers|find my buyers|andromeda|24 and younger|24_and_younger|%|percentile|${DASH}`, "i");

describe("the proof band, pinned to the recorded runs", () => {
  const stats = proofStats(PROOF_PICKS, load);

  it("shows the four picks, in order, with the recorded figures", () => {
    expect(stats.map((s) => [s.id, s.figureText])).toEqual([
      ["food-hot-sauce-age", "55+"],
      ["pets-outfits-city", "#319 of 321"],
      ["food-hot-sauce-music", "0 of 19"],
      ["home-candles-age", "18 to 24"],
    ]);
  });

  it("gives every stat its brand and a receipt with the Qloo calls behind it", () => {
    for (const stat of stats) {
      const slug = PROOF_PICKS.find((p) => stat.id.startsWith(p.slug))!.slug;
      expect(stat.brand).toBe(read(slug).inputs.product.brandName);
      expect(stat.figureText).toBe(figureText(stat.figure));
      expect(stat.receipt.calls).toBeGreaterThan(0);
      expect(stat.receipt.rows.some((r) => r.label === "Endpoint" && r.value === "/v2/insights")).toBe(true);
      // The words the stat writes; the receipt's mono rows are the raw Qloo calls, shown as sent.
      const words = [stat.claim.text, stat.unit, stat.detail, stat.receipt.title, ...stat.receipt.rows.filter((r) => !r.mono).map((r) => r.value)];
      for (const line of words) expect(line).not.toMatch(BANNED);
    }
  });

  it("never shows an age under 18, on any frame of the count", () => {
    for (const stat of stats.filter((s) => s.id.endsWith("-age"))) {
      for (let i = 0; i <= 20; i++) for (const part of figurePartsAt(stat.figure, i / 20)) if (/^\d+$/.test(part)) expect(Number(part)).toBeGreaterThanOrEqual(18);
    }
  });

  it("drops a pick the data no longer supports instead of padding the band", () => {
    const report = read("pets-outfits");
    // Whisker & Brim's age is a near tie, never a gap: it is not a stat.
    expect(ageStat("pets-outfits", report, ledgerOf(report))).toBeNull();
    expect(proofStats([{ slug: "pets-outfits", kind: "age" }], load)).toEqual([]);
  });
});

describe("Porchlight Pepper Co.: stated 25 to 40, measured 55 and older", () => {
  const report = read("food-hot-sauce");
  const stat = ageStat("food-hot-sauce", report, ledgerOf(report))!;
  const age = report.audience.gap!.dimensions.find((d) => d.dimension === "age")!;

  it("is a full gap in the recorded Reality Check", () => {
    expect(age).toMatchObject({ outcome: "gap", stated: "25 to 40", statedBy: "you", measured: "top skew 55 and older (0.21)" });
  });

  it("reads the founder's band and Qloo's top skew", () => {
    expect(stat.claim).toEqual({ text: "Said 25 to 40", source: "brand" });
    expect(stat.unit).toBe("Qloo measured: skews 55 and older");
    expect(stat.receipt.rows.slice(0, 3)).toEqual([
      { label: "Brand said", value: "25 to 40" },
      { label: "Qloo measured", value: "top skew 55 and older (0.21)" },
      { label: "Outcome", value: "Gap: Qloo's top age skew is outside the stated band" },
    ]);
    // The demographics call, once.
    expect(stat.receipt.calls).toBe(new Set(age.evidenceIds).size);
  });
});

describe("Lowlight Candle Co.: stated 28 to 45, measured 18 to 24", () => {
  const report = read("home-candles");
  const stat = ageStat("home-candles", report, ledgerOf(report))!;

  it("labels the youngest bucket for adults only", () => {
    expect(stat.figureText).toBe("18 to 24");
    expect(stat.claim.text).toBe("Said 28 to 45");
    expect(stat.unit).toBe("Qloo measured: skews 18 to 24");
  });
});

describe("Whisker & Brim: the generic brief's city", () => {
  const report = read("pets-outfits");
  const stat = cityStat("pets-outfits", report, ledgerOf(report))!;
  const cities = report.control!.fits.flatMap((f) => f.choices.filter((c) => c.dimension === "cities" && c.text === "Los Angeles"));

  it("is the Control's lowest-ranked city, as the check recorded it", () => {
    expect(cities.map((c) => [c.status, c.rank])).toEqual([
      ["below", { rank: 317, of: 322 }],
      ["below", { rank: 319, of: 321 }],
    ]);
    expect(stat.claim).toEqual({ text: "Picked Los Angeles", source: "generic" });
    expect(stat.unit).toBe("Where Qloo ranks Los Angeles among this world's cities");
    expect(stat.detail).toBe("World: 35 to 44 · country and pop rock. For 18 to 24 · pop and country pop: #317 of 322.");
    expect(stat.receipt.rows).toContainEqual({ label: "Qloo measured", value: "Los Angeles, CA ranks #319 of 321 cities for this world" });
    expect(stat.receipt.rows).toContainEqual({ label: "Check", value: "Cliche flagged" });
    expect(stat.receipt.rows).toContainEqual({ label: "Other world", value: "18 to 24 · pop and country pop: Los Angeles, CA ranks #317 of 322 cities for this world (Cliche flagged)" });
  });

  it("carries the Qloo call behind every number it shows, the other world's included", () => {
    expect(stat.receipt.calls).toBe(new Set(cities.flatMap((c) => c.evidenceIds)).size);
    expect(stat.receipt.calls).toBe(2);
  });
});

describe("Porchlight Pepper Co.: the generic brief's music", () => {
  const report = read("food-hot-sauce");
  const stat = musicStat("food-hot-sauce", report, ledgerOf(report))!;
  const music = report.control!.fits.flatMap((f) => f.choices.filter((c) => c.dimension === "music"));

  it("names the world it misses and says how it fares in the other", () => {
    expect(stat.claim).toEqual({ text: "Picked upbeat funk-soul groove with a tight drum break", source: "generic" });
    expect(stat.unit).toBe("Reference music tags it beats, scored as “Soul - Funk”");
    expect(stat.detail).toBe("World: 35 to 44 · americana and country. For 55 and older · rock and classic rock it beats 19 of 19.");
    expect(stat.receipt.rows).toContainEqual({ label: "Check", value: "Cliche flagged" });
    expect(stat.receipt.rows).toContainEqual({ label: "Other world", value: "55 and older · rock and classic rock: beats 19 of 19 (Supported)" });
  });

  it("carries the Qloo calls behind both worlds' numbers", () => {
    expect(stat.receipt.calls).toBe(new Set(music.flatMap((c) => c.evidenceIds)).size);
    expect(stat.receipt.calls).toBe(3);
  });
});

describe("figure helpers", () => {
  it("writes each age bucket as adults only, counting from 18", () => {
    expect(figureText(ageFigure("24_and_younger"))).toBe("18 to 24");
    expect(figureText(ageFigure("35_to_44"))).toBe("35 to 44");
    expect(figureText(ageFigure("55_and_older"))).toBe("55+");
    for (const bucket of AGE_BUCKETS) for (const part of figurePartsAt(ageFigure(bucket), 0)) if (/^\d+$/.test(part)) expect(Number(part)).toBe(18);
  });

  it("cuts a long brief line at its first clause", () => {
    expect(firstClause("Upbeat bedroom pop with a soft shuffle groove, plucked ukulele")).toBe("Upbeat bedroom pop with a soft shuffle groove");
    expect(firstClause("lo-fi")).toBe("lo-fi");
  });
});
