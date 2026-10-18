import { describe, expect, it, vi } from "vitest";
import { CONTROL_SEGMENT } from "../api/requests";
import { draftUsd, VIDEO_MODELS } from "../prompts/models.config";
import { buildRenderPlan, canPlan, demoBaseUrl, multiShotJob, PHOTO_ENCODING, RenderError, renderSource, type PlanDeps } from "./plan";
import { renderPlanSchema } from "./schema";
import { approvedFor, BRAND_PHOTO, exampleFor, exampleReport, LIVE_RUN_ID, liveReport, SLUGS, targetsOf } from "./testing";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const deps = (over: Partial<PlanDeps> = {}): PlanDeps => ({
  now: NOW,
  draftSeconds: 15,
  demoBase: "https://stoop.example",
  photoUrl: async (url) => `https://refs.private.blob.vercel-storage.com/refs/photos/x.webp?from=${encodeURIComponent(url)}&vercel-blob-signature=sig`,
  ...over,
});

describe("render plans for the examples", () => {
  for (const slug of SLUGS) {
    it(`plan every world and the Control of ${slug} from the approved storyboard and packshot`, async () => {
      const report = exampleReport(slug);
      const demo = exampleFor(report);
      for (const target of targetsOf(report)) {
        const source = renderSource(report, target, demo);
        expect(source.report).toBe("example");
        const plan = await buildRenderPlan(source, deps());
        expect(renderPlanSchema.parse(plan)).toEqual(plan);
        expect(plan.endpoint).toBe(VIDEO_MODELS.reference.endpoint);
        expect(plan.imageUrls).toEqual([`https://stoop.example/demo/${slug}/packshot.webp`, ...[0, 1, 2, 3].map((s) => `https://stoop.example/demo/${slug}/frames/${target.segment}-${s}.webp`)]);
        expect(plan.prompt.length).toBeLessThanOrEqual(6_000);
        expect(plan.prompt.startsWith("REFERENCES\n@Image1: the ")).toBe(true);
        // Only fal's own handles remain, and only for images it is sent.
        expect(plan.prompt).not.toMatch(/@(?!Image\d)/);
        expect(plan.prompt).not.toMatch(/\.(png|jpe?g|webp)\b/);
        const handles = new Set([...plan.prompt.matchAll(/@Image(\d+)/g)].map((m) => Number(m[1])));
        expect(Math.max(...handles)).toBeLessThanOrEqual(plan.imageUrls.length);
        expect(plan).toMatchObject({ durationSeconds: 15, resolution: "480p", draft: true, aspectRatio: "9:16", generateAudio: true, estimatedUsd: draftUsd(VIDEO_MODELS.reference, 15) });
        expect(plan.expiresAt).toBe(new Date(NOW + 3_600_000).toISOString());
      }
    });
  }

  it("renders the kept concept's Seedance multi-shot prompt, never a per-scene one", () => {
    const report = exampleReport("food-hot-sauce");
    const source = renderSource(report, targetsOf(report)[0], exampleFor(report));
    expect(source.job.kind).toBe("multi-shot");
    expect(source.job).toBe(multiShotJob(source.pack));
    expect(source.job.prompt).toContain("GLOBAL STYLE");
  });

  it("hashes the inputs: the same plan twice is one cache key; another length or reference is another", async () => {
    const report = exampleReport("home-candles");
    const target = targetsOf(report)[0];
    const demo = exampleFor(report);
    const first = await buildRenderPlan(renderSource(report, target, demo), deps());
    // The hash is of what fal renders, not of when the URLs were signed.
    expect((await buildRenderPlan(renderSource(report, target, demo), deps({ now: NOW + 600_000 }))).inputHash).toBe(first.inputHash);
    expect((await buildRenderPlan(renderSource(report, target, demo), deps({ draftSeconds: 4 }))).inputHash).not.toBe(first.inputHash);
    const changed = exampleFor(report);
    changed.demo.storyboards[target.segment].frames[0].sha256 = "f".repeat(64);
    expect((await buildRenderPlan(renderSource(report, target, changed), deps())).inputHash).not.toBe(first.inputHash);
    expect((await buildRenderPlan(renderSource(report, target, demo), deps({ draftSeconds: 4 }))).estimatedUsd).toBe(draftUsd(VIDEO_MODELS.reference, 4));
  });

  it("plans from the storyboard alone when no packshot is approved, and refuses while nothing is", async () => {
    const report = exampleReport("pets-outfits");
    const target = targetsOf(report)[0];
    const plan = await buildRenderPlan(renderSource(report, target, exampleFor(report, { packshot: false })), deps());
    expect(plan.imageUrls).toHaveLength(4);
    expect(plan.prompt).toContain("@Image1 to @Image4: storyboard frames for shots 1 to 4, in order.");
    expect(() => renderSource(report, target, { demo: { packshot: null, storyboards: {}, clips: [] }, approvedPrompts: approvedFor(report) })).toThrow(RenderError);
  });

  it("renders an example only from a prompt the founder approved", () => {
    const report = exampleReport("food-hot-sauce");
    const target = targetsOf(report)[0];
    const media = exampleFor(report);
    expect(() => renderSource(report, target, { ...media, approvedPrompts: new Set() })).toThrow(expect.objectContaining({ code: "off", message: "This example's prompt is not approved for rendering yet." }));
    expect(() => renderSource(report, target, null)).toThrow(/not approved/);
    const job = renderSource(report, target, media).job;
    expect(renderSource(report, target, { ...media, approvedPrompts: new Set([job.promptHash]) }).job).toEqual(job);
  });

  it("needs a private store for a live world's brand photo before it says it can plan", () => {
    const report = liveReport();
    const source = renderSource(report, { reportId: LIVE_RUN_ID, segment: report.worlds[0].segmentId }, null);
    expect(canPlan(source, { demoBase: null, privateStorage: false })).toBe(false);
    expect(canPlan(source, { demoBase: null, privateStorage: true })).toBe(true);
  });

  it("stays off for examples where fal cannot reach /demo (a preview deployment)", async () => {
    const report = exampleReport("food-hot-sauce");
    const source = renderSource(report, targetsOf(report)[0], exampleFor(report));
    expect(canPlan(source, { demoBase: null, privateStorage: true })).toBe(false);
    await expect(buildRenderPlan(source, deps({ demoBase: null }))).rejects.toMatchObject({ code: "off", status: 503 });
  });
});

