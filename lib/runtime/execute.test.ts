// A recorded example run as a live run: the executor, the store-backed emitter, memoized Claude steps,
// the Control landing after Prove and the cost, all on the real pipeline. Qloo answers come from the
// recorded fixtures and Claude's from the recorded answers, with the network switched off. Then a run
// stopped at a short deadline resumes and finishes without asking Claude any step twice.
import { readFileSync } from "node:fs";
import { wrapLanguageModel, type LanguageModel } from "ai";
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
import { getRunMeta, loadReport, readRunEvents, setRunMeta } from "../store/runs";
import type { VisitorId } from "../store/visitor";
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
  await store.leaseAcquire(keys.liveLeases, runId, { max: 2, ttlMs: 320_000 });
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
