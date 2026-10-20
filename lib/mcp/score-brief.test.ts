// score_brief on real recordings: without an age band or region its requests are exactly Gate 2's,
// so the recorded pool (fixtures/pool-resolve, pool-audience, pool-scoring) replays every call. The
// FixtureCache is strict, so any request that was not recorded would throw instead of going live.
import { describe, expect, it } from "vitest";
import { controlText, loadRuns } from "../data-check/plan";
import { CANDIDATES } from "../demo/candidates";
import { seedType } from "../demo/seed-types";
import { SCORE_BRIEF_BUDGET, SCORE_BRIEF_CAP } from "../qloo/budget";
import { createQlooClient, type QlooClient, type QlooRequest } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { FixtureCache } from "../qloo/fixtures";
import { scoreBrief, scoreBriefInputSchema, scoreBriefResultSchema, scoreBriefText, scoreLine, type ScoreBriefInput } from "./score-brief";
import { describeRecorded } from "../testing/recorded";

const fixtures = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
const context = () => createRunContext({ runId: "score-test", cap: SCORE_BRIEF_CAP, rowCaps: SCORE_BRIEF_BUDGET });

/** A recording client: every request reaches the fixtures, and its params are kept for the test. */
function recording(): { client: QlooClient; seen: QlooRequest<unknown>[] } {
  const seen: QlooRequest<unknown>[] = [];
  return {
    seen,
    client: {
      request: (ctx, req) => {
        seen.push(req as QlooRequest<unknown>);
        return fixtures.request(ctx, req);
      },
      raw: () => {
        throw new Error("score_brief never makes raw calls");
      },
    },
  };
}

/** A candidate's seeds and its recorded LLM-only Control choices, as an agent would send them. */
function candidateInput(slug: string, extra: Partial<ScoreBriefInput["choices"]> = {}): ScoreBriefInput {
  const candidate = CANDIDATES.find((c) => c.slug === slug);
  if (!candidate) throw new Error(`no candidate ${slug}`);
  const control = controlText(candidate, loadRuns(slug));
  const refs = (type: string) => control.references.filter((r) => r.type === type).map((r) => r.name);
  return scoreBriefInputSchema.parse({
    product: candidate.product.name,
    seeds: candidate.seeds.map((name) => ({ name, type: seedType(name) })),
    choices: { music: [control.musicTerm], mood: [control.moodTerm], brands: refs("brand"), films: refs("movie"), tv: refs("tv_show"), artists: refs("artist"), ...extra },
  });
}

describeRecorded("scoreBrief on the recorded Gate 2 pool", () => {
  it("scores music, mood and an artist against the frozen panels, with Qloo's own picks and receipts", async () => {
    const ctx = context();
    const result = scoreBriefResultSchema.parse(await scoreBrief(candidateInput("apparel-everyday"), { client: fixtures, ctx }));

    expect(result.status).toBe("scored");
    expect(result.audience.basis).toContain("Without store data, Stoop measures your product's taste neighborhood");
    expect(result.audience.seeds.every((s) => s.matched)).toBe(true);
    const byDimension = Object.fromEntries(result.choices.map((c) => [c.dimension, c]));
    expect(byDimension.music).toMatchObject({ text: "Lo-fi hip hop", status: "below", position: { beats: 1, of: 21, aboveMedian: false } });
    expect(byDimension.mood).toMatchObject({ text: "Calm", status: "below", position: { beats: 3, of: 20 } });
    expect(byDimension.artist).toMatchObject({ text: "Nujabes", status: "supported", position: { beats: 20, of: 24, aboveMedian: true } });
    expect(byDimension.artist.measured).toBe("Nujabes among artists: beats 20 of 24");
    expect(result.fit).toEqual({ checkable: 3, below: 2, missing: 0, unverifiable: 0, line: "2 of 3 checkable choices below this audience's reference median" });

    // Qloo's own picks: 3 per scored type, never with stray spaces in their names.
    expect(result.qlooPicks.filter((p) => p.dimension === "artist")).toHaveLength(3);
    expect(result.qlooPicks.every((p) => p.name === p.name.trim() && p.position !== null)).toBe(true);

    // Every receipt cited resolves, all 12 calls replayed (nothing live), inside the budget table.
    const receiptIds = new Set(result.receipts.map((r) => r.id));
    for (const id of [...result.choices, ...result.qlooPicks].flatMap((c) => c.evidenceIds)) expect(receiptIds.has(id)).toBe(true);
    expect(result.calls).toEqual({ live: 0, cached: 12, cap: SCORE_BRIEF_CAP });
    expect(result.receipts.every((r) => r.cached)).toBe(true);
  });

  it("matches a seed by affix and leaves a mood Qloo never returned unverifiable, with nothing matched", async () => {
    const result = await scoreBrief(candidateInput("food-hot-sauce"), { client: fixtures, ctx: context() });
    expect(result.audience.seeds.find((s) => s.name === "Parts Unknown")?.matched).toMatchObject({ name: expect.stringMatching(/.+: Parts Unknown$/), match: "affix" });
    const mood = result.choices.find((c) => c.dimension === "mood");
    expect(mood).toMatchObject({ status: "unverifiable", matched: null, position: null, measured: 'Qloo returned no mood tag "Warm"' });
    expect(result.fit.line).toBe("1 of 1 checkable choice below this audience's reference median (1 unverifiable)");
  });

  it("drops a seed Qloo cannot match, says so, and counts a choice Qloo returns no score for as no measurable affinity", async () => {
    const result = await scoreBrief(candidateInput("food-coffee"), { client: fixtures, ctx: context() });
    expect(result.audience.seeds.find((s) => s.name === "Chemex")?.matched).toBeNull();
    expect(result.notes.some((n) => n.includes("Chemex"))).toBe(true);
    const music = result.choices.find((c) => c.dimension === "music");
    expect(music).toMatchObject({ status: "missing", position: null });
    expect(music?.measured).toContain("no measurable affinity");
    expect(result.fit).toMatchObject({ checkable: 2, below: 0, missing: 1, line: "0 of 2 checkable choices below this audience's reference median (1 with no measurable affinity)" });
  });

  it("leaves out a choice that resolves to one of the seeds, and spends no calls scoring its type", async () => {
    const { client, seen } = recording();
    const input = candidateInput("apparel-everyday", { artists: ["Tyler, the Creator"] });
    const result = await scoreBrief(input, { client, ctx: context() });
    const artist = result.choices.find((c) => c.dimension === "artist");
    expect(artist).toMatchObject({ status: "unverifiable", matched: null });
    expect(artist?.measured).toContain("one of the seeds");
    expect(seen.some((r) => r.params["filter.type"] === "urn:entity:artist")).toBe(false);
  });

  it("stops before any audience call when fewer than 2 seeds match", async () => {
    const { client, seen } = recording();
    const input = scoreBriefInputSchema.parse({
      product: "whole bean coffee",
      seeds: [
        { name: "Chemex", type: "brand" },
        { name: "Blue Bottle Coffee", type: "brand" },
      ],
      choices: { music: ["acoustic indie folk"] },
    });
    const result = await scoreBrief(input, { client, ctx: context() });
    expect(result.status).toBe("not_enough_seeds");
    expect(result.choices).toEqual([]);
    expect(result.notes.at(-1)).toBe("Qloo matched 1 of 2 seeds; it needs at least 2 to measure an audience.");
    expect(seen.every((r) => r.endpoint === "/search")).toBe(true);
  });
});

