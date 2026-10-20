// Response schemas against our own recorded responses (Gate 2, Oct 16, 2026). No Qloo data is
// written by hand here: every body comes from fixtures/, recorded with `npm run fixtures:record`.
import { expect, it } from "vitest";
import { findFixture, readFixtureFile, recorded, type Fixture } from "./fixtures";
import {
  compareResponse,
  demographicsResponse,
  heatmapResponse,
  insightsEntitiesResponse,
  insightsTagsResponse,
  searchResponse,
  slimEntitiesBody,
  slimHeatmapBody,
  tagsResponse,
} from "./types";
import { describeRecorded, ifRecorded } from "../testing/recorded";

function fixture(name: string): Fixture {
  const file = findFixture(name);
  if (!file) throw new Error(`fixture ${name} is missing`);
  return readFixtureFile(file);
}

const search = ifRecorded(() => fixture("probe-search"));
const insights = ifRecorded(() => fixture("probe-insights"));
const scoring = ifRecorded(() => fixture("probe-scoring"));
const extra = ifRecorded(() => fixture("probe-extra"));
const body = (f: Fixture, id: string) => recorded(f, id).body;
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

describeRecorded("response schemas against recorded fixtures", () => {
  it("/search keeps entity ids, types and popularity, with the exact match first", () => {
    const results = searchResponse.parse(body(fixture("smoke"), "search-olipop-brand"));
    expect(results[0]).toMatchObject({ name: "Olipop", type: "urn:entity:brand" });
    expect(results[0].id).toMatch(UUID);
    expect(results[0].popularity).toBeGreaterThan(0);
    // Filler follows the real match: other artists come back for "Tyler, the Creator".
    const tyler = searchResponse.parse(body(search, "search-artist-tyler"));
    expect(tyler[0].name).toBe("Tyler, the Creator");
    expect(tyler.slice(1).length).toBeGreaterThan(0);
    expect(tyler.slice(1).every((e) => e.name !== "Tyler, the Creator")).toBe(true);
  });

  it("/search across several types returns each result's own type", () => {
    const results = searchResponse.parse(body(search, "search-multi-hot-ones"));
    expect(results[0]).toMatchObject({ name: "Hot Ones", type: "urn:entity:tv_show" });
  });

  it("/v2/tags normalizes id", () => {
    const tags = tagsResponse.parse(body(search, "tags-hot-sauce"));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag.id).toMatch(/^urn:tag:/);
  });

  it("urn:entity:* parse with subtype as the real type", () => {
    for (const [id, type] of [
      ["artist-take50", "urn:entity:artist"],
      ["brand-take50", "urn:entity:brand"],
      ["movie-take50", "urn:entity:movie"],
      ["tv-take50", "urn:entity:tv_show"],
      ["person-take20", "urn:entity:person"],
      ["podcast-take20", "urn:entity:podcast"],
    ] as const) {
      const entities = insightsEntitiesResponse.parse(body(insights, id));
      expect(entities.length).toBeGreaterThan(0);
      for (const e of entities) {
        expect(e.type).toBe(type);
        expect(e.affinity).toBeGreaterThan(0);
      }
    }
  });

  it("sends 20 results when no take is given", () => {
    expect(insightsEntitiesResponse.parse(body(insights, "artist-default-take"))).toHaveLength(20);
    expect(insightsEntitiesResponse.parse(body(insights, "artist-take50"))).toHaveLength(50);
  });

  it("places carry location and explainability per input signal", () => {
    const places = insightsEntitiesResponse.parse(body(insights, "place-la-explain"));
    expect(places[0].location?.geohash).toBeTruthy();
    const explain = places[0].explainability?.["signal.interests.entities"] ?? [];
    expect(explain.length).toBe(3);
    for (const item of explain) expect(item.entityId).toMatch(UUID);
  });

  it("urn:tag normalizes tag_id and reads the type from subtype", () => {
    const tags = insightsTagsResponse.parse(body(scoring, "tags-parent-artist"));
    expect(tags.length).toBe(30);
    for (const tag of tags) {
      expect(tag.id).toMatch(/^urn:tag:/);
      expect(tag.affinity).not.toBeNull();
    }
    expect(tags.some((t) => t.type === "urn:tag:genre:music")).toBe(true);
  });

  it("urn:demographics gives one row of skew indices per input entity", () => {
    const rows = demographicsResponse.parse(body(insights, "demographics"));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row.age).sort()).toEqual(["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]);
      for (const value of [...Object.values(row.age), ...Object.values(row.gender)]) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("urn:heatmap parses every cell, and slimming is lossless for the fields Stoop reads", () => {
    const raw = body(insights, "heatmap-us");
    const cells = heatmapResponse.parse(raw);
    expect(cells.length).toBe(10463);
    expect(new Set(cells.map((c) => c.geohash.length))).toEqual(new Set([4]));
    expect(heatmapResponse.parse(slimHeatmapBody(raw))).toEqual(cells);
  });

  it("/v2/analysis/compare parses shared, a and b tags", () => {
    const result = compareResponse.parse(body(insights, "compare-carhartt-olipop"));
    expect(result.a.length).toBeGreaterThan(0);
    // Recorded behavior, and why Stoop's Reality Check does not use compare: side b came back empty
    // and nothing was shared, although Olipop carries 114 tags in /search (fixtures/smoke.json).
    expect(result.b).toEqual([]);
    expect(result.shared).toEqual([]);
  });
});

describeRecorded("filter.results.entities (one-call panel scoring)", () => {
  const scored = insightsEntitiesResponse.parse(body(scoring, "results-artists-apparel"));
  const open = new Map(insightsEntitiesResponse.parse(body(insights, "artist-take50")).map((e) => [e.id, e.affinity]));

  it("returns only the requested ids of the requested type", () => {
    const asked = recorded(scoring, "results-artists-apparel").params["filter.results.entities"].split(",");
    for (const e of scored) expect(asked).toContain(e.id);
    // A podcast id, a TV id and the signal's own seed were asked for and are left out.
    expect(scored).toHaveLength(7);
    expect(scored.map((e) => e.name)).not.toContain("Tyler, the Creator");
  });

  it("gives the same score as the open list for the same signal", () => {
    const overlap = scored.filter((e) => open.has(e.id));
    expect(overlap.length).toBe(4);
    for (const e of overlap) expect(e.affinity).toBeCloseTo(open.get(e.id) as number, 10);
  });

  it("scores move when the signal changes", () => {
    const other = new Map(insightsEntitiesResponse.parse(body(scoring, "results-artists-olipop")).map((e) => [e.id, e.affinity]));
    const moved = scored.filter((e) => e.affinity !== null && other.has(e.id) && e.affinity > (other.get(e.id) ?? 1) + 0.1);
    expect(moved.length).toBeGreaterThan(0);
  });
});

describeRecorded("filter.results.tags (undocumented, used for tag scoring)", () => {
  it("returns only the requested tags, each with an affinity", () => {
    const tags = insightsTagsResponse.parse(body(extra, "tags-results-tags"));
    const asked = recorded(extra, "tags-results-tags").params["filter.results.tags"].split(",");
    expect(tags.map((t) => t.id).sort()).toEqual([...asked].sort());
    for (const tag of tags) expect(tag.affinity).not.toBeNull();
  });
});

describeRecorded("slimEntitiesBody", () => {
  const raw = body(insights, "brand-take50");
  const slim = slimEntitiesBody(raw) as { results: { entities: { properties: Record<string, unknown>; tags: { type: string }[] }[] } };

  it("keeps what the schemas read", () => {
    expect(insightsEntitiesResponse.parse(slim).map((e) => [e.id, e.name, e.affinity])).toEqual(
      insightsEntitiesResponse.parse(raw).map((e) => [e.id, e.name, e.affinity]),
    );
  });

  it("never keeps demographic or identity text", () => {
    for (const e of slim.results.entities) {
      for (const key of ["audience_identity", "target_demographics_description", "customer_demographics_description"]) {
        expect(e.properties).not.toHaveProperty(key);
      }
    }
  });

  it("is idempotent, so a re-slim never changes a committed fixture", () => {
    expect(slimEntitiesBody(slim)).toEqual(slim);
  });
});
