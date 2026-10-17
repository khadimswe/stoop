// A recorded example run as a live run: the executor, the store-backed emitter, memoized Claude steps,
// the Control landing after Prove and the cost, all on the real pipeline. Qloo answers come from the
// recorded fixtures and Claude's from the recorded answers, with the network switched off. Then a run
// stopped at a short deadline resumes and finishes without asking Claude any step twice.
import { readFileSync } from "node:fs";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaselineRun } from "../agent/baseline";
import { SHARED_CREATIVE } from "../agent/creative";
import { stepKey } from "../agent/llm-replay";
import { buildExampleBrief, candidateMember, replayOptions } from "../demo/example-run";
import { reduce } from "../events";
import { referenceSets } from "../geo/reference";
import { OFFLINE_CAP } from "../qloo/budget";
import { createRunContext } from "../qloo/context";
import type { Report } from "../report/schema";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { getRunMeta, loadReport, readRunEvents, runLease, setRunMeta } from "../store/runs";
import type { CookieVisitorId, VisitorId } from "../store/visitor";
import { FrameRenderError, renderWorldFrames } from "../media/frames";
import { PAUSED_REASON, storyboardCounter } from "../media/storyboards";
import type { Storage } from "../storage";
import { claudeUsd } from "./cost";
import { executeRun, estimateUsd, type ExecuteDeps } from "./execute";
import { saveRunRecord } from "./record";
import { resumeRun } from "./start";

const slug = "food-hot-sauce";
const stored = JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const runId = `run_${"a".repeat(24)}`;

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("A replay tried to reach the network.");
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/**
 * Counts what reaches the recorded model. With `hangAfter`, steps after that many wait for the abort
 * signal, like a slow real call cut off by the deadline.
 */
function counted(model: LanguageModel, modelId: string, asked: string[], hangAfter = Infinity): LanguageModel & { modelId: string } {
  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        if (asked.length >= hangAfter) {
          await new Promise<void>((resolve) => (params.abortSignal?.aborted ? resolve() : params.abortSignal?.addEventListener("abort", () => resolve(), { once: true })));
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        }
        asked.push(stepKey(modelId, params));
        return doGenerate();
      },
    },
  });
  return Object.assign(wrapped, { modelId });
}

async function liveRun(store: MemoryStore) {
  const options = replayOptions(slug, SHARED_CREATIVE);
  const brief = await buildExampleBrief(slug, options.client, createRunContext({ runId: `example-${slug}`, cap: OFFLINE_CAP }));
  await saveRunRecord(store, runId, { inputs: brief.inputs, stated: brief.stated, site: brief.site, seedEvidence: [...brief.seedEvidence], settings: brief.settings });
  const at = "2026-10-17T12:00:00.000Z";
  await setRunMeta(store, { runId, attempt: 1, status: "running", briefHash: "b".repeat(64), createdAt: at, updatedAt: at });
  await store.leaseAcquire(keys.liveLeases, runLease(runId, 1), { max: 2, ttlMs: 320_000 });
  const control = brief.control as readonly BaselineRun[];
  const reference = referenceSets();
  const deps = (model: LanguageModel & { modelId: string }, extra: Partial<ExecuteDeps> = {}): ExecuteDeps => ({
    store,
    client: options.client,
    model,
    reference,
    creative: SHARED_CREATIVE,
    now: () => 0,
    control: async () => control,
    inReference: reference.full.members.includes(candidateMember(slug)),
    ...extra,
  });
  return { options, deps };
}

