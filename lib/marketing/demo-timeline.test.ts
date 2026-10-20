import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../events";
import type { Report } from "../report/schema";
import { buildDemoScript } from "./demo-script";
import { DEMO_BEATS } from "./demo-types";
import { demoTimeline, frameAt, PACE } from "./demo-timeline";

const script = buildDemoScript({
  slug: "food-hot-sauce",
  events: JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as RunEvent[],
  report: JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report,
  media: null,
});
const timeline = demoTimeline(script);
const span = (beat: (typeof DEMO_BEATS)[number]) => timeline.beats.find((b) => b.beat === beat)!;

describe("the agent demo's timeline", () => {
  it("lays the beats end to end from 0 to the total", () => {
    expect(timeline.beats[0].start).toBe(0);
    timeline.beats.forEach((beat, i) => {
      expect(beat.end).toBeGreaterThan(beat.start);
      if (i > 0) expect(beat.start).toBe(timeline.beats[i - 1].end);
    });
    expect(timeline.beats.at(-1)!.end).toBe(timeline.total);
  });

  it("starts on an empty composer", () => {
    const frame = frameAt(timeline, script, 0);
    expect(frame).toMatchObject({ beat: "composer", index: 0, composer: { typed: 0, pressed: false }, seeds: { chips: 0, typed: 0, pressed: false }, trace: { steps: 0, done: false } });
  });

  it("finishes each beat complete: typed out, every chip, every step, every line", () => {
    const composer = frameAt(timeline, script, span("composer").end);
    expect(composer.composer).toEqual({ typed: script.product.description.length, pressed: true });
    const seeds = frameAt(timeline, script, span("seeds").end);
    expect(seeds.seeds).toEqual({ chips: script.seeds.items.length, typed: script.statedCustomer!.length, pressed: true });
    const trace = frameAt(timeline, script, span("trace").end);
    expect(trace.trace).toEqual({ steps: script.trace.steps.length, done: true });
    expect(frameAt(timeline, script, span("reality").end).reality).toEqual({ lines: script.reality.lines.length, receipt: true });
    expect(frameAt(timeline, script, span("worlds").end).worlds).toEqual({ cards: script.worlds.length + 1, headline: true });
    expect(frameAt(timeline, script, span("storyboard").end).storyboard.shots).toBe(script.storyboard!.view.shots.length);
    expect(frameAt(timeline, script, timeline.total)).toMatchObject({ beat: "launch", progress: 1, launch: { rows: script.launchPlan.cells.length, cta: true } });
  });

  it("only ever moves forward", () => {
    let last = frameAt(timeline, script, 0);
    for (let t = 0; t <= timeline.total; t += 50) {
      const frame = frameAt(timeline, script, t);
      expect(frame.index).toBeGreaterThanOrEqual(last.index);
      expect(frame.composer.typed).toBeGreaterThanOrEqual(last.composer.typed);
      expect(frame.seeds.chips).toBeGreaterThanOrEqual(last.seeds.chips);
      expect(frame.trace.steps).toBeGreaterThanOrEqual(last.trace.steps);
      last = frame;
    }
  });

  it("keeps the run's own rhythm in the trace, compressed and never slowed down", () => {
    expect(timeline.traceScale).toBeGreaterThan(0);
    expect(timeline.traceScale).toBeLessThanOrEqual(1);
    script.trace.steps.forEach((step, i) => expect(timeline.stepAt[i]).toBe(Math.round(PACE.trace.lead + step.recordedMs * timeline.traceScale)));
    expect(timeline.traceDoneAt).toBe(Math.round(PACE.trace.lead + script.trace.recordedMs * timeline.traceScale));
    expect(span("trace").end - span("trace").start).toBe(timeline.traceDoneAt + PACE.trace.hold);
    // Halfway through the recorded run, about half its steps have arrived.
    const half = frameAt(timeline, script, span("trace").start + PACE.trace.lead + (script.trace.recordedMs * timeline.traceScale) / 2);
    const recordedHalf = script.trace.steps.filter((s) => s.recordedMs <= script.trace.recordedMs / 2).length;
    expect(Math.abs(half.trace.steps - recordedHalf)).toBeLessThanOrEqual(1);
  });

  it("skips the storyboard beat when the run has no concept to preview", () => {
    const bare = { ...script, storyboard: null };
    const short = demoTimeline(bare);
    expect(short.total).toBe(timeline.total - (span("storyboard").end - span("storyboard").start));
    for (let t = 0; t <= short.total; t += 50) expect(frameAt(short, bare, t).beat).not.toBe("storyboard");
    expect(frameAt(short, bare, short.total).beat).toBe("launch");
  });

  it("clamps times outside the replay", () => {
    expect(frameAt(timeline, script, -500).beat).toBe("composer");
    expect(frameAt(timeline, script, timeline.total + 10_000).beat).toBe("launch");
  });
});
