import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import { CULTURE_FIELDS } from "../../types";
import type { Report } from "../schema";
import type { ControlFit, Revision, World } from "../world";
import { plainType, skewText } from "./format";
import { ledgerOf } from "./receipts";
import { CITY_SUPPORT_RANK as CHECK_CITY_RANK } from "../../stages/check";
import { CITY_SUPPORT_RANK, EXCLUDE_MAX, fieldOfSlot, latestJobSteps, revisionOutcome, slotLabel, STATUS_LABELS, TOP_CITIES, whyView } from "./why";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("the Why it works view for %s", (slug) => {
  const report = read(slug);
  const proof = report.audience.proof!;
  const view = whyView(report, ledgerOf(report));

  it("shows every seed with its origin and its receipt", () => {
    expect(view.seeds.map(({ name, kind, origin, match }) => ({ name, kind, origin, match }))).toEqual(
      proof.seeds.map((s) => ({ name: s.ref.name, kind: plainType(s.ref.type), origin: s.origin, match: s.match ?? null })),
    );
    for (const seed of view.seeds) expect(seed.receipt?.calls).toBeGreaterThan(0);
  });

  it("lists the stable cities by lift, each with its receipt, and the caveats beside them", () => {
    const stable = proof.cities.filter((c) => c.flags.length === 0).slice(0, TOP_CITIES);
    expect(view.cities.map(({ label, rank, comparedWith }) => ({ label, rank, comparedWith }))).toEqual(stable.map(({ label, rank, comparedWith }) => ({ label, rank, comparedWith })));
    for (const city of view.cities) expect(city.receipt).toMatchObject({ cue: "City", calls: 1 });
    expect(view.smallSetOnly).toEqual(proof.smallSetOnly.map((c) => c.label));
    expect(view.swinging).toEqual(proof.cities.filter((c) => c.flags.includes("large-swing")).map((c) => c.label));
    expect(view.comparisonHeadline).toBe(report.comparison!.headline);
    expect(view.flags).toEqual(proof.flags);
  });

  it("checks each stated dimension in the gap stage's own words, with its receipt", () => {
    const dims = report.audience.gap!.dimensions;
    expect(view.dimensions.map((d) => [d.dimension, d.stated, d.measured, d.outcome])).toEqual(dims.map((d) => [d.dimension, d.stated, d.measured, d.outcome]));
    for (const d of view.dimensions) {
      expect(d.receipt?.calls).toBeGreaterThan(0);
      if (d.outcome === "near_tie") expect(d.outcomeLabel).toBe("Near tie");
      if (d.outcome === "not_stated") expect(d.statedBy).toBeNull();
    }
  });

  it("shows age and gender as relative skews with adult labels, never shares", () => {
    const { age, gender } = proof.demographics;
    expect(view.demographics!.age.map((b) => [b.key, b.text])).toEqual(Object.entries(age).map(([bucket, skew]) => [bucket, skewText(skew)]));
    expect(view.demographics!.age[0].label).toBe("18 to 24");
    expect(view.demographics!.gender.map((b) => b.text)).toEqual([skewText(gender.female), skewText(gender.male)]);
    for (const bar of [...view.demographics!.age, ...view.demographics!.gender]) {
      expect(bar.text).toMatch(/^skews [+-]?\d\.\d\d$/);
      expect(bar.magnitude).toBe(Math.round(Math.min(1, Math.abs(bar.skew)) * 100));
    }
    expect(view.demographics!.receipt?.calls).toBe(new Set(proof.demographics.evidenceIds).size);
    const shown = [...view.demographics!.age, ...view.demographics!.gender].map((b) => `${b.label} ${b.text}`).join(" ");
    expect(shown).not.toMatch(/%|24_and_younger|24 and younger/);
  });

  it("chips every taste tag Qloo returned, each with its receipt", () => {
    expect(view.tags.map((t) => [t.name, t.kind, t.rank])).toEqual(proof.tags.map((t) => [t.name, t.kind, t.rank]));
    for (const tag of view.tags) expect(tag.receipt?.title).toBe(`${tag.name}, #${tag.rank} in its response`);
  });

  it("lays out each world's Culture Brief in field order, every Qloo cue with its picks in the receipt", () => {
    expect(view.briefs.map((b) => b.segmentId)).toEqual(report.worlds.map((w) => w.segmentId));
    view.briefs.forEach((brief, i) => {
      const world = report.worlds[i];
      expect(brief.fields.map((f) => f.field)).toEqual(CULTURE_FIELDS.filter((f) => world.culture!.some((c) => c.field === f)));
      expect(brief).toMatchObject({ revisionId: null, revisions: [], reviseSteps: [], revisable: true, partial: null });
      for (const field of brief.fields) {
        const source = world.culture!.find((c) => c.field === field.field)!;
        expect(field.cues.map((c) => [c.text, c.origin])).toEqual(source.cues.map((c) => [c.text, c.origin]));
        expect(field.signalLabel).toBe({ rich: "Rich Qloo signal", thin: "Thin Qloo signal", none: "No Qloo signal" }[source.signal]);
        expect(field.scopeNote !== null).toBe(source.scope === "audience");
        for (const cue of field.cues) {
          if (cue.origin === "creative" || cue.origin === "yours") expect(cue.receipt).toBeNull();
          else {
            expect(cue.receipt?.rows[0].label).toMatch(/^Qloo pick/);
            expect(cue.receipt?.rows.some((r) => r.label === "Endpoint")).toBe(true);
          }
          expect(cue.was).toBeNull();
        }
      }
    });
  });

  it("scores the generic brief against each world with the stage's own numbers and words", () => {
    const board = view.scoreboard!;
    const control = report.control!;
    expect(board.headline).toBe(report.comparison!.headline);
    expect(board.worlds.map((w) => w.segmentId)).toEqual(control.fits.map((f) => f.segmentId));
    board.worlds.forEach((row, i) => {
      const fit = control.fits[i];
      const line = report.comparison!.worlds.find((w) => w.segmentId === fit.segmentId)!;
      expect(row).toMatchObject({ fitLine: fit.line, qlooLine: line.qloo, counts: { checkable: fit.checkable, below: fit.below, missing: fit.missing, unverifiable: fit.unverifiable } });
      expect(row.range).toBe(fit.range && `Across ${fit.range.runs} recorded generic briefs, ${fit.range.belowMin === fit.range.belowMax ? fit.range.belowMin : `${fit.range.belowMin} to ${fit.range.belowMax}`} choices missed.`);
      const choices = row.groups.flatMap((g) => g.choices);
      expect(choices.map((c) => [c.text, c.status, c.measured]).sort()).toEqual(fit.choices.map((c) => [c.text, c.status, c.measured]).sort());
      for (const choice of choices) {
        expect(choice.statusLabel).toBe(STATUS_LABELS[choice.status]);
        if (choice.status === "below") expect(choice.statusLabel).toBe("Cliche flagged");
        if (choice.status === "supported" || choice.status === "below") expect(choice.receipt?.calls).toBeGreaterThan(0);
      }
      const world = report.worlds.find((w) => w.segmentId === fit.segmentId)!;
      expect(row.cliches.map((c) => [c.assumed, c.measured])).toEqual(world.check!.cliches.map((c) => [c.assumed, c.measured]));
      for (const cliche of row.cliches) expect(cliche.receipt?.cue).toBe("Cliche flagged");
      expect(row.qlooReceipt?.calls).toBe(new Set(line.evidenceIds).size);
    });
  });

  it("states the check's own rule next to each kind of choice", () => {
    for (const row of view.scoreboard!.worlds) {
      const rules = Object.fromEntries(row.groups.map((g) => [g.key, g]));
      expect(rules.age.choices.every((c) => c.dimension === "age")).toBe(true);
      expect(rules.age.rule).toMatch(/age band/);
      expect(rules.cities.rule).toContain(`top ${CHECK_CITY_RANK} by lift`);
      expect(rules.taste.rule).toMatch(/reference panel median.*one Qloo call.*Under 5 panel items there is no median/);
      expect(rules.unchecked.rule).toMatch(/nothing to check/);
      expect(row.groups.map((g) => g.key)).toEqual(["age", "cities", "taste", "unchecked"]);
    }
  });

  it("sends each field's own Qloo picks, at most 12, as what a revision leaves out", () => {
    view.briefs.forEach((brief, i) => {
      for (const field of brief.fields) {
        const sources = report.worlds[i].culture!.find((c) => c.field === field.field)!.sources;
        expect(field.excludeIds).toEqual(sources.slice(0, EXCLUDE_MAX).map((s) => s.id));
        expect(field.excludeIds.length).toBeLessThanOrEqual(12);
      }
    });
  });

  it("never calls a score unsupported, never claims a share, and stays serializable", () => {
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/unsupported|% of|percentile|real buyers/i);
    expect(JSON.parse(json)).toEqual(view);
  });
});

