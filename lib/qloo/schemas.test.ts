import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./constants";
import { QlooParamError } from "./errors";
import type { QlooParams } from "./params";
import { toWktPoint, validateParams } from "./schemas";

const ID = "AFBD8046-1234-4ABC-9DEF-0123456789AB";
const TAG = "urn:tag:genre:music:jazz";

function errorFor(endpoint: (typeof ENDPOINTS)[keyof typeof ENDPOINTS], params: QlooParams): string {
  try {
    validateParams(endpoint, params);
  } catch (error) {
    expect(error).toBeInstanceOf(QlooParamError);
    return (error as Error).message;
  }
  throw new Error("expected validation to fail");
}

describe("insights params", () => {
  it.each([
    ["artist", { "filter.type": "urn:entity:artist", "signal.interests.entities": [ID], take: 25 }],
    ["brand with tags", { "filter.type": "urn:entity:brand", "signal.interests.tags": [TAG], "filter.popularity.max": 0.9 }],
    ["movie with era", { "filter.type": "urn:entity:movie", "signal.interests.entities": [ID], "filter.release_year.min": 1990 }],
    ["tv_show by age", { "filter.type": "urn:entity:tv_show", "signal.demographics.age": ["25_to_29", "30_to_34"] }],
    ["person scored list", { "filter.type": "urn:entity:person", "signal.interests.entities": [ID], "filter.results.entities": [ID] }],
    ["podcast re-ranked by location", { "filter.type": "urn:entity:podcast", "signal.interests.entities": [ID], "signal.location.query": "Atlanta" }],
    [
      "place near a point",
      {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": [ID],
        "filter.location": "POINT(-84.39 33.75)",
        "filter.location.radius": 5000,
        "feature.explainability": true,
      },
    ],
    ["tags diversified", { "filter.type": "urn:tag", "signal.interests.entities": [ID], "diversify.by": "subtype", take: 30 }],
    ["demographics", { "filter.type": "urn:demographics", "signal.interests.entities": [ID, ID] }],
    ["heatmap", { "filter.type": "urn:heatmap", "signal.interests.entities": [ID], "filter.location.query": "United States" }],
  ] as const)("accepts %s", (_label, params) => {
    expect(() => validateParams(ENDPOINTS.insights, params)).not.toThrow();
  });

  it("rejects unknown params", () => {
    expect(
      errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:artist", "signal.interests.entities": [ID], "filter.colour": "red" }),
    ).toContain('unknown param "filter.colour"');
  });

  it("explains params Qloo silently ignores", () => {
    const message = errorFor(ENDPOINTS.insights, {
      "filter.type": "urn:entity:brand",
      "signal.interests.entities": [ID],
      "filter.location": "POINT(-73.99 40.73)",
    });
    expect(message).toContain("silently ignored");
    expect(message).toContain("signal.location");
  });

  it("explains filter.release_country on movies", () => {
    expect(
      errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:movie", "signal.interests.entities": [ID], "filter.release_country": "US" }),
    ).toContain("silently ignored for movie");
  });

  it("rejects video_game and points to videogame", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:video_game", "signal.interests.entities": [ID] })).toContain(
      "urn:entity:videogame",
    );
  });

  it("rejects more than one filter.type per call", () => {
    expect(
      errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:artist,urn:entity:brand", "signal.interests.entities": [ID] }),
    ).toContain("one type per call");
  });

  it("rejects prototype keys as filter.type with a param error", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "constructor", "signal.interests.entities": [ID] })).toContain(
      "filter.type must be one of",
    );
  });

  it("does not blame heatmaps for take on demographics", () => {
    const message = errorFor(ENDPOINTS.insights, { "filter.type": "urn:demographics", "signal.interests.entities": [ID], take: 5 });
    expect(message).toContain('unknown param "take"');
    expect(message).not.toContain("heatmaps");
  });

  it("rejects take above 50", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:artist", "signal.interests.entities": [ID], take: 51 })).toMatch(
      /take/,
    );
  });

  it("rejects ids that are not Qloo entity ids", () => {
    expect(
      errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:artist", "signal.interests.entities": ["Olipop"] }),
    ).toContain("Qloo entity id");
  });

  it("requires at least one signal", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:artist", take: 10 })).toContain("at least one signal");
  });

  it("rejects take on heatmaps, where Qloo ignores it", () => {
    expect(
      errorFor(ENDPOINTS.insights, {
        "filter.type": "urn:heatmap",
        "signal.interests.entities": [ID],
        "filter.location.query": "New York",
        take: 10,
      }),
    ).toContain("take is ignored for heatmaps");
  });

  it("requires a location on otherwise valid heatmaps", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "urn:heatmap", "signal.interests.entities": [ID] })).toContain(
      "heatmaps need filter.location",
    );
  });

  it("rejects heatmap boundaries other than geohash", () => {
    expect(
      errorFor(ENDPOINTS.insights, {
        "filter.type": "urn:heatmap",
        "signal.interests.entities": [ID],
        "filter.location.query": "New York",
        "output.heatmap.boundary": "urn:entity:locality",
      }),
    ).toContain("output.heatmap.boundary");
  });

  it("requires a location on otherwise valid place queries", () => {
    expect(errorFor(ENDPOINTS.insights, { "filter.type": "urn:entity:place", "signal.interests.entities": [ID] })).toContain(
      "place queries need filter.location",
    );
  });

  it("catches a POINT written as lat lon", () => {
    expect(
      errorFor(ENDPOINTS.insights, {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": [ID],
        "filter.location": "POINT(37.77 -122.41)",
      }),
    ).toContain("POINT(lon lat)");
  });
});

