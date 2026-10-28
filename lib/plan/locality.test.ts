// The fixes from the Oct 28 proof lab: city names checked against the store's state, chains found by
// repetition, broad styles kept, music from the block's places judged before it is offered, and the
// comparison naming exactly what Qloo decided. Every id and name here is made up.
import { describe, expect, it } from "vitest";
import { PLAN_BUDGET, PLAN_CAP } from "../qloo/budget";
import { createQlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import type { QlooEntity, QlooTag } from "../qloo/types";
import { namedPlaces, qlooDecided } from "./baseline";
import { judgeBlockMusic, signalPlaces } from "./block-music";
import type { PlanEnv } from "./env";
import type { PlanEvent } from "./events";
import { readCity } from "./local";
import { cityQueries, inState, localityMiss, nearestMajorCity, signalLocality, stateOf } from "./locality";
import type { Block, CityTaste, Concept, PlanInputs } from "./schema";
import { musicStyles, repeatedPlaceNames } from "./taste";

const ID = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"] as const;

describe("which place Qloo reads as the city", () => {
  it("knows states by abbreviation or name", () => {
    expect(stateOf("GA")).toEqual({ abbr: "GA", name: "Georgia" });
    expect(stateOf("georgia")).toEqual({ abbr: "GA", name: "Georgia" });
    expect(stateOf("Nowhere")).toBeNull();
  });
  it("tries the bare name, then the region, then the state's name", () => {
    expect(cityQueries("Jonesboro", "GA")).toEqual(["Jonesboro", "Jonesboro, GA", "Jonesboro, Georgia"]);
    expect(cityQueries("Springfield", "Atlantis")).toEqual(["Springfield"]);
  });
  it("reads Qloo's echo and checks it against the state", () => {
    const body = { query: { localities: { signal: { name: "Jonesboro", disambiguation: "Jonesboro, Craighead County, Arkansas, United States", location: { lat: 35.82, lon: -90.68 } } } } };
    const locality = signalLocality(body)!;
    expect(locality.point).toEqual({ lat: 35.82, lon: -90.68 });
    expect(inState(locality, "Georgia")).toBe(false);
    expect(inState(locality, "Arkansas")).toBe(true);
    expect(signalLocality({ results: {} })).toBeNull();
  });
  it("finds the nearest major city in the state", () => {
    expect(nearestMajorCity("GA", { lat: 33.58, lon: -84.37 })?.name).toBe("Atlanta");
    expect(nearestMajorCity("TX", { lat: 29.6, lon: -98.6 })?.name).toBe("San Antonio");
    expect(nearestMajorCity("ZZ", { lat: 0, lon: 0 })).toBeNull();
  });

  /** A client whose artists answer says it read each query in the state this map gives. */
  function envFor(states: Record<string, string>, extra: { points?: Record<string, { lat: number; lon: number }>; empty?: string[] } = {}) {
    const asked: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const query = u.searchParams.get("signal.location.query") ?? "";
      asked.push(`${u.searchParams.get("filter.type")}:${query}`);
      const state = states[query];
      const body =
        u.searchParams.get("filter.type") === "urn:tag"
          ? { results: { tags: [] } }
          : {
              results: { entities: extra.empty?.includes(query) ? [] : [{ entity_id: ID[0], name: "Zevrin", subtype: "urn:entity:artist" }] },
              ...(state ? { query: { localities: { signal: { name: query.split(",")[0], disambiguation: `${query.split(",")[0]}, Some County, ${state}, United States`, ...(extra.points?.[query] ? { location: extra.points[query] } : {}) } } } } : {}),
            };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const client = createQlooClient({ apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, sleep: async () => {} });
    const ctx = createRunContext({ runId: "plan_test", cap: PLAN_CAP, rowCaps: PLAN_BUDGET });
    const events: PlanEvent[] = [];
    const env: PlanEnv = { client, ctx, model: {} as PlanEnv["model"], sink: { emit: (e) => (events.push(e as PlanEvent), e as PlanEvent) } };
    return { env, ctx, asked, events };
  }
  const inputs = { store: { city: "Jonesboro", region: "GA", point: { lat: 33.58, lon: -84.37 } }, ageBands: ["25_to_29"] } as unknown as PlanInputs;

  it("keeps a bare name that resolves in the store's state, for one call", async () => {
    const { env, asked } = envFor({ Jonesboro: "Georgia" });
    const read = await readCity(env, inputs);
    expect(read.query).toBe("Jonesboro");
    expect(asked.filter((a) => a.startsWith("urn:entity:artist"))).toEqual(["urn:entity:artist:Jonesboro"]);
  });

  it("retries with the region when Qloo reads the name in another state", async () => {
    const { env, asked, ctx } = envFor({ Jonesboro: "Arkansas", "Jonesboro, GA": "Georgia" });
    const read = await readCity(env, inputs);
    expect(read.query).toBe("Jonesboro, GA");
    expect(asked).toContain("urn:tag:Jonesboro, GA");
    expect(ctx.rowCalls).toMatchObject({ planCity: 2, planLocate: 1 });
  });

  it("treats a same-name place far from the store, or an empty answer, as the wrong city", async () => {
    const far = { lat: 26.4, lon: -98.98 };
    const { env, events } = envFor({ Jonesboro: "Georgia", "Jonesboro, GA": "Georgia", "Jonesboro, Georgia": "Georgia", "Atlanta, GA": "Georgia" }, { points: { Jonesboro: far }, empty: ["Jonesboro, GA", "Jonesboro, Georgia"] });
    const read = await readCity(env, inputs);
    expect(read.query).toBe("Atlanta, GA");
    const gaps = events.flatMap((e) => (e.type === "local.gap" ? [e.text] : [])).join(" ");
    expect(gaps).toMatch(/km from the store/);
    expect(gaps).toMatch(/with no artists/);
    expect(localityMiss({ name: "Near", disambiguation: "Near, Georgia, United States", point: { lat: 33.6, lon: -84.4 } }, 20, inputs.store, "Georgia")).toBeNull();
  });

  it("falls back to the nearest major city in the state, and says so", async () => {
    const { env, events } = envFor({ Jonesboro: "Arkansas", "Jonesboro, GA": "Maryland", "Jonesboro, Georgia": "Maryland", "Atlanta, GA": "Georgia" });
    const read = await readCity(env, inputs);
    expect(read.query).toBe("Atlanta, GA");
    const gaps = events.filter((e) => e.type === "local.gap").map((e) => (e.type === "local.gap" ? e.text : ""));
    expect(gaps.join(" ")).toMatch(/did not read Jonesboro as this store's city .*so the city's taste is read from Atlanta/);
  });
});

const tag = (id: string, name: string): QlooTag => ({ id, name, type: "urn:tag:genre:music", popularity: null, affinity: null });
const entity = (id: string, over: Partial<QlooEntity> = {}): QlooEntity => ({ id, name: `Artist ${id.slice(-1)}`, type: "urn:entity:artist", popularity: null, affinity: null, disambiguation: null, location: null, tags: [], explainability: null, properties: null, ...over });

describe("styles and chains", () => {
  it("saves room for a broad style even when the artists' genres would fill the list", () => {
    const artists = Array.from({ length: 6 }, (_, i) => entity(`00000000-0000-4000-8000-00000000050${i}`, { properties: { primary_genres: ["Hip Hop", "Rap", "Trap", "Soul", "R&B", "Pop", "Funk"] }, tags: ["Hip Hop", "Rap", "Trap", "Soul", "R&B", "Pop", "Funk"].map((g) => ({ id: `urn:tag:genre:qloo:${g.toLowerCase().replace(/\W+/g, "_")}`, name: g, type: "urn:tag:genre:qloo", popularity: null, affinity: null })) }));
    const { styles } = musicStyles({ city: "Kennesaw", cityTags: [tag("urn:tag:genre:music:contemporary_country", "contemporary country")], cityTagsEvidenceId: "ev_00000000000c", artistEntities: artists, artistsEvidenceId: "ev_00000000000a" });
    expect(styles).toHaveLength(6);
    expect(styles.map((s) => s.name)).toContain("contemporary country");
  });
  it("keeps a broad style the city's list carries even when its top artists do not play it", () => {
    const { styles } = musicStyles({ city: "Kennesaw", cityTags: [tag("urn:tag:genre:music:country_pop", "country pop"), tag("urn:tag:genre:music:kawaii", "kawaii")], cityTagsEvidenceId: "ev_00000000000c", artistEntities: [], artistsEvidenceId: "ev_00000000000a" });
    expect(styles.map((s) => s.name)).toEqual(["country pop"]);
    expect(styles[0]?.evidenceIds).toEqual(["ev_00000000000c"]);
  });
  it("treats a name on more than one store's block as a chain", () => {
    const repeated = repeatedPlaceNames([{ places: [{ name: "Quillon Wings" }, { name: "Zevrin Tacos" }] }, { places: [{ name: "Quillon Wings" }] }]);
    expect([...repeated]).toEqual(["quillon wings"]);
  });
});

describe("music from the block", () => {
  const city = { artists: [{ id: ID[0], genres: [] }], styles: [] } as unknown as CityTaste;
  const fresh = (n: number, year = 2016) => Array.from({ length: n }, (_, i) => entity(`00000000-0000-4000-8000-00000000010${i}`, { properties: { start_year: year } }));
  it("is offered when current and new to the city's list", () => {
    expect(judgeBlockMusic(fresh(8), city)).toMatchObject({ used: true });
  });
  it("is offered when it brings a sound the city's list lacks", () => {
    const cityWithSound = { artists: [{ id: ID[0], genres: ["Hip Hop"] }], styles: [{ name: "Hip Hop" }, { name: "Trap" }] } as unknown as CityTaste;
    const other = Array.from({ length: 6 }, (_, i) => entity(`00000000-0000-4000-8000-00000000020${i}`, { properties: { start_year: 2001, primary_genres: ["Regional Mexican"] } }));
    expect(judgeBlockMusic(other, cityWithSound)).toMatchObject({ used: true, reason: expect.stringMatching(/sound the city's list lacks \(Regional Mexican\)/) });
    const same = Array.from({ length: 6 }, (_, i) => entity(`00000000-0000-4000-8000-00000000030${i}`, { properties: { start_year: 2001, primary_genres: ["Southern Hip Hop"] } }));
    expect(judgeBlockMusic(same, cityWithSound)).toMatchObject({ used: false, reason: expect.stringMatching(/category profile/) });
  });
  it("is left out when it leans on identity-type labels", () => {
    const labeled = Array.from({ length: 6 }, (_, i) => entity(`00000000-0000-4000-8000-00000000040${i}`, { properties: { start_year: 2012 }, tags: [{ id: "urn:tag:style:qloo:christian_hip_hop", name: "Christian Hip Hop", type: "urn:tag:style:qloo", popularity: null, affinity: null }] }));
    expect(judgeBlockMusic(labeled, city)).toMatchObject({ used: false, reason: expect.stringMatching(/identity-type labels/) });
  });
  it("is left out when dated, repeated or thin", () => {
    expect(judgeBlockMusic(fresh(8, 1990), city)).toMatchObject({ used: false, reason: expect.stringMatching(/dated/) });
    expect(judgeBlockMusic([entity(ID[0]), entity(ID[0]), entity(ID[0])], city)).toMatchObject({ used: false, reason: expect.stringMatching(/repeats/) });
    expect(judgeBlockMusic(fresh(2), city)).toMatchObject({ used: false });
  });
  it("signals with the block's top independents, never chains or parks", () => {
    const block = { radiusM: 1500, places: [{ id: "c", chain: true, kind: "food" }, { id: "p", kind: "park" }, { id: "a", kind: "food" }, { id: "b", kind: "venue" }] } as unknown as Block;
    expect(signalPlaces(block)).toEqual(["a", "b"]);
  });
});

describe("what Qloo decided", () => {
  const place = (id: string, kind: "food" | "venue", chain = false) => ({ id, name: `Place ${id.slice(-1)}`, kind, tags: [], address: null, distanceM: 200, why: null, rank: 1, affinity: null, popularity: null, chain, evidenceIds: ["ev_00000000000b"] });
  const block: Block = { radiusM: 1500, places: [place(ID[1], "food"), place(ID[2], "food", true)] };
  it("names each part from the plan's origins and refs, and what is lost without Qloo", () => {
    const kept = {
      items: [
        { kind: "music", text: `Lead with [[${ID[0]}]]`, origin: "interpreted", refs: [ID[0]], evidenceIds: ["ev_00000000000a"] },
        { kind: "setup", text: "A table.", origin: "creative", refs: [], evidenceIds: [] },
      ],
    } as Concept;
    const plan = {
      shopping: [{ item: "A dozen pastries", qty: "1 dozen at $18", estUsd: 18, from: ID[1], origin: "interpreted" as const, evidenceIds: [] }],
      wheel: { rules: ["r"], slices: [{ label: "$10 card", kind: "gift_card" as const, text: "t", origin: "qloo" as const, refs: [ID[1]], evidenceIds: ["e"] }, { label: "$10 card", kind: "gift_card" as const, text: "t", origin: "qloo" as const, refs: [ID[2]], evidenceIds: ["e"] }] },
    };
    const { decided, without } = qlooDecided(kept, plan, block);
    expect(decided).toEqual(["the playlist", "the two gift cards", "the snack spot"]);
    expect(without).toEqual(["no local music", "no block spots"]);
    expect(qlooDecided({ items: [kept.items[1]!] } as Concept, null, block)).toEqual({ decided: [], without: [] });
  });
  it("counts the generic plan's named places that are chains or on the block", () => {
    expect(namedPlaces(["Place 2", "costco", "Somewhere Else"], block)).toEqual({ named: 3, chains: 1, onBlock: 1 });
  });
});
