import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExampleSlug } from "../demo/examples";
import { ledgerOf } from "../report/view/receipts";
import type { Report } from "../report/schema";
import { ageFigure, ageStat, cityStat, firstClause, musicStat, PROOF_PICKS, proofStats } from "./proof";
import { figureText } from "./count-up";

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

  it("gives every stat its brand, its example and a receipt with the Qloo calls behind it", () => {
    for (const stat of stats) {
      const slug = PROOF_PICKS.find((p) => stat.id.startsWith(p.slug))!.slug;
      expect(stat.href).toBe(`/examples/${slug}`);
      expect(stat.brand).toBe(read(slug).inputs.product.brandName);
      expect(stat.figureText).toBe(figureText(stat.figure));
      expect(stat.receipt.calls).toBeGreaterThan(0);
      expect(stat.receipt.rows.some((r) => r.label === "Endpoint" && r.value === "/v2/insights")).toBe(true);
      for (const line of [stat.claim.text, stat.unit, stat.detail, stat.receipt.title, ...stat.receipt.rows.map((r) => r.value)]) expect(line).not.toMatch(BANNED);
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
    expect(age).toMatchObject({ outcome: "gap", stated: "25 to 40", measured: "top skew 55 and older (0.21)" });
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

  it("is the Control's lowest-ranked city, as the check recorded it", () => {
    const choice = report.control!.fits.find((f) => f.segmentId === "seg-35-to-44")!.choices.find((c) => c.dimension === "cities" && c.text === "Los Angeles")!;
    expect(choice).toMatchObject({ status: "below", rank: { rank: 319, of: 321 } });
    expect(stat.claim).toEqual({ text: "Picked Los Angeles", source: "generic" });
    expect(stat.unit).toBe("Where Qloo ranks Los Angeles, CA among this world's cities");
    expect(stat.detail).toBe("World: 35 to 44 · country and pop rock. #317 of 322 for the other.");
    expect(stat.receipt.rows).toContainEqual({ label: "Qloo measured", value: "Los Angeles, CA ranks #319 of 321 cities for this world" });
    expect(stat.receipt.rows).toContainEqual({ label: "Check", value: "Cliche flagged" });
    expect(stat.receipt.calls).toBe(new Set(choice.evidenceIds).size);
  });
});

describe("Porchlight Pepper Co.: the generic brief's music", () => {
  const report = read("food-hot-sauce");
  const stat = musicStat("food-hot-sauce", report, ledgerOf(report))!;

  it("names the world it misses and says how it fares in the other", () => {
    expect(stat.claim).toEqual({ text: "Picked upbeat funk-soul groove with a tight drum break", source: "generic" });
    expect(stat.unit).toBe("Reference music tags it beats, scored as “Soul - Funk”");
    expect(stat.detail).toBe("World: 35 to 44 · americana and country. For the other world it beats 19 of 19.");
    expect(stat.receipt.rows).toContainEqual({ label: "Check", value: "Cliche flagged" });
    expect(stat.receipt.rows).toContainEqual({ label: "Other world", value: "55 and older · rock and classic rock: beats 19 of 19 (Supported)" });
  });
});

describe("figure helpers", () => {
  it("writes each age bucket as adults only", () => {
    expect(figureText(ageFigure("24_and_younger"))).toBe("18 to 24");
    expect(figureText(ageFigure("35_to_44"))).toBe("35 to 44");
    expect(figureText(ageFigure("55_and_older"))).toBe("55+");
  });

  it("cuts a long brief line at its first clause", () => {
    expect(firstClause("Upbeat bedroom pop with a soft shuffle groove, plucked ukulele")).toBe("Upbeat bedroom pop with a soft shuffle groove");
    expect(firstClause("lo-fi")).toBe("lo-fi");
  });
});
