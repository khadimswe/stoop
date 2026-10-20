import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANDIDATES } from "../demo/candidates";
import { FixtureCache, loadFixtures } from "../qloo/fixtures";
import { cacheKey } from "../qloo/params";
import { controlText, loadRuns, resolveRecipe, scoringRequests, segmentRequests, toneTag, type Recipe } from "./plan";
import { describeRecorded } from "../testing/recorded";

const recipe = (name: string) => JSON.parse(readFileSync(`fixtures/recipes/${name}.json`, "utf8")) as Recipe;

describeRecorded("Gate 2 recipes", () => {
  it("cover everything the current code plans for stage 1, so replay never misses", async () => {
    // The recorded stage 1 recipe plus its top-ups; pet hats' Control was regenerated on Oct 16
    // (a new creative direction), so its new music term was recorded in pool-refresh-2.
    const cache = new FixtureCache(loadFixtures(), { strict: true });
    const controls = CANDIDATES.map((c) => controlText(c, loadRuns(c.slug)));
    for (const request of resolveRecipe(CANDIDATES, controls).requests) {
      await expect(cache.get(cacheKey(request.endpoint, request.params), request.id)).resolves.toBeDefined();
    }
  });

  it("replay offline: every recorded request is in the fixture cache", async () => {
    const cache = new FixtureCache(loadFixtures(), { strict: true });
    for (const name of ["pool-resolve", "pool-audience", "pool-segments", "pool-scoring"]) {
      for (const request of recipe(name).requests) {
        await expect(cache.get(cacheKey(request.endpoint, request.params), request.id)).resolves.toBeDefined();
      }
    }
  });

  it("ask Qloo for every id they score", () => {
    for (const request of recipe("pool-scoring").requests) {
      const ids = (request.params["filter.results.entities"] ?? request.params["filter.results.tags"]) as string[];
      expect(request.params.take).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(50);
    }
  });
});

describe("request builders", () => {
  const seeds = ["00000000-0000-4000-8000-000000000001"];

  it("anchor place queries at the top-lift metro's strongest cell, with everyday genres", () => {
    const anchor = { "filter.location": "POINT(-105.27 40.01)", "filter.location.radius": 20_000 };
    const requests = segmentRequests("x", seeds, ["24_and_younger", "30_to_34"], anchor, ["urn:tag:genre:place:park"]);
    expect(requests).toHaveLength(5);
    expect(requests.at(-1)?.params).toMatchObject({ ...anchor, "feature.explainability": true });
  });

  it("dedupe scored ids and size take to them", () => {
    const requests = scoringRequests("x", seeds, { artist: ["A", "A", "B"], brand: ["C"], movie: ["D"], tv_show: ["E"] }, { music: ["t"], tone: ["u"] });
    expect(requests[0].params).toMatchObject({ "filter.results.entities": ["A", "B"], take: 2 });
  });

  it("build an emotional-tone tag id from a mood, since tag search does not index them", () => {
    expect(toneTag("Quiet relief").tag?.id).toBe("urn:tag:emotional_tone:qloo:quiet_relief");
  });
});
