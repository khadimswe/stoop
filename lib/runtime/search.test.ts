import { describe, expect, it } from "vitest";
import { createQlooClient } from "../qloo/client";
import { FixtureCache, readFixtureFile } from "../qloo/fixtures";
import { MemoryStore } from "../store/memory";
import type { VisitorId } from "../store/visitor";
import { saveIntake } from "./record";
import { SEARCHES_PER_INTAKE, searchSeeds } from "./search";
import { startRun } from "./start";

// Qloo answers replay the real seed searches (fixtures/pool-resolve.json).
const client = () => createQlooClient({ cache: new FixtureCache([readFixtureFile("fixtures/pool-resolve.json")], { strict: true }) });
const intakeId = `in_${"2".repeat(24)}`;
const LIVE = { STOOP_LIVE: "true" };
const ctx = (store: MemoryStore) => ({ store, visitor: "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId, source: "web" as const });

async function withIntake() {
  const store = new MemoryStore();
  await saveIntake(store, {
    intakeId,
    createdAt: "2026-10-17T12:00:00.000Z",
    product: { slug: "hot-sauce", name: "small-batch hot sauce", brandName: null, oneLine: "A fermented hot sauce.", source: { kind: "description", lookDescription: "A small glass bottle of red hot sauce." } },
    region: "United States",
    statedCustomer: null,
    site: null,
    stated: null,
    seeds: [],
    evidence: [],
  });
  return store;
}

describe("searching for a seed", () => {
  it("returns Qloo's own entities as 'you' seeds with a receipt, which the run then accepts", async () => {
    const store = await withIntake();
    const found = await searchSeeds({ client: client(), env: LIVE }, { intakeId, q: "Hot Ones", type: "tv_show" }, ctx(store));
    expect(found.results[0]).toMatchObject({ ref: { name: "Hot Ones", type: "urn:entity:tv_show" }, origin: "you", evidenceIds: [found.evidence[0].id] });
    const tabasco = await searchSeeds({ client: client(), env: LIVE }, { intakeId, q: "Tabasco", type: "brand" }, ctx(store));
    const reply = await startRun(
      { env: LIVE, schedule: () => undefined, execute: async () => undefined },
      { intakeId, seedIds: [found.results[0].ref.id, tabasco.results[0].ref.id], statedCustomer: null, region: "United States" },
      ctx(store),
    );
    expect(reply.mode).toBe("live");
  });

  it("caps searches per intake, and needs a live intake", async () => {
    const store = await withIntake();
    for (let i = 0; i < SEARCHES_PER_INTAKE; i++) await searchSeeds({ client: client(), env: LIVE }, { intakeId, q: "Hot Ones", type: "tv_show" }, ctx(store));
    await expect(searchSeeds({ client: client(), env: LIVE }, { intakeId, q: "Hot Ones", type: "tv_show" }, ctx(store))).rejects.toMatchObject({ code: "rate_limited" });
    await expect(searchSeeds({ client: client(), env: LIVE }, { intakeId: `in_${"3".repeat(24)}`, q: "Hot Ones", type: "tv_show" }, ctx(store))).rejects.toMatchObject({ code: "not_found" });
    await expect(searchSeeds({ client: client(), env: {} }, { intakeId, q: "Hot Ones", type: "tv_show" }, ctx(store))).rejects.toMatchObject({ code: "off" });
  });
});
