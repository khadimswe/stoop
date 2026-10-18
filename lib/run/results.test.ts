import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../demo/examples";
import { reduce, type RunEvent } from "../events";
import type { Report } from "../report/schema";
import { skewText } from "../report/view/format";
import { resultsView } from "./results";

const events = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];
const report = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("results so far, for the recorded %s run", (slug) => {
  const all = events(slug);
  const r = report(slug);
  const upTo = (type: RunEvent["type"]) => resultsView(reduce(all.slice(0, all.findIndex((e) => e.type === type) + 1)));

  it("shows nothing it has not received", () => {
    const view = resultsView(reduce(all.slice(0, 1)));
    expect(view).toEqual({ proof: null, reality: null, expectedWorlds: null, worlds: [], comparison: null });
    expect(upTo("audience.proof").reality).toBeNull();
    expect(upTo("audience.gap").worlds).toEqual([]);
  });

  it("names the seeds Qloo measured from and the top cities by lift, with receipts", () => {
    const proof = upTo("audience.proof").proof!;
    expect(proof.seeds.map((s) => [s.name, s.origin])).toEqual(r.audience.proof!.seeds.map((s) => [s.ref.name, s.origin]));
    expect(proof.cities).toEqual(r.audience.proof!.cities.slice(0, 3).map((c) => ({ label: c.label, rank: c.rank })));
    expect(proof.comparedWith).toBe(r.audience.proof!.cities[0].comparedWith);
  });

  it("renders the Reality Check lines verbatim, with a receipt only on what Qloo measured", () => {
    const reality = upTo("audience.gap").reality!;
    expect(reality.lines.map((l) => [l.kind, l.text])).toEqual(r.audience.gap!.lines.map((l) => [l.kind, l.text]));
    for (const line of reality.lines) {
      if (line.kind === "stated") expect(line).toMatchObject({ source: "you", receipt: null });
      if (line.kind === "generic") expect(line).toMatchObject({ source: "generic", receipt: null });
      if (line.kind === "measured") expect(line.receipt?.cue).toBe("Reality Check");
    }
  });

  it("fills each world in as its parts arrive, in segment order", () => {
    const segments = upTo("audience.segments");
    expect(segments.expectedWorlds).toBe(r.audience.segments!.items.length);
    expect(segments.worlds.map((w) => [w.label, w.ageBand, w.skew, w.fields, w.concept])).toEqual(
      r.audience.segments!.items.map((s) => [s.label, s.ageBand, skewText(s.skew), null, null]),
    );
    const culture = upTo("world.culture").worlds.find((w) => w.fields)!;
    const world = r.worlds.find((w) => w.segmentId === culture.segmentId)!;
    expect(culture.setting).toBe(world.settingCity!.label);
    expect(culture.fields!.map((f) => f.field)).toEqual(world.culture!.map((f) => f.field));
    const done = resultsView(reduce(all));
    expect(done.worlds.map((w) => w.segmentId)).toEqual(r.worlds.map((w) => w.segmentId));
    expect(done.worlds.map((w) => w.concept?.hook)).toEqual(r.worlds.map((w) => w.concepts?.best.concept.hook));
    expect(done.worlds.every((w) => w.packReady)).toBe(true);
  });

  it("never labels a field Qloo's without its receipts, and says when a field has no Qloo signal", () => {
    const done = resultsView(reduce(all));
    for (const world of done.worlds) {
      const source = r.worlds.find((w) => w.segmentId === world.segmentId)!;
      for (const field of world.fields!) {
        const recorded = source.culture!.find((f) => f.field === field.field)!;
        if (field.origin === "qloo" || field.origin === "interpreted") expect(recorded.cues.some((c) => c.origin === field.origin)).toBe(true);
        if (recorded.signal === "none") expect(field.origin === null || field.origin === "creative" || field.origin === "yours").toBe(true);
      }
    }
    const state = reduce(all);
    const stripped = resultsView({ ...state, ledger: [] });
    expect(stripped.worlds.flatMap((w) => w.fields ?? []).some((f) => f.origin === "qloo" || f.origin === "interpreted")).toBe(false);
    expect(stripped.proof!.cities).toEqual([]);
    expect(stripped.worlds.every((w) => w.skew === null && w.setting === null)).toBe(true);
  });

  it("ends with the comparison's own headline and each world's fit line", () => {
    const done = resultsView(reduce(all));
    expect(done.comparison!.headline).toBe(r.comparison!.headline);
    expect(done.comparison!.fits.map((f) => f.line)).toEqual(r.control!.fits.map((f) => f.line));
  });
});
