import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { intakeResponseSchema } from "../api/responses";
import type { PageRead } from "../intake/page";
import { createQlooClient } from "../qloo/client";
import { FixtureCache, readFixtureFile } from "../qloo/fixtures";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import type { VisitorId } from "../store/visitor";
import { ApiFailure } from "./errors";
import { INTAKES_PER_HOUR, productFrom, runIntake, slugOf } from "./intake";
import { loadIntake } from "./record";
import { describeRecorded } from "../testing/recorded";

// Qloo answers replay real recordings (the seed searches and the "hot sauce" tag search); Claude is the AI SDK mock.
const client = () => createQlooClient({ cache: new FixtureCache(["pool-resolve", "probe-search"].map((name) => readFixtureFile(`fixtures/${name}.json`)), { strict: true }) });
const reply = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: { inputTokens: { total: 800, noCache: 800, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 300, text: 300, reasoning: undefined } },
  warnings: [],
});
const seedsModel = () => new MockLanguageModelV4({ doGenerate: reply({ suggestions: [{ name: "Hot Ones", type: "tv_show" }, { name: "Tabasco", type: "brand" }, { name: "Chemex", type: "brand" }], categoryTerms: ["hot sauce"], instructionLikeText: false }) });
const LIVE = { STOOP_LIVE: "true" };
const description = "A smoky, bright hot sauce made in small batches with fermented red chiles.";
const ctx = (store: MemoryStore) => ({ store, visitor: "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId, source: "web" as const });

const page = (product: Partial<NonNullable<PageRead["product"]>> | null, extra: Partial<PageRead> = {}): PageRead => ({
  url: "https://porchlight.example/products/red",
  source: product ? "shopify" : null,
  product: product ? { name: "Red Fermented Hot Sauce", tags: [], images: [], ...product } : null,
  copy: "",
  flags: [],
  fetches: [],
  ...extra,
});

describeRecorded("the product from an intake", () => {
  it("takes the page's facts first, with the price as a seller fact, and the founder's brand name over the page's", () => {
    const spec = productFrom({ brandName: "Porchlight Pepper Co." }, page({ brand: "Porchlight", price: "14.00", currency: "USD", description }));
    expect(spec).toMatchObject({ name: "Red Fermented Hot Sauce", brandName: "Porchlight Pepper Co.", oneLine: description, source: { kind: "description" } });
    expect(spec.sellerFacts).toBe(`${description} Price: 14.00 USD.`);
  });

  it("makes a valid slug from any name, even one cut at a word break", () => {
    expect(slugOf("Reflective, packable rain jackets for small dogs, with a fleece lining")).toBe("reflective-packable-rain-jackets-for-small-dogs");
    expect(slugOf("!!!")).toBe("product");
    expect(productFrom({ description: "Reflective, packable rain jackets for small dogs, with a fleece lining and a leash opening." }, null).slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("falls back to the founder's description when the page could not be read", () => {
    const spec = productFrom({ description }, page(null, { blocked: { reason: "The site blocked the read." } }));
    expect(spec.name).toBe(description);
    expect(spec.sellerFacts).toBe(description);
    expect(spec.brandName).toBeNull();
  });
});

describeRecorded("an intake", () => {
  it("is off while STOOP_LIVE is off, and limited per visitor per hour", async () => {
    const store = new MemoryStore();
    await expect(runIntake({ client: client(), model: seedsModel(), env: {} }, { description }, ctx(store))).rejects.toMatchObject({ code: "off" });
    for (let i = 0; i < INTAKES_PER_HOUR; i++) await store.incr(keys.rate("intake", ctx(store).visitor, new Date().toISOString().slice(0, 13)));
    await expect(runIntake({ client: client(), model: seedsModel(), env: LIVE }, { description }, ctx(store))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("stops before any work once today's Qloo calls are spent", async () => {
    const store = new MemoryStore();
    await store.incr(keys.daily("qloo"), { by: 500 });
    await expect(runIntake({ client: client(), model: seedsModel(), env: LIVE }, { description }, ctx(store))).rejects.toBeInstanceOf(ApiFailure);
  });

  it("proposes seeds Qloo resolved, with receipts, and stores the intake for /start", async () => {
    const store = new MemoryStore();
    const response = await runIntake({ client: client(), model: seedsModel(), env: LIVE, randomHex: () => "ab".repeat(12) }, { description }, ctx(store));
    expect(intakeResponseSchema.parse(response)).toEqual(response);
    expect(response.intakeId).toBe(`in_${"ab".repeat(12)}`);
    expect(response.site).toBeNull();
    expect(response.seeds.map((s) => [s.ref.name, s.origin])).toEqual(expect.arrayContaining([["Hot Ones", "suggested"], ["Tabasco", "suggested"]]));
    expect(response.seeds.some((s) => s.ref.name === "Chemex")).toBe(false);
    const cited = new Set(response.seeds.flatMap((s) => s.evidenceIds));
    for (const id of cited) expect(response.evidence.map((e) => e.id)).toContain(id);
    const stored = await loadIntake(store, response.intakeId);
    expect(stored?.seeds).toEqual(response.seeds);
    expect(stored?.product.sellerFacts).toBe(description);
  });

  it("asks for a description when the page could not be read and none was given", async () => {
    const store = new MemoryStore();
    const read = async () => page(null, { blocked: { reason: "The site blocked the read." } });
    await expect(runIntake({ client: client(), model: seedsModel(), env: LIVE, read }, { url: "https://porchlight.example/products/red" }, ctx(store))).rejects.toMatchObject({ code: "invalid" });
  });
});