describe("the Why it works view", () => {
  it("uses the check stage's city rule and the revise request's id limit", () => {
    expect(CITY_SUPPORT_RANK).toBe(CHECK_CITY_RANK);
    expect(EXCLUDE_MAX).toBe(12);
  });

  it("leaves out a city flagged as swinging, as the Reality Check does (home-candles)", () => {
    const report = read("home-candles");
    const view = whyView(report, ledgerOf(report));
    const flagged = report.audience.proof!.cities.find((c) => c.flags.length > 0)!;
    expect(view.cities.map((c) => c.label)).not.toContain(flagged.label);
    expect(view.swinging).toContain(flagged.label);
    // The Reality Check names the first stable city: the same one leads here.
    const measured = report.audience.gap!.lines.find((l) => l.kind === "measured")!.text;
    expect(measured).toContain(`around ${view.cities[0].label}`);
  });

  it("says in the receipt when a seed matched under a longer name (food-hot-sauce)", () => {
    const report = read("food-hot-sauce");
    const affix = whyView(report, ledgerOf(report)).seeds.find((s) => s.match === "affix")!;
    expect(affix.receipt?.rows[0]).toEqual({ label: "Matched", value: "Qloo lists it under a longer name" });
  });

  it("keeps a near tie a near tie (pets-outfits)", () => {
    const report = read("pets-outfits");
    const age = whyView(report, ledgerOf(report)).dimensions.find((d) => d.dimension === "age")!;
    expect(age).toMatchObject({ outcome: "near_tie", outcomeLabel: "Near tie", statedBy: "You" });
  });

  it("counts a missing score as no measurable affinity, never as a cliche", () => {
    const report = read("food-hot-sauce");
    const fit = report.control!.fits[0];
    // The recorded music choice, as if Qloo had returned no score for it.
    const missing: ControlFit = {
      ...fit,
      choices: fit.choices.map((c) => (c.dimension === "music" ? { ...c, status: "missing", position: null, measured: "Qloo returned no score for Soul - Funk" } : c)),
      missing: 1,
      checkable: fit.checkable,
    };
    const view = whyView({ ...report, control: { ...report.control!, fits: [missing, ...report.control!.fits.slice(1)] } }, ledgerOf(report));
    const music = view.scoreboard!.worlds[0].groups.flatMap((g) => g.choices).find((c) => c.dimension === "music")!;
    expect(music).toMatchObject({ status: "missing", statusLabel: "No measurable affinity" });
    expect(view.scoreboard!.worlds[0].counts.missing).toBe(1);
  });

  it("claims no median when a dimension's panel has fewer than 5 items", () => {
    const report = read("food-hot-sauce");
    const gap = report.audience.gap!;
    const taste = { ...gap.dimensions.find((d) => d.dimension === "taste")!, stated: "funk", statedBy: "you" as const, outcome: "gap" as const, position: { tag: "Soul - Funk", beats: 1, of: 4 } };
    const view = whyView({ ...report, audience: { ...report.audience, gap: { ...gap, dimensions: [taste] } } }, ledgerOf(report));
    expect(view.dimensions[0].position).toBe("Soul - Funk: beats 1 of 4 reference tags (too few for a median)");
  });

  it("shows a field with no Qloo signal as exactly that", () => {
    const report = read("food-hot-sauce");
    const world = report.worlds[0];
    const culture = world.culture!.map((f) => (f.field === "creators" ? { ...f, signal: "none" as const, sources: [], cues: [] } : f));
    const view = whyView({ ...report, worlds: [{ ...world, culture }, ...report.worlds.slice(1)] }, ledgerOf(report));
    const creators = view.briefs[0].fields.find((f) => f.field === "creators")!;
    expect(creators).toMatchObject({ signalLabel: "No Qloo signal", noSignal: true, cues: [], sources: 0 });
  });

  it("is honest before Prove: no seeds from Qloo, no demographics, no scoreboard", () => {
    const report = read("food-hot-sauce");
    const view = whyView({ ...report, audience: { proof: null, gap: null, segments: null }, worlds: [], control: null, comparison: null }, ledgerOf(report));
    expect(view).toMatchObject({ cities: [], dimensions: [], demographics: null, tags: [], briefs: [], scoreboard: null });
    expect(view.seeds.map((s) => s.name)).toEqual(report.inputs.seeds.map((s) => s.ref.name));
  });
});

