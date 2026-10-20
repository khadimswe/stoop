import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../demo/examples";
import { reduce, type RunEvent } from "../events";
import type { Report } from "../report/schema";
import { STAGES } from "../report/stages";
import { callCounts, hasEnded, RAIL, railRows, STAGE_LABELS } from "./rail";

const events = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];
const report = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const statusOf = (rows: ReturnType<typeof railRows>) => Object.fromEntries(rows.map((r) => [r.stage, r.status]));
const running = { ended: false, failed: false };

describe("the progress rail", () => {
  it("covers every pipeline stage once, each with a label", () => {
    expect([...RAIL].sort()).toEqual([...STAGES].sort());
    for (const stage of RAIL) expect(STAGE_LABELS[stage]).toBeTruthy();
  });

  describe.each(EXAMPLES.map((e) => e.slug))("for the recorded %s run", (slug) => {
    const all = events(slug);
    const upTo = (match: (e: RunEvent) => boolean) => all.slice(0, all.findIndex(match) + 1);

    it("marks every stage done once the run ended", () => {
      const rows = railRows(all, { ended: true, failed: false });
      expect(rows.every((r) => r.status === "done")).toBe(true);
    });

    it("counts the same calls as the stage stats, per stage and in total", () => {
      const r = report(slug);
      const stats = [...Object.values(r.stats.stages), ...r.worlds.flatMap((w) => Object.values(w.stats)), ...Object.values(r.control?.stats ?? {})];
      const total = { live: stats.reduce((n, s) => n + s.liveCalls, 0), cached: stats.reduce((n, s) => n + s.cachedCalls, 0) };
      expect(callCounts(r.trace)).toEqual(total);
      const rows = railRows(all, { ended: true, failed: false });
      expect(rows.reduce((n, row) => n + row.calls.live + row.calls.cached, 0)).toBe(total.live + total.cached);
      expect(rows.find((row) => row.stage === "prove")!.calls).toEqual({ live: r.stats.stages.prove!.liveCalls, cached: r.stats.stages.prove!.cachedCalls });
    });

    it("moves stage by stage while the run streams, never ahead of its events", () => {
      expect(statusOf(railRows(all.slice(0, 1), running))).toEqual(Object.fromEntries(RAIL.map((s) => [s, "pending"])));
      const proving = statusOf(railRows(upTo((e) => e.type === "stage.started" && e.stage === "prove"), running));
      expect(proving).toMatchObject({ prove: "current", gap: "pending", segments: "pending" });
      const gapping = statusOf(railRows(upTo((e) => e.type === "stage.started" && e.stage === "gap"), running));
      expect(gapping).toMatchObject({ prove: "done", gap: "current", segments: "pending" });
      const worlds = statusOf(railRows(upTo((e) => e.type === "world.started"), running));
      expect(worlds).toMatchObject({ prove: "done", gap: "done", segments: "done", culture: "current", concepts: "pending", prompts: "pending" });
      // A stage turns current as soon as its steps arrive, before its own stage events.
      const firstScoreStep = all.findIndex((e) => e.type === "trace.step" && e.step.stage === "score");
      const firstScoreEvent = all.findIndex((e) => e.type === "stage.started" && e.stage === "score");
      expect(firstScoreStep).toBeLessThan(firstScoreEvent);
      expect(statusOf(railRows(all.slice(0, firstScoreStep), running)).score).toBe("pending");
      for (const n of [firstScoreStep + 1, firstScoreEvent, firstScoreEvent + 1]) expect(statusOf(railRows(all.slice(0, n), running)).score).toBe("current");
      // The last world-scoped stage still open keeps its row current until the run ends.
      const last = statusOf(railRows(all.slice(0, -1), running));
      expect(last).toMatchObject({ culture: "done", score: "done", concepts: "done", prompts: "current" });
    });

    it("marks what was still open as stopped when the run failed", () => {
      const prefix = upTo((e) => e.type === "stage.started" && e.stage === "culture" && e.segmentId !== undefined);
      const failed: RunEvent = { seq: prefix.at(-1)!.seq + 1, at: prefix.at(-1)!.at, type: "run.failed", stage: "culture", message: "The run hit its deadline." };
      const state = reduce([...prefix, failed]);
      expect(hasEnded(state)).toBe(true);
      const rows = statusOf(railRows([...prefix, failed], { ended: true, failed: true }));
      expect(rows).toMatchObject({ prove: "done", culture: "stopped", prompts: "pending" });
    });
  });

  it("counts only the run's own stages, not frames or revisions after it", () => {
    const trace = report("food-hot-sauce").trace;
    const after = [...trace, { stage: "frames" as const, kind: "tool" as const, label: "Rendering frame 1", cached: false }];
    expect(callCounts(after)).toEqual(callCounts(trace));
  });
});
