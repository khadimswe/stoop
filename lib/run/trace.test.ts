import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../demo/examples";
import { reduce, type RunEvent } from "../events";
import type { Report } from "../report/schema";
import { STAGE_LABELS } from "./rail";
import { shortWorldLabel, traceRows } from "./trace";
import { describeRecorded } from "../testing/recorded";

const report = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const events = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];

describeRecorded.each(EXAMPLES.map((e) => e.slug))("trace rows for the recorded %s run", (slug) => {
  const r = report(slug);
  const rows = traceRows(r.trace, r.worlds);

  it("keeps every step once, in order, in the stages' own words", () => {
    expect(rows.map((row) => row.label)).toEqual(r.trace.map((step) => step.label));
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("gives decisions their reasons and tool steps where the answer came from", () => {
    rows.forEach((row, i) => {
      const step = r.trace[i];
      if (step.kind === "decision") expect(row).toMatchObject({ served: null, reason: step.reason ?? null });
      else expect(row.served).toBe(step.cached ? "cached" : "live");
      expect(row.stageLabel).toBe(STAGE_LABELS[step.stage]);
    });
  });

  it("names the stage above each run of steps, and the world while worlds run side by side", () => {
    rows.forEach((row, i) => expect(row.startsGroup).toBe(i === 0 || rows[i - 1].stage !== row.stage));
    for (const [i, step] of r.trace.entries()) {
      const world = r.worlds.find((w) => w.segmentId === step.segmentId);
      if (world) expect(rows[i].world).toBe(shortWorldLabel(world.label));
      if (!step.segmentId) expect(rows[i].world).toBeNull();
    }
  });

  it("can show the decisions alone", () => {
    const decisions = traceRows(r.trace, r.worlds, { show: "decisions" });
    expect(decisions.map((d) => d.label)).toEqual(r.trace.filter((s) => s.kind === "decision").map((s) => s.label));
    expect(decisions[0].startsGroup).toBe(true);
  });

  it("builds the same rows from a live state as it streams", () => {
    const all = events(slug);
    const half = reduce(all.slice(0, Math.floor(all.length / 2)));
    expect(traceRows(half.trace, half.worlds).map((row) => row.label)).toEqual(rows.slice(0, half.trace.length).map((row) => row.label));
  });
});

describe("short world labels", () => {
  it("keep the measured age band of a world's label", () => {
    expect(shortWorldLabel("55 and older · rock and classic rock")).toBe("55 and older");
    expect(shortWorldLabel("seg-1")).toBe("seg-1");
  });
});
