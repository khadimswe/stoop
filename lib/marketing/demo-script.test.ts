import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import type { DemoMedia } from "../demo/manifest";
import type { RunEvent } from "../events";
import type { Report } from "../report/schema";
import { skewText } from "../report/view/format";
import { worldCues, worldStoryboard } from "../report/view/output";
import { ledgerOf } from "../report/view/receipts";
import { callCounts, RAIL, STAGE_LABELS } from "../run/rail";
import { buildDemoScript, firstSentence, receiptLine, shortDate } from "./demo-script";
import { DEMO_BEATS } from "./demo-types";
import { demoTimeline } from "./demo-timeline";

const events = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];
const report = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const NO_MEDIA: DemoMedia = { packshot: null, storyboards: {}, clips: [] };
const build = (slug: ExampleSlug, media: DemoMedia = NO_MEDIA) => buildDemoScript({ slug, events: events(slug), report: report(slug), media });

/** Every Qloo call the run's stage stats record: run-scoped stages, each world and the Control. */
function statsCalls(r: Report): number {
  const all = [r.stats.stages, ...r.worlds.map((w) => w.stats), r.control?.stats ?? {}];
  return all.flatMap((stages) => Object.values(stages)).reduce((sum, s) => sum + s!.liveCalls + s!.cachedCalls, 0);
}