describe("a revision in Why it works", () => {
  const report = read("food-hot-sauce");
  const ledger = ledgerOf(report);
  const [world, other] = report.worlds;
  // A revision assembled from the recorded worlds: this world's brief with the other world's music.
  const music = other.culture!.find((f) => f.field === "music")!;
  const revision: Revision = {
    id: "rev-0123456789ab",
    field: "music",
    reason: "Less classic rock, more porch.",
    excluded: world.culture!.find((f) => f.field === "music")!.sources.map((s) => s.id),
    changes: [{ slot: "music", before: world.brief!.music, after: other.brief!.music }],
    brief: { ...world.brief!, music: other.brief!.music },
    culture: world.culture!.map((f) => (f.field === "music" ? music : f)),
    richSlots: world.richSlots,
    concepts: world.concepts,
    pack: world.pack,
    kit: world.kit,
    evidenceIds: [],
  };
  const revised: World = { ...world, revisions: [revision] };
  const trace: Report["trace"] = [
    ...report.trace,
    { stage: "revise", kind: "decision", label: "Revising 55 and older: not this music", reason: "Leaving out 5 of Qloo's picks.", segmentId: world.segmentId },
  ];
  const view = whyView({ ...report, worlds: [revised, other], trace }, ledger);
  const brief = view.briefs[0];

  it("shows the revised brief, the new cue with its receipt and the old one kept as 'was'", () => {
    expect(brief.revisionId).toBe(revision.id);
    const cue = brief.fields.find((f) => f.field === "music")!.cues[0];
    expect(cue.text).toBe(other.brief!.music.text);
    expect(cue.receipt?.calls).toBeGreaterThan(0);
    expect(cue.was).toMatchObject({ text: world.brief!.music.text, origin: world.brief!.music.origin, receipt: { cue: "Was: Music feel", title: world.brief!.music.text } });
  });

  it("lists what changed, in the founder's words, with both receipts", () => {
    expect(brief.revisions).toHaveLength(1);
    const [row] = brief.revisions;
    expect(row).toMatchObject({ id: revision.id, fieldLabel: "Music feel", note: "Less classic rock, more porch.", excluded: revision.excluded.length });
    expect(row.changes[0]).toMatchObject({ slot: "music", label: "Music feel", before: { text: world.brief!.music.text }, after: { text: other.brief!.music.text } });
    expect(row.changes[0].before?.receipt?.calls).toBeGreaterThan(0);
    expect(brief.reviseSteps).toEqual([{ label: "Revising 55 and older: not this music", reason: "Leaving out 5 of Qloo's picks." }]);
  });

  it("tells a pending revision from a landed or a failed one", () => {
    const failedTrace: Report["trace"] = [...report.trace, { stage: "revise", kind: "decision", label: "Could not revise 55 and older", reason: "The revision ran out of time.", segmentId: world.segmentId }];
    expect(revisionOutcome({ worlds: [revised], trace: report.trace }, world.segmentId, revision.id, 0)).toEqual({ status: "done" });
    expect(revisionOutcome({ worlds: [world], trace: report.trace }, world.segmentId, revision.id, report.trace.length)).toEqual({ status: "pending" });
    expect(revisionOutcome({ worlds: [world], trace: failedTrace }, world.segmentId, revision.id, report.trace.length)).toEqual({ status: "failed", reason: "The revision ran out of time." });
    // A failure from before the request is an older job's.
    expect(revisionOutcome({ worlds: [world], trace: failedTrace }, world.segmentId, revision.id, failedTrace.length)).toEqual({ status: "pending" });
  });

  it("reads the latest job's steps only, and names slots plainly", () => {
    const steps: Report["trace"] = [
      { stage: "revise", kind: "decision", label: "Revising A", segmentId: "seg-a" },
      { stage: "revise", kind: "decision", label: "Could not revise A", reason: "x", segmentId: "seg-a" },
      { stage: "revise", kind: "decision", label: "Revising A", segmentId: "seg-a" },
      { stage: "revise", kind: "decision", label: "Replayed 3 Qloo answers from the cache", segmentId: "seg-a" },
      { stage: "frames", kind: "decision", label: "Frame 1 passes the checklist", segmentId: "seg-a" },
    ];
    expect(latestJobSteps(steps, "seg-a", "revise", "Revising ").map((s) => s.label)).toEqual(["Revising A", "Replayed 3 Qloo answers from the cache"]);
    expect(latestJobSteps(steps, "seg-a", "frames").map((s) => s.label)).toEqual(["Frame 1 passes the checklist"]);
    expect([slotLabel("setting.1"), slotLabel("voice.tone"), slotLabel("productRole")]).toEqual(["Setting 2", "Voice", "Product role"]);
    expect([fieldOfSlot("setting.2"), fieldOfSlot("voice.tone"), fieldOfSlot("talent"), fieldOfSlot("music")]).toEqual(["setting", "voice", null, "music"]);
  });
});
