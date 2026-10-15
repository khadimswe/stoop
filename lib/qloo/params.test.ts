import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./constants";
import { cacheKey, canonicalQuery, paramsRecord } from "./params";

describe("canonical params", () => {
  it("sorts keys, joins arrays, and stringifies scalars", () => {
    expect(
      canonicalQuery({
        take: 10,
        "filter.type": "urn:entity:artist",
        "signal.interests.entities": ["A", "B"],
        "feature.explainability": true,
        skipped: undefined,
      }),
    ).toBe("feature.explainability=true&filter.type=urn%3Aentity%3Aartist&signal.interests.entities=A%2CB&take=10");
  });

  it("encodes spaces in WKT as %20", () => {
    expect(canonicalQuery({ "filter.location": "POINT(-84.39 33.75)" })).toBe("filter.location=POINT(-84.39%2033.75)");
  });

  it("gives the same cache key for the same params in any order", () => {
    const a = cacheKey(ENDPOINTS.insights, { take: 5, "filter.type": "urn:tag" });
    const b = cacheKey(ENDPOINTS.insights, { "filter.type": "urn:tag", take: 5 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives different cache keys for different endpoints or values", () => {
    const base = cacheKey(ENDPOINTS.insights, { "filter.type": "urn:tag" });
    expect(cacheKey(ENDPOINTS.tags, { "filter.type": "urn:tag" })).not.toBe(base);
    expect(cacheKey(ENDPOINTS.insights, { "filter.type": "urn:heatmap" })).not.toBe(base);
  });

  it("produces a plain string record for evidence", () => {
    expect(paramsRecord({ take: 3, "signal.interests.entities": ["A", "B"] })).toEqual({
      "signal.interests.entities": "A,B",
      take: "3",
    });
  });
});