describe("the agent demo for the lead example (food-hot-sauce)", () => {
  const r = report("food-hot-sauce");
  const script = build("food-hot-sauce");

  it("labels itself a replay of a recorded run, with the run's own date", () => {
    expect(r.meta.provenance).toBe("recorded");
    expect(script.label).toBe(`Replay of a recorded run · real Qloo data · ${shortDate(r.meta.createdAt)}`);
    expect(script.label).toBe("Replay of a recorded run · real Qloo data · Oct 16");
    expect(script.reportHref).toBe("/examples/food-hot-sauce");
    expect(script.routes).toEqual({ start: "/start", run: "/run/example-food-hot-sauce", report: "/examples/food-hot-sauce" });
  });

  it("types the product's own description and shows the run's inputs", () => {
    const { product } = r.inputs;
    expect(script.product.description).toBe(product.sellerFacts);
    expect(script.product).toMatchObject({ brandName: product.brandName, name: product.name, region: r.inputs.region, price: "$14" });
    expect(product.sellerFacts).toContain(`Price: ${script.product.price}.`);
    expect(script.seeds.items.map((s) => [s.name, s.origin])).toEqual(r.inputs.seeds.map((s) => [s.ref.name, s.origin]));
    expect(script.seeds.items.map((s) => s.kind)).toEqual(["tv show", "brand", "tv show", "brand"]);
    expect(script.statedCustomer).toBe(r.inputs.statedCustomer);
  });

  it("streams every trace step in order, with its label, reason and world", () => {
    const { steps } = script.trace;
    expect(steps.map((s) => s.label)).toEqual(r.trace.map((s) => s.label));
    expect(steps.map((s) => s.kind)).toEqual(r.trace.map((s) => s.kind));
    expect(steps.map((s) => s.reason)).toEqual(r.trace.map((s) => s.reason?.trim() || null));
    expect(steps.map((s) => s.stageLabel)).toEqual(r.trace.map((s) => STAGE_LABELS[s.stage]));
    expect(steps.map((s) => s.served)).toEqual(r.trace.map((s) => (s.kind === "tool" ? (s.cached ? "cached" : "live") : null)));
    const worldsById = new Map(r.worlds.map((w) => [w.segmentId, w.label.split(" · ")[0]]));
    expect(steps.map((s) => s.world)).toEqual(r.trace.map((s) => (s.segmentId ? (s.segmentId === "control" ? "Control" : worldsById.get(s.segmentId)) : null)));
  });

  it("paces the steps by the recorded timestamps", () => {
    const all = events("food-hot-sauce");
    const t0 = Date.parse(all.find((e) => e.type === "run.started")!.at);
    const recorded = all.filter((e) => e.type === "trace.step").map((e) => Date.parse(e.at) - t0);
    expect(script.trace.steps.map((s) => s.recordedMs)).toEqual(recorded);
    expect(script.trace.recordedMs).toBe(Date.parse(all.find((e) => e.type === "run.done")!.at) - t0);
  });

  it("counts Qloo calls from the run itself, cached ones separately, rising to the real total", () => {
    const totals = callCounts(r.trace);
    expect(script.trace.totals).toEqual(totals);
    expect(totals.live + totals.cached).toBe(statsCalls(r));
    expect(totals).toEqual({ live: 0, cached: 36 });
    const running = script.trace.steps.map((s) => s.calls.live + s.calls.cached);
    expect(running).toEqual([...running].sort((a, b) => a - b));
    expect(script.trace.steps.at(-1)!.calls).toEqual(totals);
    expect(script.trace.finalStageCalls.reduce((a, b) => a + b, 0)).toBe(totals.live + totals.cached);
  });

  it("moves the rail stage to stage, from all waiting to all done", () => {
    expect(script.trace.stages).toEqual(RAIL.map((stage) => ({ stage, label: STAGE_LABELS[stage] })));
    expect(script.trace.initialRail).toEqual(RAIL.map(() => "pending"));
    expect(script.trace.finalRail).toEqual(RAIL.map(() => "done"));
    script.trace.steps.forEach((step, i) => {
      expect(step.rail).toHaveLength(RAIL.length);
      // A step's own stage has started by the time it arrives.
      const stage = r.trace[i].stage;
      const at = RAIL.indexOf(stage as (typeof RAIL)[number]);
      if (at !== -1) expect(step.rail[at]).not.toBe("pending");
    });
  });

  it("reveals the Reality Check exactly as the gap stage wrote it", () => {
    const lines = r.audience.gap!.lines;
    expect(script.reality.lines.map((l) => [l.kind, l.text])).toEqual(lines.map((l) => [l.kind, l.text]));
    expect(script.reality.lines.map((l) => l.source)).toEqual(["you", "qloo", "generic"]);
    expect(script.reality.lines[0].text).toBe("You said 25 to 40.");
    expect(script.reality.lines[1].text.startsWith("Qloo measured ")).toBe(true);
    const measured = lines.find((l) => l.kind === "measured")!;
    const entries = measured.evidenceIds.map((id) => r.ledger.find((e) => e.id === id)!);
    expect(script.reality.receipt).toBe(receiptLine(entries));
    expect(script.reality.receipt).toBe(`${entries.length} Qloo calls · /v2/insights · from cache`);
  });

  it("shows each concept world's hook next to the Control's, from the report", () => {
    const segments = new Map(r.audience.segments!.items.map((s) => [s.id, s]));
    expect(script.worlds).toEqual(
      r.worlds.map((w, i) => ({
        segmentId: w.segmentId,
        position: i + 1,
        label: w.label,
        ageBand: segments.get(w.segmentId)!.ageBand,
        skew: skewText(segments.get(w.segmentId)!.skew),
        setting: w.settingCity!.label,
        conceptTitle: w.concepts!.best.concept.title,
        hook: w.concepts!.best.concept.hook,
      })),
    );
    expect(script.control).toEqual({ conceptTitle: r.control!.concepts!.best.concept.title, hook: r.control!.concepts!.best.concept.hook, headline: r.comparison!.headline });
  });

  it("previews the top world's shot list while no frames are approved", () => {
    const preview = worldStoryboard(r.worlds[0], NO_MEDIA);
    expect(preview.kind).toBe("shots");
    if (preview.kind !== "shots") return;
    const { scenes } = r.worlds[0].concepts!.best.concept;
    expect(script.storyboard?.world).toBe(r.worlds[0].label);
    expect(script.storyboard?.conceptTitle).toBe(r.worlds[0].concepts!.best.concept.title);
    expect(script.storyboard?.view.kind).toBe("shots");
    const shots = script.storyboard!.view.shots;
    expect(shots.map((s) => [s.number, s.beat, s.action, s.overlayText])).toEqual(scenes.map((scene, i) => [i + 1, scene.beat, scene.action, scene.overlayText]));
    expect(shots.map((s) => [s.start, s.end])).toEqual(preview.shots.map((s) => [s.start, s.end]));
  });

  it("tags each shot with the brief cues it carries, Qloo-backed ones only with their receipts", () => {
    const preview = worldStoryboard(r.worlds[0], NO_MEDIA);
    const cues = new Map(worldCues(r.worlds[0], ledgerOf(r)).map((cue) => [cue.slot, cue]));
    const shots = script.storyboard!.view.shots;
    shots.forEach((shot, i) => {
      const expected = preview.kind === "none" ? [] : preview.shots[i].carries.map((slot) => cues.get(slot)!).filter((cue) => cue.origin === "creative" || cue.origin === "yours" || cue.receipt);
      expect(shot.carries).toEqual(expected.map((cue) => ({ label: cue.label, origin: cue.origin })));
    });
    expect(shots.some((shot) => shot.carries.some((c) => c.origin === "interpreted" || c.origin === "qloo"))).toBe(true);
  });

  it("shows approved storyboard frames instead, when the manifest has them", () => {
    const hex = (c: string) => c.repeat(64);
    const world = r.worlds[0];
    const media: DemoMedia = {
      ...NO_MEDIA,
      storyboards: {
        [world.segmentId]: {
          example: "food-hot-sauce",
          segmentId: world.segmentId,
          frames: [0, 1].map((scene) => ({ scene, attempt: 1 as const, file: `/demo/food-hot-sauce/frames/w1-${scene}.webp`, promptHash: hex("2"), sha256: hex("b"), modelId: "fal-ai/flux/schnell" })),
          critiques: [],
        },
      },
    };
    const framed = build("food-hot-sauce", media);
    expect(framed.storyboard?.view.kind).toBe("frames");
    if (framed.storyboard?.view.kind !== "frames") return;
    expect(framed.storyboard.view.frames.map((f) => f.src)).toEqual(["/demo/food-hot-sauce/frames/w1-0.webp", "/demo/food-hot-sauce/frames/w1-1.webp"]);
  });

  it("builds the launch plan from each world's ad plan, with the Control as the baseline", () => {
    expect(script.launchPlan.cells.map((c) => c.name)).toEqual(r.worlds.map((w) => w.kit!.adPlan!.name));
    script.launchPlan.cells.forEach((cell, i) => {
      expect(r.worlds[i].kit!.adPlan!.watch.startsWith(cell.watch)).toBe(true);
      expect(cell.watch.endsWith(".")).toBe(true);
    });
    expect(script.launchPlan.baseline).toBe("Control");
  });

  it("summarizes the run for screen readers with the run's own lines and counts", () => {
    for (const line of r.audience.gap!.lines) expect(script.summary).toContain(line.text);
    expect(script.summary).toContain("36 Qloo calls (36 from cache)");
    expect(script.summary).toContain(`built 2 concept worlds: ${r.worlds[0].label}, set in Slidell, LA`);
    expect(script.summary).toContain(r.comparison!.headline);
    expect(script.summary).toContain("Oct 16, 2026");
  });

  it("plays its beats in order, in about 25 to 40 seconds", () => {
    const timeline = demoTimeline(script);
    expect(timeline.beats.map((b) => b.beat)).toEqual([...DEMO_BEATS]);
    expect(DEMO_BEATS).toEqual(["composer", "seeds", "trace", "reality", "worlds", "storyboard", "launch"]);
    expect(timeline.total).toBeGreaterThanOrEqual(25_000);
    expect(timeline.total).toBeLessThanOrEqual(40_000);
  });

  it("stays under its 30 KB size budget", () => {
    expect(JSON.stringify(script).length).toBeLessThan(30_000);
  });

  it("refuses anything but a recorded run, and events that disagree with the report", () => {
    const live = { ...r, meta: { ...r.meta, provenance: "live" as const } };
    expect(() => buildDemoScript({ slug: "food-hot-sauce", events: events("food-hot-sauce"), report: live, media: NO_MEDIA })).toThrow(/recorded runs only/);
    expect(() => buildDemoScript({ slug: "food-hot-sauce", events: events("home-candles"), report: r, media: NO_MEDIA })).toThrow(/disagree/);
  });
});

