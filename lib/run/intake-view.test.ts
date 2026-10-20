import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { IntakeResponse } from "../api/responses";
import type { Report } from "../report/schema";
import { productFrom } from "../runtime/intake";
import { priceFrom, seedsReceipt, seedView, siteSpeaksTo } from "./intake-view";

const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;

describe("the product card", () => {
  it("reads the price the page gave from the seller facts, and nothing when there is none", () => {
    const description = "A fermented red chile hot sauce made in small batches.";
    const read = { url: "https://porchlight.example/products/red", source: "shopify" as const, copy: "", flags: [], fetches: [] };
    const priced = productFrom({}, { ...read, product: { name: "Red Hot Sauce", tags: [], images: [], price: "14.00", currency: "USD", description } });
    expect(priceFrom(priced.sellerFacts)).toBe("14.00 USD");
    const quoted = productFrom({}, { ...read, product: { name: "Red Hot Sauce", tags: [], images: [], price: "16.00", currency: "USD", description: `${description} Price: $14.` } });
    expect(priceFrom(quoted.sellerFacts)).toBe("16.00 USD");
    expect(priceFrom(report.inputs.product.sellerFacts)).toBe("$14");
    expect(priceFrom(productFrom({ description }, null).sellerFacts)).toBeNull();
    expect(priceFrom(undefined)).toBeNull();
  });
});

describe("Your site speaks to", () => {
  // A reading in Qloo's dimensions; its taste tag is a real Qloo tag from the recorded run, with its receipt.
  const tag = report.audience.proof!.tags[0];
  const site: NonNullable<IntakeResponse["site"]> = {
    label: "Read from your site",
    ageBands: [
      { bucket: "25_to_29", label: "25 to 29" },
      { bucket: "30_to_34", label: "30 to 34" },
    ],
    genderSkew: "female",
    place: "Austin, TX",
    tags: [{ id: tag.id, name: tag.name, evidenceIds: tag.evidenceIds }],
  };

  it("says it in age bands, gender, place and taste tags", () => {
    expect(siteSpeaksTo(site)).toBe(`25 to 29 and 30 to 34, leans female, around Austin, TX, into ${tag.name}`);
    expect(siteSpeaksTo({ ...site, ageBands: [{ bucket: "24_and_younger", label: "18 to 24" }], genderSkew: "balanced", place: null, tags: [] })).toBe("18 to 24, no clear gender lean");
  });

  it("says nothing when the page was not read or gave nothing to go on", () => {
    expect(siteSpeaksTo(null)).toBeNull();
    expect(siteSpeaksTo({ ...site, ageBands: [], genderSkew: null, place: null, tags: [] })).toBeNull();
  });
});

describe("the seeds", () => {
  it("show each seed's name, plain type and origin", () => {
    expect(report.inputs.seeds.map(seedView)).toEqual(report.inputs.seeds.map((s) => ({ id: s.ref.id, name: s.ref.name, kind: expect.any(String), origin: s.origin })));
    expect(seedView(report.inputs.seeds.find((s) => s.ref.type === "urn:entity:tv_show")!).kind).toBe("tv show");
  });

  it("open one receipt with every Qloo call behind them", () => {
    const receipt = seedsReceipt(report.inputs.seeds, report.ledger)!;
    const ids = new Set(report.inputs.seeds.flatMap((s) => s.evidenceIds));
    expect(receipt).toMatchObject({ cue: "Seeds", calls: ids.size });
    expect(receipt.rows.some((row) => row.value === "/search")).toBe(true);
    expect(seedsReceipt(report.inputs.seeds, [])).toBeNull();
  });
});
