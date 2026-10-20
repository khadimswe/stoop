// Culture's helpers on real recordings: the Gate 4 probe (fixtures/culture-probe.json, hot sauce's 55
// and older world in Slidell) and the recorded hot sauce run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { referenceSets } from "../geo/reference";
import { readFixtureFile } from "../qloo/fixtures";
import { insightsEntitiesResponse } from "../qloo/types";
import type { Report } from "../report/schema";
import { fitLine } from "./check";
import { CHILD_RATINGS, chooseSettingCities, entityCandidates, placeCandidates, pickSettingCity } from "./culture";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const probe = ifRecorded(() => readFixtureFile("fixtures/culture-probe.json"));
const body = (id: string) => insightsEntitiesResponse.parse(probe.requests.find((r) => r.id === id)!.body);
const report = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report);
const seedNames = ifRecorded(() => new Map(report.inputs.seeds.map((s) => [s.ref.id, s.ref.name])));

describeRecorded("placeCandidates", () => {
  const places = body("food-hot-sauce--seg-55_and_older--places");

  it("drops every name Qloo returns more than once (chains), and keeps the local places", () => {
    const { kept, chains } = placeCandidates(places, "ev_000000000001", seedNames);
    const counts = new Map<string, number>();
    for (const p of places) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    // This recorded answer repeats at least two chains; every repeated name is dropped, the rest kept.
    expect(chains.length).toBeGreaterThanOrEqual(2);
    for (const name of chains) expect(counts.get(name)).toBeGreaterThan(1);
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.every((p) => counts.get(p.name) === 1 && !chains.includes(p.name))).toBe(true);
    expect(kept.map((p) => p.rank)).toEqual(kept.map((_, i) => i + 1));
  });

  it("says why Qloo picked a place by the seeds that drove it most", () => {
    const { kept } = placeCandidates(places, "ev_000000000001", seedNames);
    expect(kept[0].why).toEqual([expect.stringMatching(/^Fans of .+ and .+$/)]);
    for (const name of kept[0].why[0].replace("Fans of ", "").split(" and ")) expect([...seedNames.values()]).toContain(name);
    expect(kept[0].details.length).toBeGreaterThan(0);
  });
});

describeRecorded("entityCandidates", () => {
  it("keeps the top 10 films with Qloo's own descriptors for craft", () => {
    const films = entityCandidates(body("food-hot-sauce--seg-55_and_older--movie"), "visual", "ev_000000000001");
    expect(films).toHaveLength(10);
    expect(films[0]).toMatchObject({ field: "visual", rank: 1, position: null, evidenceIds: ["ev_000000000001"] });
    expect(films.some((f) => f.details.length > 0)).toBe(true);
  });

  it("never uses a title rated for children as a visual reference", () => {
    // A recorded film, relabeled with a children's rating, to show the filter.
    const [first, ...rest] = body("food-hot-sauce--seg-55_and_older--movie");
    const relabeled = { ...first, properties: { ...first.properties, content_rating: "G" } };
    expect(entityCandidates([relabeled, ...rest], "visual", "ev_000000000001").map((f) => f.id)).not.toContain(first.id);
    expect(CHILD_RATINGS.has("TV-Y7")).toBe(true);
  });
});

describeRecorded("setting cities", () => {
  const proof = report.audience.proof!;

  it("chooses from the audience's stable headline cities, never the same one twice", () => {
    const cells = readFixtureFile("fixtures/audience-segments.json.gz").requests.filter((r) => r.id.startsWith("food-hot-sauce"));
    expect(cells.length).toBeGreaterThan(0);
    const reference = referenceSets();
    const worlds = cells.map((r, i) => ({ segmentId: `seg-${i}`, cells: (r.body as { results: { heatmap: never[] } }).results.heatmap }));
    const chosen = [...chooseSettingCities(proof, worlds, reference).values()].map((c) => c?.label);
    const headline = proof.cityRanks.filter((c) => c.flags.length === 0 && c.rank <= 5).map((c) => c.label);
    for (const city of chosen) expect(headline).toContain(city);
    expect(new Set(chosen).size).toBe(chosen.length);
  });

  it("returns no city when every stable city is taken", () => {
    const used = new Set(proof.cityRanks.map((c) => c.label));
    expect(pickSettingCity(proof, [], referenceSets(), { used })).toBeNull();
  });
});

describe("fitLine", () => {
  it("reads as a count, with what could not be checked in brackets", () => {
    expect(fitLine(3, 6, 2, 4)).toBe("3 of 6 checkable LLM-only choices miss what Qloo measured for this world (2 with no measurable affinity, 4 unverifiable)");
    expect(fitLine(1, 1, 0, 0)).toBe("1 of 1 checkable LLM-only choice misses what Qloo measured for this world");
  });
});