describe("a live run", () => {
  it("runs the real pipeline into the store and ends with the same worlds as the recorded example", async () => {
    const store = new MemoryStore();
    const { options, deps } = await liveRun(store);
    const asked: string[] = [];
    await executeRun(deps(counted(options.model, options.modelId, asked)), runId);

    const meta = await getRunMeta(store, runId);
    expect(meta?.status).toBe("done");
    expect(await store.leaseCount(keys.liveLeases)).toBe(0);
    const report = (await loadReport(store, runId))!;
    expect(report.meta).toMatchObject({ id: runId, kind: "live", provenance: "live" });
    expect(report.audience).toEqual(stored.audience);
    expect(report.worlds).toEqual(stored.worlds);
    expect(report.control).toEqual(stored.control);
    expect(report.comparison).toEqual(stored.comparison);
    // The Reality Check came first without the generic line, then again once the Control landed.
    const events = await readRunEvents(store, runId, 1);
    expect(events.filter((e) => e.type === "audience.gap")).toHaveLength(2);
    expect(report.trace.some((t) => t.label === "Added what the generic AI brief assumed to the Reality Check")).toBe(true);
    expect(reduce(events).attempt).toBe(1);
    // All Qloo answers were recorded; every Claude step was asked once and counted.
    expect(report.cost?.qloo.live).toBe(0);
    expect(report.cost?.claude.calls).toBe(asked.length);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("stops at the deadline, resumable, and a resume finishes without asking Claude any step again", async () => {
    const store = new MemoryStore();
    const { options, deps } = await liveRun(store);
    const asked: string[] = [];
    await executeRun(deps(counted(options.model, options.modelId, asked, 3), { deadlineMs: 3_000 }), runId);
    expect((await getRunMeta(store, runId))?.status).toBe("stopped");
    expect(await store.leaseCount(keys.liveLeases)).toBe(0);
    expect(asked).toHaveLength(3);

    let resumed: Promise<void> = Promise.resolve();
    const ctx = { store, visitor: "v_000000000000000000000000" as VisitorId, source: "web" as const };
    const reply = await resumeRun(
      { env: { STOOP_LIVE: "true" }, schedule: (task) => void (resumed = task()), execute: (id) => executeRun(deps(counted(options.model, options.modelId, asked)), id) },
      runId,
      ctx,
    );
    expect(reply).toMatchObject({ mode: "live", runId, joined: false });
    await resumed;
    const meta = await getRunMeta(store, runId);
    expect(meta).toMatchObject({ attempt: 2, status: "done" });
    expect(new Set(asked).size).toBe(asked.length);
    const report = (await loadReport(store, runId))!;
    expect(report.worlds).toEqual(stored.worlds);
    // Attempt 2 streamed the whole run again from seq 0.
    expect((await readRunEvents(store, runId, 2))[0]).toMatchObject({ seq: 0, type: "run.started", attempt: 2 });
  });

  it("estimates the cost from list prices, cached input at a tenth", () => {
    expect(estimateUsd({ inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 })).toBe(3);
    expect(estimateUsd({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 100_000 })).toBe(1.8);
  });
});

describe("a live run that cannot finish", () => {
  it("stops at the deadline even while the Control never answers, and frees its slot", async () => {
    const store = new MemoryStore();
    const { options, deps } = await liveRun(store);
    const started = Date.now();
    await executeRun(deps(counted(options.model, options.modelId, []), { deadlineMs: 400, control: () => new Promise(() => undefined) }), runId);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect((await getRunMeta(store, runId))?.status).toBe("stopped");
    expect(await store.leaseCount(keys.liveLeases)).toBe(0);
  });

  it("stops spending when the store stops taking its events, ends failed and frees its slot", async () => {
    const memory = new MemoryStore();
    const { options, deps } = await liveRun(memory);
    const store = Object.assign(Object.create(memory), {
      append: async () => {
        throw new Error("store write failed");
      },
    }) as MemoryStore;
    // Claude answers three steps, then each step waits as a slow call would, until the run is stopped.
    const asked: string[] = [];
    await executeRun({ ...deps(counted(options.model, options.modelId, asked, 3)), store }, runId);
    expect((await getRunMeta(memory, runId))?.status).toBe("failed");
    expect(await memory.leaseCount(keys.liveLeases)).toBe(0);
    expect(asked).toHaveLength(3);
  });
});

const noCost = { durationMs: 0, qloo: { live: 0, cached: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0 };

describe("frames during a live run", () => {
  it("starts each world's frames as its pack lands, and folds their cost into the run's", async () => {
    const store = new MemoryStore();
    const { options, deps } = await liveRun(store);
    const jobs: { segmentId: string; hasPack: boolean; names: number }[] = [];
    const frameCost = { durationMs: 5_000, qloo: { live: 0, cached: 0 }, claude: { calls: 2, inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 0 }, frames: 4, estimateUsd: 0.32 };
    const asked: string[] = [];
    await executeRun(
      {
        ...deps(counted(options.model, options.modelId, asked)),
        frames: async (job) => {
          jobs.push({ segmentId: job.segmentId, hasPack: job.world.pack !== null, names: job.names?.length ?? 0 });
          return { status: "done", frames: null, cost: frameCost };
        },
      },
      runId,
    );
    expect(jobs.map((j) => j.segmentId).sort()).toEqual(stored.worlds.map((w) => w.segmentId).sort());
    expect(jobs.every((j) => j.hasPack && j.names > 0)).toBe(true);
    const cost = (await loadReport(store, runId))!.cost!;
    expect(cost.frames).toBe(8);
    expect(cost.claude.calls).toBe(asked.length + 4);
    // The run's own Claude calls, plus each job's frames at their price and its critique at Claude's list prices.
    const critique = claudeUsd(frameCost.claude);
    expect(cost.estimateUsd).toBeGreaterThan(2 * (0.32 + critique));
    expect((await getRunMeta(store, runId))?.status).toBe("done");
  });

  it("hands each job the visitor who started the run, and none for a run started before starters were kept", async () => {
    const ip = "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId;
    const cookie = "c_bbbbbbbbbbbbbbbbbbbbbbbb" as CookieVisitorId;
    for (const [meta, expected] of [
      [{ visitor: ip, cookieVisitor: cookie }, { ip, cookie }],
      [{ visitor: ip, cookieVisitor: null }, { ip, cookie: null }],
      [{}, null],
    ] as const) {
      const store = new MemoryStore();
      const { options, deps } = await liveRun(store);
      await setRunMeta(store, { ...(await getRunMeta(store, runId))!, ...meta });
      const seen: unknown[] = [];
      await executeRun({ ...deps(counted(options.model, options.modelId, [])), frames: async (job) => (seen.push(job.visitor), { status: "done", frames: null, cost: noCost }) }, runId);
      expect(seen).toEqual(stored.worlds.map(() => expected));
    }
  });

  describe("counted against the day of the visitor who started the run", () => {
    const ip = "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId;
    const cookie = "c_bbbbbbbbbbbbbbbbbbbbbbbb" as CookieVisitorId;
    // The frames here render at time 0, so their storyboards count on 1970-01-01.
    const day = "1970-01-01";
    const IMAGE_URLS = { "image/*": [/^https:\/\/.*$/] };
    const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 120, text: 120, reasoning: undefined } };
    // Claude's review, passing every frame.
    const critic = () =>
      new MockLanguageModelV4({
        supportedUrls: IMAGE_URLS,
        doGenerate: async (options) => {
          const shots = [...JSON.stringify(options.prompt).matchAll(/Shot (\d+) \(/g)].map((m) => Number(m[1]));
          return { content: [{ type: "text" as const, text: JSON.stringify({ frames: shots.map((shot) => ({ shot, issues: [], rewrite: null })) }) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
        },
      });
    const storage: Storage = {
      kind: "blob",
      put: async (path) => ({ path, url: `https://frames.test/${path}` }),
      url: async (path) => `https://frames.test/${path}`,
      delete: async () => undefined,
    };

    /** The real frames job, with a fake fal that counts what it renders per world. */
    function realFrames(store: MemoryStore, rendered: string[], limits = { perCookieDaily: 6, perIpDaily: 15 }): NonNullable<ExecuteDeps["frames"]> {
      return (job, _model, signal) =>
        renderWorldFrames(
          {
            store,
            storage,
            renderer: { render: async () => (rendered.push(job.segmentId), { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }) },
            model: critic(),
            framesCap: 200,
            storyboardLimits: limits,
            now: () => new Date(0),
            abortSignal: signal,
          },
          job,
        );
    }

    async function startedBy(store: MemoryStore, cookieVisitor: CookieVisitorId | null) {
      const run = await liveRun(store);
      await setRunMeta(store, { ...(await getRunMeta(store, runId))!, visitor: ip, cookieVisitor });
      return run;
    }

    it("renders the worlds the starter's day still covers and pauses the rest with the global cap's message", async () => {
      expect(stored.worlds.length).toBeGreaterThan(1);
      const store = new MemoryStore();
      const { options, deps } = await startedBy(store, cookie);
      const rendered: string[] = [];
      await executeRun({ ...deps(counted(options.model, options.modelId, [])), frames: realFrames(store, rendered, { perCookieDaily: 1, perIpDaily: 15 }) }, runId);
      expect(new Set(rendered).size).toBe(1);
      const report = (await loadReport(store, runId))!;
      const byStatus = (status: string) => report.worlds.filter((w) => w.frames?.status === status);
      expect(byStatus("done").map((w) => w.segmentId)).toEqual([...new Set(rendered)]);
      expect(byStatus("paused")).toHaveLength(stored.worlds.length - 1);
      expect(byStatus("paused").every((w) => w.frames?.reason === PAUSED_REASON)).toBe(true);
      expect(report.trace.some((t) => t.reason?.startsWith("Today's storyboards for this visitor are used up"))).toBe(true);
      expect(await store.get(storyboardCounter(cookie, day))).toBe(1);
      expect(await store.get(storyboardCounter(ip, day))).toBe(1);
      // The paused worlds took nothing from the global frame cap.
      expect(await store.get(keys.daily("frames", day))).toBe(report.cost!.frames);
    });

    it("needs no room in the day for frames from the cache: a resumed attempt at the limit renders them all for free", async () => {
      const store = new MemoryStore();
      const { options, deps } = await startedBy(store, null);
      const rendered: string[] = [];
      await executeRun({ ...deps(counted(options.model, options.modelId, [])), frames: realFrames(store, rendered) }, runId);
      expect(await store.get(storyboardCounter(ip, day))).toBe(stored.worlds.length);
      const firstRenders = rendered.length;
      // The starter's day is now spent; the run resumes as attempt 2 and streams again from seq 0.
      await store.incr(storyboardCounter(ip, day), { by: 15 - stored.worlds.length });
      await setRunMeta(store, { ...(await getRunMeta(store, runId))!, attempt: 2, status: "running" });
      await store.leaseAcquire(keys.liveLeases, runLease(runId, 2), { max: 2, ttlMs: 320_000 });
      await executeRun({ ...deps(counted(options.model, options.modelId, [])), frames: realFrames(store, rendered) }, runId);
      expect(rendered).toHaveLength(firstRenders);
      const report = (await loadReport(store, runId))!;
      expect(report.worlds.every((w) => w.frames?.status === "done")).toBe(true);
      expect(await store.get(storyboardCounter(ip, day))).toBe(15);
    });

    it("gives the place back when a job renders nothing fresh", async () => {
      const store = new MemoryStore();
      const { options, deps } = await startedBy(store, cookie);
      // fal refuses every frame (not billed): the jobs fail, and the day keeps none of them.
      const failing: NonNullable<ExecuteDeps["frames"]> = (job, _model, signal) =>
        renderWorldFrames(
          {
            store,
            storage,
            renderer: { render: async () => Promise.reject(new FrameRenderError("fal could not render the frame (HTTP 422): ValidationError.")) },
            model: critic(),
            framesCap: 200,
            now: () => new Date(0),
            abortSignal: signal,
          },
          job,
        );
      await executeRun({ ...deps(counted(options.model, options.modelId, [])), frames: failing }, runId);
      const report = (await loadReport(store, runId))!;
      expect(report.worlds.every((w) => w.frames?.status === "failed")).toBe(true);
      expect(await store.get(storyboardCounter(cookie, day))).toBe(0);
      expect(await store.get(storyboardCounter(ip, day))).toBe(0);
    });
  });
});

describe("frames that outlast the run", () => {
  it("are stopped by the run's deadline, and the run still ends with its cost and report", async () => {
    const store = new MemoryStore();
    const { options, deps } = await liveRun(store);
    let aborted = 0;
    const started = Date.now();
    await executeRun(
      {
        ...deps(counted(options.model, options.modelId, []), { deadlineMs: 3_000 }),
        // A frames job that only ends when it is stopped, like a slow render.
        frames: (_job, _model, signal) =>
          new Promise((resolve) =>
            signal.addEventListener("abort", () => {
              aborted++;
              resolve({ status: "failed", frames: null, cost: { durationMs: 0, qloo: { live: 0, cached: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0 } });
            }),
          ),
      },
      runId,
    );
    expect(aborted).toBe(stored.worlds.length);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect((await getRunMeta(store, runId))?.status).toBe("done");
    expect((await loadReport(store, runId))?.cost).not.toBeNull();
    expect(await store.leaseCount(keys.liveLeases)).toBe(0);
  });
});
