import { describe, expect, it } from "vitest";
import { POSTER_REASONS, queuedPoster } from "./poster-art";
import { withFrontConcept } from "./poster-text";
import { composePosts, fallbackOpenings } from "./posts";
import { exportOf, marketingExportSchema, marketingMarkdown, pendingPoster } from "./posts-export";
import { samplePlanReport } from "./posts-fixture";

const EM_DASH = String.fromCharCode(0x2014);

describe("the example marketing export", () => {
  const report = samplePlanReport({ kind: "example" });
  const posts = composePosts(fallbackOpenings(report), report);
  const poster = pendingPoster(queuedPoster(report), POSTER_REASONS.pending);
  const writer = { source: "fallback" as const, modelId: null, attempts: 0, refusedFor: [] };

  it("holds the two event payloads, the poster still on the plain background until approval", () => {
    const exported = exportOf({ slug: "chicago-18th-street", generatedAt: "2026-10-28T16:00:00.000Z", writer, poster, posts });
    expect(marketingExportSchema.parse(exported).events.map((e) => e.type)).toEqual(["poster.updated", "posts.ready"]);
    expect(exported.events[0].poster).toMatchObject({ status: "skipped", reason: POSTER_REASONS.pending });
    expect(exported.events[0].poster.url).toBeUndefined();
  });

  it("writes a review file with the frozen prompt, the exact text and the offers verbatim", () => {
    const exported = exportOf({ slug: "chicago-18th-street", generatedAt: "2026-10-28T16:00:00.000Z", writer, poster, posts });
    const md = marketingMarkdown(report, exported);
    expect(md).toContain(poster.prompt);
    expect(md).toContain(poster.promptHash);
    expect(md).toContain("Poster check: passes");
    for (const offer of report.inputs.offers) expect(md).toContain(`(verbatim): ${offer.text}`);
    expect(md).toContain("Fictional store. Not affiliated with T-Mobile.");
    expect(md).not.toContain(EM_DASH);
    expect(md).not.toContain("Variant B");
  });

  it("adds variant B's prompt and posts when the plan tests a second concept", () => {
    const bReport = withFrontConcept(report, "park-picnic");
    const variantB = { conceptId: "park-picnic", poster: pendingPoster(queuedPoster(bReport), POSTER_REASONS.pending), posts: composePosts(fallbackOpenings(bReport), bReport) };
    const exported = exportOf({ slug: "chicago-18th-street", generatedAt: "2026-10-28T16:00:00.000Z", writer, poster, posts, variantB });
    const md = marketingMarkdown(report, exported);
    expect(md).toContain("## Variant B (concept `park-picnic`");
    expect(md).toContain("Title on its poster: Picnic by the Commons");
    expect(variantB.poster.promptHash).not.toBe(poster.promptHash);
  });
});