describe.each(EXAMPLES.map((e) => e.slug))("the agent demo for %s", (slug) => {
  const r = report(slug);
  const script = build(slug);

  it("replays its own run verbatim and within budget", () => {
    expect(script.reality.lines.map((l) => l.text)).toEqual(r.audience.gap!.lines.map((l) => l.text));
    expect(script.trace.steps).toHaveLength(r.trace.length);
    expect(script.trace.totals).toEqual(callCounts(r.trace));
    expect(script.worlds.map((w) => w.hook)).toEqual(r.worlds.map((w) => w.concepts!.best.concept.hook));
    expect(JSON.stringify(script).length).toBeLessThan(30_000);
  });
});

describe("helpers", () => {
  it("keeps the first sentence of a line verbatim", () => {
    expect(firstSentence("Watch whether A beats B. Compare this ad set.")).toBe("Watch whether A beats B.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
    expect(firstSentence("Costs $14.50 a bottle. More.")).toBe("Costs $14.50 a bottle.");
  });

  it("names the calls behind a fact as the receipts do", () => {
    const entry = (cached: boolean, endpoint = "/v2/insights") => ({ cached, endpoint }) as Parameters<typeof receiptLine>[0][number];
    expect(receiptLine([])).toBeNull();
    expect(receiptLine([entry(true)])).toBe("1 Qloo call · /v2/insights · from cache");
    expect(receiptLine([entry(false), entry(false, "/search")])).toBe("2 Qloo calls · /v2/insights, /search · live");
    expect(receiptLine([entry(true), entry(false)])).toBe("2 Qloo calls · /v2/insights · 1 from cache");
  });
});