describe("render plans for live runs", () => {
  it("use the world's storyboard (the critique's re-render where there is one) and the brand's own product photo, presigned", async () => {
    const report = liveReport();
    const photoUrl = vi.fn(deps().photoUrl);
    const world = report.worlds[0];
    const source = renderSource(report, { reportId: LIVE_RUN_ID, segment: world.segmentId }, null);
    expect(source.report).toBe("live");
    expect(source.references.map((r) => r.kind)).toEqual(["photo", "frame", "frame", "frame"]);
    const plan = await buildRenderPlan(source, deps({ photoUrl }));
    // The photo with a person in it is never used.
    expect(photoUrl).toHaveBeenCalledExactlyOnceWith(BRAND_PHOTO);
    expect(plan.imageUrls[0]).toContain("refs.private.blob.vercel-storage.com");
    expect(plan.imageUrls.slice(1)).toEqual([
      "https://store.public.blob.vercel-storage.com/frames/0-1.png",
      "https://store.public.blob.vercel-storage.com/frames/1-2.png",
      "https://store.public.blob.vercel-storage.com/frames/2-1.png",
    ]);
    expect(canPlan(source, { demoBase: null, privateStorage: true })).toBe(true);
  });

  it("hash the brand photo by its source and re-encoding, not by the hour's signed URL", async () => {
    const report = liveReport();
    const target = { reportId: LIVE_RUN_ID, segment: report.worlds[0].segmentId };
    const a = await buildRenderPlan(renderSource(report, target, null), deps({ photoUrl: async () => "https://refs.example/a?sig=1" }));
    const b = await buildRenderPlan(renderSource(report, target, null), deps({ photoUrl: async () => "https://refs.example/a?sig=2" }));
    expect(a.inputHash).toBe(b.inputHash);
    expect(PHOTO_ENCODING).toMatch(/nometa/);
  });

  it("ignore frames rendered for another revision's pack, and plan the Control from the product photo", async () => {
    const report = liveReport();
    const world = report.worlds[0];
    const source = renderSource(report, { reportId: LIVE_RUN_ID, segment: world.segmentId }, null);
    expect(source.references).toHaveLength(4);
    const stale = liveReport();
    stale.worlds[0].frames = { ...(stale.worlds[0].frames as NonNullable<typeof world.frames>), status: "rendering" };
    expect(renderSource(stale, { reportId: LIVE_RUN_ID, segment: world.segmentId }, null).references.map((r) => r.kind)).toEqual(["photo"]);
    const control = renderSource(report, { reportId: LIVE_RUN_ID, segment: CONTROL_SEGMENT }, null);
    expect(control.references.map((r) => r.kind)).toEqual(["photo"]);
    expect((await buildRenderPlan(control, deps())).imageUrls).toHaveLength(1);
  });

  it("refuse a run with neither a storyboard nor a product photo", () => {
    const report = liveReport();
    report.inputs.product = exampleReport("food-hot-sauce").inputs.product;
    expect(() => renderSource(report, { reportId: LIVE_RUN_ID, segment: CONTROL_SEGMENT }, null)).toThrow(/no storyboard or product image/);
  });
});

