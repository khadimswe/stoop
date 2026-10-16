// The golden test: every recorded example run reduces to exactly its stored report, and re-running
// the stages on the fixtures reproduces both files byte for byte. Plus what each pick must show.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordExampleAudience } from "../demo/example-run";
import { EXAMPLES } from "../demo/examples";
import { reduce, toReport, type RunEvent } from "../events";
import type { Report } from "../report/schema";

const read = <T>(slug: string, file: string) => JSON.parse(readFileSync(`data/runs/${slug}/${file}`, "utf8")) as T;
const stored = Object.fromEntries(
  EXAMPLES.map(({ slug }) => [slug, { events: read<RunEvent[]>(slug, "audience.events.json"), report: read<Report>(slug, "audience.report.json") }]),
);
// The same writer as scripts/run-audience.ts: U+2014 in Qloo names is stored as an escape.
const asStored = (value: unknown) => `${JSON.stringify(value, null, 2).replace(new RegExp(String.fromCharCode(0x2014), "g"), "\\u2014")}\n`;

describe.each(EXAMPLES.map((e) => [e.slug] as const))("%s recorded audience run", (slug) => {
  it("reduces to exactly the stored report", () => {
    expect(toReport(reduce(stored[slug].events))).toEqual(stored[slug].report);
  });

  it("re-runs from fixtures to the same events and report, byte for byte", async () => {
    const { events, report } = await recordExampleAudience(slug);
    expect(asStored(events)).toBe(readFileSync(`data/runs/${slug}/audience.events.json`, "utf8"));
    expect(asStored(report)).toBe(readFileSync(`data/runs/${slug}/audience.report.json`, "utf8"));
  });

  it("has a receipt for every evidence id it cites", () => {
    const { report } = stored[slug];
    const ids = new Set(report.ledger.map((e) => e.id));
    const cited = JSON.stringify(report.audience).match(/ev_[0-9a-f]{12}/g) ?? [];
    for (const id of cited) expect(ids.has(id)).toBe(true);
  });

  it("keeps every segment adult and never calls the youngest bucket anything but 18 to 24", () => {
    for (const segment of stored[slug].report.audience.segments?.items ?? []) {
      if (segment.bucket === "24_and_younger") expect(segment.ageBand).toBe("18 to 24");
      expect(segment.label).not.toMatch(/\b(teen|kids?|children|under 18|1[0-7]\b)/i);
    }
  });

  it("never says buyers, and says skews, not shares", () => {
    const text = stored[slug].report.audience.gap?.lines.map((l) => l.text).join(" ") ?? "";
    expect(text).not.toMatch(/buyers|% of/i);
  });
});

describe("what each pick shows", () => {
  const gap = (slug: string) => stored[slug].report.audience.gap;
  const proof = (slug: string) => stored[slug].report.audience.proof;

  it("Porchlight Pepper Co. (the lead) is a gap: you said 25 to 40, Qloo measures 55 and older, in Louisiana", () => {
    expect(gap("food-hot-sauce")).toMatchObject({ outcome: "gap" });
    expect(gap("food-hot-sauce")?.lines[0].text).toBe("You said 25 to 40.");
    expect(gap("food-hot-sauce")?.lines.some((l) => l.kind === "measured" && /skews 55 and older/.test(l.text))).toBe(true);
    const top = proof("food-hot-sauce")?.cities.slice(0, 2).map((c) => c.label);
    expect(top).toEqual(["Slidell, LA", "Baton Rouge, LA"]);
    expect(stored["food-hot-sauce"].report.inputs.product.brandName).toBe("Porchlight Pepper Co.");
  });

  it("Lowlight Candle Co. is a gap: 28 to 45 stated, 18 to 24 measured", () => {
    expect(gap("home-candles")?.outcome).toBe("gap");
    expect(gap("home-candles")?.dimensions.find((d) => d.dimension === "age")).toMatchObject({ outcome: "gap", stated: "28 to 45" });
  });

  it("Whisker & Brim is the example that is not a full gap: age is a near tie, and the generic brief still shows", () => {
    expect(gap("pets-outfits")?.outcome).toBe("partly");
    expect(gap("pets-outfits")?.dimensions.find((d) => d.dimension === "age")?.outcome).toBe("near_tie");
    expect(gap("pets-outfits")?.lines.map((l) => l.kind)).toEqual(expect.arrayContaining(["near", "generic"]));
    expect(gap("pets-outfits")?.lines.some((l) => l.kind === "near" && /isn't a gap/.test(l.text))).toBe(true);
    expect(stored["pets-outfits"].report.audience.segments).toMatchObject({ distinctness: 0.95, merged: false });
  });

  it("ranks cities against the full reference set and says how big it is", () => {
    for (const { slug } of EXAMPLES) {
      for (const city of proof(slug)?.cities ?? []) expect(city.comparedWith).toBe(22);
    }
    // Cincinnati led the candles against the 9 candidates alone and does not hold against the full set.
    expect(proof("home-candles")?.smallSetOnly).toEqual([{ label: "Cincinnati, OH", candidateSetRank: 1, fullRank: 16 }]);
  });

  it("names two worlds differently when they differ", () => {
    for (const { slug } of EXAMPLES) {
      const labels = stored[slug].report.audience.segments?.items.map((s) => s.label) ?? [];
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
