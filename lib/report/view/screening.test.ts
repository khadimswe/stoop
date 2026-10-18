import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { DemoMedia } from "../../demo/manifest";
import { CAMERA_PRESETS } from "../../prompts/models.config";
import type { Report } from "../schema";
import { skewText } from "./format";
import { outputViews } from "./output";
import { ledgerOf } from "./receipts";
import { screeningView } from "./screening";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const hex = (c: string) => c.repeat(64);

describe.each(EXAMPLES.map((e) => e.slug))("the Screening Room view for %s", (slug) => {
  const report = read(slug);
  const view = screeningView(report, ledgerOf(report), null);
  const outputs = outputViews(report, { renderAccess: { kind: "off" } });
  const segments = report.audience.segments!.items;

  it("pins the Control once, then one row per world in segment order", () => {
    expect(view.control?.clip).toBeNull();
    expect(view.control?.theater).toMatchObject({ key: "control", isControl: true, label: "Control", meta: null });
    expect(view.worlds.map((w) => [w.segmentId, w.label])).toEqual(report.worlds.map((w) => [w.segmentId, w.label]));
  });

  it("shows each world's adult age band, its skew and its setting city, each with a receipt", () => {
    view.worlds.forEach((row, i) => {
      const world = report.worlds[i];
      const segment = segments.find((s) => s.id === world.segmentId)!;
      expect(row).toMatchObject({ ageBand: segment.ageBand, skewText: skewText(segment.skew), settingCity: world.settingCity!.label, clip: null });
      expect(row.ageBand).not.toMatch(/24 and younger|24_and_younger/);
      expect(row.skewReceipt).toMatchObject({ cue: "Age skew", calls: new Set(segment.evidenceIds).size });
      expect(row.settingReceipt).toMatchObject({ cue: "Setting city", calls: new Set(world.settingCity!.evidenceIds).size });
    });
  });

  it("names each segment's top stable cities by lift, with their receipt", () => {
    view.worlds.forEach((row, i) => {
      const segment = segments.find((s) => s.id === report.worlds[i].segmentId)!;
      const stable = segment.cities.filter((c) => c.flags.length === 0).slice(0, 2);
      expect(stable.length).toBeGreaterThan(0);
      expect(row.topCities).toBe(stable.map((c) => c.label).join(" and "));
      expect(row.topCitiesReceipt).toMatchObject({ cue: "Top cities", calls: new Set(stable.flatMap((c) => c.evidenceIds)).size });
      expect(row.topCitiesReceipt!.title).toMatch(/by lift, ranked against \d+ reference audiences$/);
    });
  });

  it("chips only the Qloo-backed cues each ad uses, each with its receipt", () => {
    view.worlds.forEach((row, i) => {
      expect(row.cues.length).toBeGreaterThan(0);
      expect(row.cues).toEqual(outputs[i].cues.filter((c) => c.used && c.receipt !== null));
    });
  });

  it("opens a theater per world with the whole brief, every shot and the prompt that made it", () => {
    view.worlds.forEach((row, i) => {
      const world = report.worlds[i];
      const concept = world.pack!.concept;
      const theater = row.theater!;
      expect(theater).toMatchObject({ key: world.segmentId, isControl: false, label: world.label, conceptTitle: concept.title, hookLine: concept.scenes[0].overlayText, clip: null });
      expect(theater.meta).toBe(`${row.skewText} · set in ${row.settingCity}`);
      expect(theater.cues).toEqual(outputs[i].cues);
      expect(theater.storyboard).toEqual(outputs[i].storyboard);
      expect(theater.prompt).toEqual(outputs[i].export!.multiShot);
      expect(theater.shots).toHaveLength(concept.scenes.length);
      const verified = new Set(world.concepts!.best.verifiedUses);
      theater.shots.forEach((shot, n) => {
        expect(shot).toMatchObject({ number: n + 1, beat: concept.scenes[n].beat, action: concept.scenes[n].action, camera: CAMERA_PRESETS[concept.scenes[n].camera].label });
        for (const slot of shot.carries) expect(verified.has(slot)).toBe(true);
      });
      // The storyboard's shots and the theater's agree on what each shot carries.
      if (theater.storyboard.kind === "shots") for (const s of theater.storyboard.shots) expect(theater.shots[s.scene].carries).toEqual(s.carries);
    });
  });

  it("gives the Control's theater its LLM-only brief, with no receipts", () => {
    const theater = view.control!.theater!;
    expect(theater.cues.every((c) => c.origin === "creative" && c.receipt === null)).toBe(true);
    expect(theater.prompt).toEqual(outputs.at(-1)!.export!.multiShot);
    expect(theater.shots).toHaveLength(report.control!.pack!.concept.scenes.length);
  });
});

describe("the Screening Room with approved media", () => {
  it("plays a world's own approved clip and the Control's, in the row and in the theater", () => {
    const report = read("food-hot-sauce");
    const world = report.worlds[0];
    const base = { promptHash: hex("1"), sha256: hex("a"), poster: null, captions: null, example: "food-hot-sauce" as const };
    const media: DemoMedia = {
      packshot: null,
      storyboards: {},
      clips: [
        { ...base, id: "w", role: "culture", segmentId: world.segmentId, file: "/demo/food-hot-sauce/w.mp4" },
        { ...base, id: "c", role: "control", segmentId: null, file: "/demo/food-hot-sauce/c.mp4" },
      ],
    };
    const view = screeningView(report, ledgerOf(report), media);
    expect(view.worlds[0].clip).toMatchObject({ id: "w", src: "/demo/food-hot-sauce/w.mp4" });
    expect(view.worlds[0].theater?.clip).toEqual(view.worlds[0].clip);
    expect(view.worlds[1].clip).toBeNull();
    expect(view.control).toMatchObject({ clip: { id: "c" }, theater: { clip: { id: "c" } } });
  });
});