describeRecorded("scoreBrief with an age band and a region", () => {
  it("adds the age band to every audience call and the region to artist and brand calls only", async () => {
    // These requests were never recorded: the strict fixtures refuse them, so nothing goes live and
    // the choices come back unverifiable. The test reads the params that would have been sent.
    const { client, seen } = recording();
    // Nike's brand search is recorded (another candidate's seed), so the brand calls are attempted too.
    const input = candidateInput("apparel-everyday", { brands: ["Nike"] });
    const result = await scoreBrief({ ...input, ageBucket: "25_to_29", region: "Texas" }, { client, ctx: context() });
    const insights = seen.filter((r) => r.endpoint === "/v2/insights");
    expect(new Set(insights.map((r) => r.params["filter.type"]))).toEqual(new Set(["urn:entity:artist", "urn:entity:brand", "urn:tag"]));
    for (const req of insights) {
      expect(req.params["signal.demographics.age"]).toEqual(["25_to_29"]);
      const type = String(req.params["filter.type"]);
      expect(req.params["signal.location.query"]).toBe(type === "urn:entity:artist" || type === "urn:entity:brand" ? "Texas" : undefined);
    }
    expect(result.audience.ageBand).toBe("25 to 29");
    expect(result.choices.every((c) => c.status === "unverifiable")).toBe(true);
    expect(result.notes.some((n) => n.startsWith("Qloo did not answer"))).toBe(true);
    expect(scoreBriefText(result)).toContain("ages 25 to 29, Texas (artists and brands)");
  });
});

describe("score_brief input", () => {
  const base = { product: "hot sauce", seeds: [{ name: "Hot Ones", type: "tv_show" }, { name: "Tabasco", type: "brand" }] };

  it("needs 2 to 5 typed seeds and at least one choice", () => {
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { music: ["funk"] } }).success).toBe(true);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: {} }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, seeds: base.seeds.slice(0, 1), choices: { music: ["funk"] } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, seeds: Array.from({ length: 6 }, (_, i) => ({ name: `Seed ${i}`, type: "brand" })), choices: { music: ["funk"] } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, seeds: [{ name: "Hot Ones" }, base.seeds[1]], choices: { music: ["funk"] } }).success).toBe(false);
  });

  it("caps every field, and the lookups at 8, so a request fits its budget table", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `Name ${i}`);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { brands: names(3), films: names(3), tv: names(2) } }).success).toBe(true);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { brands: names(3), films: names(3), tv: names(3) } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { brands: names(4) } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, product: "x".repeat(201), choices: { music: ["funk"] } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { music: ["x".repeat(301)] } }).success).toBe(false);
    expect(scoreBriefInputSchema.safeParse({ ...base, choices: { music: ["funk"] }, extra: true }).success).toBe(false);
    expect(SCORE_BRIEF_BUDGET.resolve).toBe(5 + 8);
  });
});

describe("scoreLine", () => {
  it("says how many checkable choices sit below the median, never a percentile", () => {
    expect(scoreLine(4, 7, 0, 2)).toBe("4 of 7 checkable choices below this audience's reference median (2 unverifiable)");
    expect(scoreLine(0, 1, 1, 0)).toBe("0 of 1 checkable choice below this audience's reference median (1 with no measurable affinity)");
  });
});
