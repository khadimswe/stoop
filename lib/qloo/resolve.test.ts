import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveName, type Recipe } from "../data-check/plan";
import { createQlooClient } from "./client";
import { createRunContext } from "./context";
import { FixtureCache, readFixtureFile } from "./fixtures";
import { clientLookup, receiptLookup, resolveEntity, resolveEntityWithReceipt, resolveLabel, searchId, searchRequest } from "./resolve";
import { describeRecorded } from "../testing/recorded";

// Replays the real Gate 2 recordings in strict mode: a request that was never recorded throws. Only
// fixtures/pool-resolve.json is loaded (no other fixture records these searches), not every fixture.
const replayCache = () => new FixtureCache([readFixtureFile("fixtures/pool-resolve.json")], { strict: true });
const lookup = () => clientLookup(createQlooClient({ cache: replayCache() }), createRunContext({ runId: "test", cap: 0 }));
const recorded = JSON.parse(readFileSync("fixtures/recipes/pool-resolve.json", "utf8")) as Recipe;

describe("searchRequest", () => {
  it("builds exactly the recorded Gate 2 search", () => {
    const request = searchRequest("Hot Ones", "tv_show");
    const same = recorded.requests.find((r) => r.id === request.id);
    expect(request.id).toBe("search--hot-ones--tv_show");
    expect(same && { id: same.id, endpoint: same.endpoint, params: same.params }).toEqual({
      id: request.id,
      endpoint: request.endpoint,
      params: request.params,
    });
  });

  it("keys ids on the normalized name and the type", () => {
    expect(searchId("Trader Joe's", "brand")).toBe("search--trader-joes--brand");
    expect(searchId("The Bear", "tv_show")).toBe("search--bear--tv_show");
    expect(searchRequest("Tabasco", "brand").note).toBeUndefined();
    expect(searchRequest("Tabasco", "brand", "Seed.").note).toBe("Seed.");
  });
});

describeRecorded("resolveEntity", () => {
  it("accepts an exact name match", async () => {
    const resolved = await resolveEntity("Hot Ones", "tv_show", lookup());
    expect(resolved).toMatchObject({ query: "Hot Ones", type: "tv_show", request: "search--hot-ones--tv_show" });
    expect(resolved.entity).toMatchObject({ name: "Hot Ones", match: "exact" });
    expect(resolved.entity?.id).toMatch(/^[0-9A-F-]{36}$/);
  });

  it("accepts a top hit that ends with the whole multi-word query", async () => {
    const resolved = await resolveEntity("Parts Unknown", "tv_show", lookup());
    expect(resolved.entity).toMatchObject({ name: expect.stringMatching(/.+: Parts Unknown$/), match: "affix" });
  });

  it("drops a best guess whose name does not match", async () => {
    // Qloo's best guess for "The Ordinary" (brand) is a company with another name.
    expect((await resolveEntity("The Ordinary", "brand", lookup())).entity).toBeUndefined();
    // And "Chemex" (brand) with no results at all.
    expect((await resolveEntity("Chemex", "brand", lookup())).entity).toBeUndefined();
  });

  it("returns the search's receipt, labeled for the trace and recorded in the ledger", async () => {
    const ctx = createRunContext({ runId: "test", cap: 0 });
    const lookup = receiptLookup(createQlooClient({ cache: replayCache() }), ctx, { stage: "intake" });
    const resolved = await resolveEntityWithReceipt("Hot Ones", "tv_show", lookup);
    expect(resolved.entity).toMatchObject({ name: "Hot Ones", match: "exact" });
    expect(resolved.evidence).toMatchObject({
      endpoint: "/search",
      params: { query: "Hot Ones", types: "urn:entity:tv_show", take: "5" },
      label: "Resolving Hot Ones to a TV show",
      stage: "intake",
      cached: true,
    });
    expect(resolved.evidence.id).toMatch(/^ev_[0-9a-f]{12}$/);
    expect(ctx.ledger.entries.map((entry) => entry.id)).toEqual([resolved.evidence.id]);
    expect(resolveLabel("Tabasco", "brand")).toBe("Resolving Tabasco to a brand");
    expect(resolveLabel("Nujabes", "artist")).toBe("Resolving Nujabes to an artist");
  });

  it("is what the data check's resolveName returns", async () => {
    for (const [name, type] of [["Tabasco", "brand"], ["The Ordinary", "brand"]] as const) {
      expect(await resolveName(name, type, lookup())).toEqual(await resolveEntity(name, type, lookup()));
    }
  });
});