describe("render targets that cannot plan", () => {
  it("are refused with the API's codes", () => {
    const report = exampleReport("food-hot-sauce");
    const demo = exampleFor(report);
    expect(() => renderSource(report, { reportId: report.meta.id, segment: "seg-nope" }, demo)).toThrow(expect.objectContaining({ code: "not_found", status: 404 }));
    expect(() => renderSource(report, { reportId: "example-home-candles", segment: CONTROL_SEGMENT }, demo)).toThrow(expect.objectContaining({ code: "not_found" }));
    const noPack = exampleReport("food-hot-sauce");
    noPack.worlds[0].pack = null;
    expect(() => renderSource(noPack, targetsOf(noPack)[0], demo)).toThrow(expect.objectContaining({ code: "invalid", status: 409 }));
    const kling = exampleReport("food-hot-sauce");
    const pack = kling.worlds[0].pack!;
    pack.renders = pack.renders.filter((job) => job.kind !== "multi-shot");
    expect(() => renderSource(kling, targetsOf(kling)[0], demo)).toThrow(/multi-shot/);
  });
});

describe("the public base URL for /demo references", () => {
  it("prefers RENDER_REFS_BASE_URL, stays off on previews without it, and falls back to the app or production URL", () => {
    expect(demoBaseUrl({ RENDER_REFS_BASE_URL: "https://stoop.example/anything" })).toBe("https://stoop.example");
    expect(demoBaseUrl({ RENDER_REFS_BASE_URL: "http://stoop.example" })).toBeNull();
    expect(demoBaseUrl({ VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://stoop-git-x.vercel.app" })).toBeNull();
    expect(demoBaseUrl({ VERCEL_ENV: "preview", RENDER_REFS_BASE_URL: "https://stoop.example" })).toBe("https://stoop.example");
    expect(demoBaseUrl({ NEXT_PUBLIC_APP_URL: "https://stoop.example" })).toBe("https://stoop.example");
    expect(demoBaseUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "stoop.example" })).toBe("https://stoop.example");
    expect(demoBaseUrl({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBeNull();
    expect(demoBaseUrl({})).toBeNull();
  });
});
