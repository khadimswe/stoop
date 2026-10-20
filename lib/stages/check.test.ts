// The check on real recordings: the hot sauce example's 3 LLM-only runs mapped to Qloo from the
// recorded searches, and a full run in a live run's budget context (every call must name a row).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SHARED_CREATIVE } from "../agent/creative";
import { runBrief } from "../agent/orchestrator";
import { loadRuns } from "../data-check/plan";
import { buildExampleBrief, candidateMember, replayOptions } from "../demo/example-run";
import { createEmitter, reduce, toReport, type RunEvent } from "../events";
import { referenceSets } from "../geo/reference";
import { RUN_BUDGET } from "../qloo/budget";
import { createLiveRunContext, createRunContext } from "../qloo/context";
import type { Report } from "../report/schema";
import { controlMappings, mapControl } from "./check";
import type { StageEnv } from "./env";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const report = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report);
const runs = loadRuns("food-hot-sauce");
const decisions = (events: RunEvent[]) => events.flatMap((e) => (e.type === "trace.step" && e.step.kind === "decision" ? [`${e.step.label}: ${e.step.reason ?? ""}`] : []));

function stageEnv(rowCaps?: Record<string, number>): { env: StageEnv; events: RunEvent[] } {
  const { client } = replayOptions("food-hot-sauce", SHARED_CREATIVE);
  const emitter = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
  const ctx = createRunContext({ runId: "check-test", ...(rowCaps ? { rowCaps } : {}) });
  return { env: { client, ctx, emit: emitter.emit, reference: undefined as never, inReference: true }, events: emitter.events };
}

describeRecorded("mapControl", () => {
  it("leaves out a generic brief pick that resolves to one of the seeds, and says so", async () => {
    const { env, events } = stageEnv();
    const maps = await mapControl(env, runs, report.inputs.seeds);
    expect(maps.flatMap((m) => m.references.map((r) => r.text))).not.toContain("Parts Unknown");
    expect(decisions(events).some((d) => /Parts Unknown \(.+: Parts Unknown\)/.test(d) && d.includes("one of the seeds"))).toBe(true);
  });

  it("maps music through a recorded tag search and builds the mood id without a receipt", async () => {
    const { env } = stageEnv();
    const [first] = await mapControl(env, runs, report.inputs.seeds);
    const mappings = controlMappings(first);
    expect(mappings.find((m) => m.dimension === "music")).toMatchObject({ ref: { name: "Soul - Funk" } });
    expect(mappings.find((m) => m.dimension === "music")?.evidenceIds).toHaveLength(1);
    expect(mappings.find((m) => m.dimension === "mood")).toMatchObject({ ref: { id: "urn:tag:emotional_tone:qloo:warm" }, evidenceIds: [] });
  });

  it("stops at the run's resolve row and leaves the rest unverifiable instead of failing the run", async () => {
    const { env, events } = stageEnv({ ...RUN_BUDGET, resolve: 1 });
    const maps = await mapControl(env, runs, report.inputs.seeds);
    expect(maps[0].music.ref).not.toBeNull();
    expect(maps.slice(1).every((m) => m.music.ref === null || m.music.text === maps[0].music.text)).toBe(true);
    expect(decisions(events).some((d) => d.startsWith("Left") && d.includes("unchecked"))).toBe(true);
  });
});

describeRecorded("a full run in a live run's budget context", () => {
  it("names a budget row on every call, so a live run's table never refuses an untagged one", async () => {
    const options = replayOptions("food-hot-sauce", SHARED_CREATIVE);
    // Seeds are resolved at intake, before the run and its table.
    const run = await buildExampleBrief("food-hot-sauce", options.client, createRunContext({ runId: "intake" }));
    const ctx = createLiveRunContext("example-food-hot-sauce");
    const emitter = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
    const reference = referenceSets();
    await runBrief({ ...options, ctx, emitter, reference, inReference: reference.full.members.includes(candidateMember("food-hot-sauce")), now: () => 0 }, run);
    const report = toReport(reduce(emitter.events));
    expect(emitter.events.find((e) => e.type === "run.failed")).toBeUndefined();
    expect(report.worlds).toHaveLength(2);
    expect(report.comparison).not.toBeNull();
  });
});