describe("toWktPoint", () => {
  it("writes longitude first", () => {
    expect(toWktPoint({ lat: 33.75, lon: -84.39 })).toBe("POINT(-84.39 33.75)");
  });
});

describe("search, tags and compare params", () => {
  it("accepts search with types", () => {
    expect(() => validateParams(ENDPOINTS.search, { query: "Olipop", types: ["urn:entity:brand"], take: 5 })).not.toThrow();
  });

  it("requires types on search", () => {
    expect(errorFor(ENDPOINTS.search, { query: "Aesop" })).toMatch(/types/);
  });

  it("accepts a tags lookup", () => {
    expect(() =>
      validateParams(ENDPOINTS.tags, { "filter.query": "hot sauce", "filter.parents.types": ["urn:entity:place"] }),
    ).not.toThrow();
  });

  it("accepts compare between two seed sets", () => {
    expect(() =>
      validateParams(ENDPOINTS.compare, { "a.signal.interests.entities": [ID], "b.signal.interests.entities": [ID] }),
    ).not.toThrow();
  });

  it("requires both sides of a compare", () => {
    expect(errorFor(ENDPOINTS.compare, { "a.signal.interests.entities": [ID] })).toMatch(/b\.signal\.interests\.entities/);
  });
});

describe("scoring calls ask for every id", () => {
  const ids = Array.from({ length: 21 }, (_, i) => `AFBD8046-1234-4ABC-9DEF-${String(i).padStart(12, "0")}`);
  const tags = Array.from({ length: 21 }, (_, i) => `urn:tag:genre:music:g${i}`);

  it("rejects filter.results.entities with more ids than take (Qloo's default of 20 cuts silently)", () => {
    const base = { "filter.type": "urn:entity:artist", "signal.interests.entities": [ID], "filter.results.entities": ids };
    expect(errorFor(ENDPOINTS.insights, base)).toMatch(/take \(20\) must be at least the number of filter.results.entities \(21\)/);
    expect(errorFor(ENDPOINTS.insights, { ...base, take: 10 })).toMatch(/take \(10\)/);
    expect(() => validateParams(ENDPOINTS.insights, { ...base, take: 21 })).not.toThrow();
  });

  it("applies the same rule to places and to filter.results.tags", () => {
    const place = { "filter.type": "urn:entity:place", "signal.interests.entities": [ID], "filter.location.query": "Atlanta", "filter.results.entities": ids };
    expect(errorFor(ENDPOINTS.insights, place)).toMatch(/must be at least/);
    const tag = { "filter.type": "urn:tag", "signal.interests.entities": [ID], "filter.results.tags": tags };
    expect(errorFor(ENDPOINTS.insights, tag)).toMatch(/filter.results.tags \(21\)/);
    expect(() => validateParams(ENDPOINTS.insights, { ...tag, take: 21 })).not.toThrow();
  });
});
