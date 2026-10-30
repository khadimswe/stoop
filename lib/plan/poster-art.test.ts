// The poster art job against a fake renderer, in-memory storage and a MemoryStore: the render cache,
// the global frame cap, the visitor's day, refusals that give their place back, and billed failures.
import { beforeEach, describe, expect, it } from "vitest";
import { FrameRenderError } from "../media/frames";
import { storyboardCounter } from "../media/storyboards";
import { POSTER_MODEL } from "../prompts/models.config";
import type { Storage } from "../storage";
import { dayOf, keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import type { VisitorId } from "../store/visitor";
import { POSTER_REASONS, posterKeys, queuedPoster, renderPosterArt, type PosterArtEnv, type PosterRenderer } from "./poster-art";
import { buildPosterPrompt } from "./poster-prompt";
import { samplePlanReport } from "./posts-fixture";
import { posterSchema } from "./schema";

function memoryStorage(): Storage & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    kind: "blob",
    objects,
    put: async (path, _bytes, contentType) => {
      objects.set(path, contentType);
      return { path, url: `https://abc123.public.blob.vercel-storage.com/${path}` };
    },
    url: async (path) => (objects.has(path) ? `https://abc123.public.blob.vercel-storage.com/${path}` : null),
    delete: async (path) => {
      objects.delete(path);
    },
  };
}

function fakeRenderer(fail?: () => Error): PosterRenderer & { calls: { endpoint: string; input: Record<string, unknown> }[] } {
  const calls: { endpoint: string; input: Record<string, unknown> }[] = [];
  return {
    calls,
    render: async (request) => {
      calls.push(request);
      if (fail) throw fail();
      return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" };
    },
  };
}

let store: MemoryStore;
let clock: number;
beforeEach(() => {
  clock = Date.parse("2026-10-28T12:00:00.000Z");
  store = new MemoryStore({ now: () => clock });
});
const now = () => new Date(clock);
const visitor = { id: "v_000000000000000000000001" as VisitorId, cookie: null };
const report = samplePlanReport();
const env = (over: Partial<PosterArtEnv> = {}): PosterArtEnv => ({ store, storage: memoryStorage(), renderer: fakeRenderer(), framesCap: 200, now, ...over });
const framesUsed = async () => (await store.get<number>(keys.daily("frames", dayOf(clock)))) ?? 0;

describe("renderPosterArt", () => {
  it("renders once with the frozen prompt, stores it, and counts one frame", async () => {
    const renderer = fakeRenderer();
    const storage = memoryStorage();
    const outcome = await renderPosterArt(env({ renderer, storage }), report, visitor);
    const { prompt, promptHash, input } = buildPosterPrompt(report);
    expect(outcome.billed).toBe(true);
    expect(outcome.poster).toMatchObject({ status: "ready", prompt, promptHash });
    // The bare background never rides on the poster: it stays in the art cache, and pages show the route's composite.
    expect(outcome.poster.url).toBeUndefined();
    expect(await store.get(posterKeys.render(promptHash))).toEqual({ url: `https://abc123.public.blob.vercel-storage.com/posters/${promptHash}.png`, modelId: POSTER_MODEL.endpoint });
    expect(posterSchema.safeParse(outcome.poster).success).toBe(true);
    expect(renderer.calls).toEqual([{ endpoint: POSTER_MODEL.endpoint, input }]);
    expect([...storage.objects.keys()]).toEqual([`posters/${promptHash}.png`]);
    expect(await framesUsed()).toBe(1);
    expect(await store.get(storyboardCounter(visitor.id, dayOf(clock)))).toBe(1);
  });

  it("never renders the same prompt twice: the cache answers for free", async () => {
    await renderPosterArt(env(), report, visitor);
    const renderer = fakeRenderer();
    const again = await renderPosterArt(env({ renderer }), report, visitor);
    expect(again.poster.status).toBe("ready");
    expect(again.billed).toBe(false);
    expect(renderer.calls).toHaveLength(0);
    expect(await framesUsed()).toBe(1);
    expect(await store.get(posterKeys.render(buildPosterPrompt(report).promptHash))).toMatchObject({ modelId: POSTER_MODEL.endpoint });
  });

  it("keeps the plain background when no fal key or storage is set up", async () => {
    for (const over of [{ renderer: null }, { storage: null }]) {
      const outcome = await renderPosterArt(env(over), report, visitor);
      expect(outcome.poster).toMatchObject({ status: "skipped", reason: POSTER_REASONS.noService });
      expect(outcome.poster.prompt.length).toBeGreaterThan(0);
    }
    expect(await framesUsed()).toBe(0);
  });

  it("pauses when the day's frames are spent, and takes nothing from the visitor", async () => {
    const renderer = fakeRenderer();
    const outcome = await renderPosterArt(env({ renderer, framesCap: 0 }), report, visitor);
    expect(outcome.poster).toMatchObject({ status: "skipped", reason: POSTER_REASONS.paused });
    expect(renderer.calls).toHaveLength(0);
    expect((await store.get<number>(storyboardCounter(visitor.id, dayOf(clock)))) ?? 0).toBe(0);
  });

  it("pauses when the visitor's storyboards for the day are spent", async () => {
    const renderer = fakeRenderer();
    const outcome = await renderPosterArt(env({ renderer, storyboardLimits: { perCookieDaily: 0, perIpDaily: 0 } }), report, visitor);
    expect(outcome.poster).toMatchObject({ status: "skipped", reason: POSTER_REASONS.paused });
    expect(renderer.calls).toHaveLength(0);
    expect(await framesUsed()).toBe(0);
  });

  it("gives the frame and the visitor's place back when fal refused the job", async () => {
    const outcome = await renderPosterArt(env({ renderer: fakeRenderer(() => new FrameRenderError("fal could not render the art (HTTP 422).", { billed: false })) }), report, visitor);
    expect(outcome).toMatchObject({ billed: false, poster: { status: "failed", reason: POSTER_REASONS.failed } });
    expect(await framesUsed()).toBe(0);
    expect(await store.get<number>(storyboardCounter(visitor.id, dayOf(clock)))).toBe(0);
  });

  it("keeps a billed failure counted, so a broken download never turns into free renders", async () => {
    const outcome = await renderPosterArt(env({ renderer: fakeRenderer(() => new FrameRenderError("The rendered art could not be downloaded.", { billed: true })) }), report, visitor);
    expect(outcome).toMatchObject({ billed: true, poster: { status: "failed" } });
    expect(await framesUsed()).toBe(1);
  });

  it("never sends a prompt that fails the poster check", async () => {
    // A plan whose every style name matches nothing and whose kept concept names a place still renders
    // a clean prompt: names are dropped before the prompt is built.
    const plan = report.plan!;
    const named = { ...report, plan: { ...plan, concepts: plan.concepts.map((c) => (c.kept ? { ...c, hook: "Taqueria Fixture Grande all day", title: "Velvet Testline Live" } : c)) } };
    const renderer = fakeRenderer();
    const outcome = await renderPosterArt(env({ renderer }), named, visitor);
    expect(outcome.poster.status).toBe("ready");
    expect(String(renderer.calls[0]!.input.prompt)).not.toMatch(/Taqueria|Velvet/);
  });
});

describe("queuedPoster", () => {
  it("freezes the prompt and alt before anything renders", () => {
    const poster = queuedPoster(report);
    expect(poster).toMatchObject({ status: "queued", promptHash: buildPosterPrompt(report).promptHash });
    expect(poster.alt).toContain("Taco Table Saturday");
    expect(posterSchema.safeParse(poster).success).toBe(true);
  });
});
