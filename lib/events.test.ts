import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply, createEmitter, initialState, reduce, runEventSchema, toReport, type RunEvent } from "./events";
import { baselineRunSchema } from "./agent/baseline";
import { candidateDirection, candidateProduct, controlBrief } from "./agent/baseline-brief";
import { CANDIDATES } from "./demo/candidates";
import { defaultPackSettings } from "./prompts/brief";
import { buildProductionPack } from "./prompts/pack";
import { totalScore } from "./prompts/rubric";
import { conceptRunSchema } from "./stages/concepts";
import { controlFitSchema, cultureFieldSchema, panelPositionSchema } from "./report/world";
import { cueSchema } from "./types";

// A real recorded run (data/runs/, produced by `npm run audience -- --picks` from fixtures).
const recorded = JSON.parse(readFileSync("data/runs/food-hot-sauce/audience.events.json", "utf8")) as RunEvent[];

describe("run events", () => {
  it("every recorded event parses with the one event schema", () => {
    for (const event of recorded) expect(runEventSchema.parse(event)).toEqual(event);
  });

  it("the reducer ignores order and duplicates, so an SSE reconnect changes nothing", () => {
    const shuffled = [...recorded].reverse();
    const doubled = [...recorded, ...recorded.slice(5, 20)];
    expect(reduce(shuffled)).toEqual(reduce(recorded));
    expect(reduce(doubled)).toEqual(reduce(recorded));
  });

  it("builds the report progressively: proof before the Reality Check before segments", () => {
    const upTo = (type: RunEvent["type"]) => reduce(recorded.slice(0, recorded.findIndex((e) => e.type === type) + 1));
    expect(upTo("audience.proof").audience).toMatchObject({ gap: null, segments: null });
    expect(upTo("audience.proof").audience.proof).not.toBeNull();
    expect(upTo("audience.gap").audience.segments).toBeNull();
    expect(upTo("run.done").status).toBe("done");
  });

  it("keeps one ledger entry per receipt even when the same call is reported twice", () => {
    const state = reduce(recorded);
    expect(new Set(state.ledger.map((e) => e.id)).size).toBe(state.ledger.length);
  });

  it("refuses to turn a run that is still going into a report", () => {
    expect(() => toReport(reduce(recorded.slice(0, 3)))).toThrow(/in progress/);
    expect(() => toReport(initialState)).toThrow(/never started/);
  });

  it("marks a stopped run partial, and its report says why", () => {
    const { emit, events } = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
    // The run start and the seed receipts, exactly as recorded.
    for (const event of recorded.slice(0, recorded.findIndex((e) => e.type === "stage.started"))) emit(event as never);
    emit({ type: "stage.started", stage: "prove" });
    emit({ type: "run.partial", stage: "prove", reason: "Need at least 2 seeds Qloo knows." });
    emit({ type: "run.done" });
    const report = toReport(reduce(events));
    expect(report.meta.provenance).toBe("partial");
    expect(report.partial).toEqual({ stage: "prove", reason: "Need at least 2 seeds Qloo knows." });
  });

  it("turns a failed run into a partial report, never a normal-looking one, and keeps it failed", () => {
    const upToProof = recorded.slice(0, recorded.findIndex((e) => e.type === "audience.proof") + 1);
    const at = "2026-10-16T20:00:00.000Z";
    const failed = reduce([...upToProof, { seq: 500, at, type: "run.failed", stage: "gap", message: "boom" }, { seq: 501, at, type: "run.done" }]);
    expect(failed).toMatchObject({ status: "failed", error: "boom" });
    const report = toReport(failed);
    expect(report.meta.provenance).toBe("partial");
    expect(report.partial).toEqual({ stage: "gap", reason: "boom" });
  });

  it("ignores events after the run ended, and a second run.started", () => {
    const done = reduce(recorded);
    const proof = recorded.find((e) => e.type === "audience.proof") as Extract<RunEvent, { type: "audience.proof" }>;
    const forged = { ...proof, seq: 900, proof: { ...proof.proof, cities: [] } };
    expect(reduce([...recorded, forged])).toEqual(done);
    const restart = { ...(recorded[0] as Extract<RunEvent, { type: "run.started" }>), seq: 5, runId: "someone-else" };
    expect(reduce([...recorded.filter((e) => e.seq !== 5), restart]).runId).toBe(done.runId);
  });

  it("applies a late event (lower seq, not yet seen) instead of dropping it", () => {
    const ten = recorded[10];
    const eleven = recorded[11];
    const inOrder = reduce(recorded.slice(0, 12));
    const late = apply(apply(reduce(recorded.slice(0, 10)), eleven), ten);
    expect(late.ledger.length).toBe(inOrder.ledger.length);
    expect(late.trace.length).toBe(inOrder.trace.length);
  });

  it("refuses a report that cites a receipt missing from its ledger", () => {
    const state = reduce(recorded);
    const forged = { ...state, audience: { ...state.audience, proof: state.audience.proof && { ...state.audience.proof, cities: state.audience.proof.cities.map((c) => ({ ...c, evidenceIds: ["ev_000000000000"] })) } } };
    expect(() => toReport(forged)).toThrow(/not in the ledger/);
  });
});

describe("concept worlds", () => {
  // Real recorded pieces only: the hot sauce audience run above, its Control run 1 and that run's
  // concepts (data/baselines/), and packs built from them by the real templates. The culture field
  // cites the segment's own recorded artists; no Qloo data is made up.
  const candidate = CANDIDATES.find((c) => c.slug === "food-hot-sauce")!;
  const run = baselineRunSchema.parse(JSON.parse(readFileSync("data/baselines/food-hot-sauce/run-1.json", "utf8")));
  const conceptRun = conceptRunSchema.parse(JSON.parse(readFileSync("data/baselines/food-hot-sauce/concepts.json", "utf8")));
  const product = candidateProduct(candidate);
  const settings = defaultPackSettings(candidateDirection(candidate));
  const brief = controlBrief(run);
  const ranked = (index: number, status: "kept" | "ranked" | "discarded") => ({
    concept: conceptRun.concepts[index].concept,
    rubric: conceptRun.concepts[index].rubric,
    uses: [],
    verifiedUses: [],
    total: totalScore(conceptRun.concepts[index].rubric),
    status,
  });
  const concepts = {
    best: ranked(conceptRun.bestIndex, "kept"),
    others: [0, 1, 2].filter((i) => i !== conceptRun.bestIndex).map((i) => ranked(i, "ranked")),
    modelId: conceptRun.modelId,
    usage: conceptRun.usage,
  };
  const kit = { captions: null, ugc: [], adPlan: null, creatorBrief: null };
  const controlPack = buildProductionPack({ product, brief, concept: concepts.best.concept, settings });

  const audience = reduce(recorded);
  const [segment, second] = audience.audience.segments!.items;
  const artists = segment.artists.slice(0, 3);
  const segmentId = segment.id;
  const worldBrief = { ...brief, segment: { id: segmentId, label: segment.label, ageBands: [segment.bucket] } };
  const worldPack = buildProductionPack({ product, brief: worldBrief, concept: concepts.best.concept, settings });
  const stats = { durationMs: 1200, liveCalls: 0, cachedCalls: 3 };
  const at = "2026-10-16T20:00:00.000Z";
  const beforeDone = recorded.filter((e) => e.type !== "run.done");
  const last = beforeDone.at(-1)!.seq;
  const fit = { segmentId, choices: [], checkable: 0, below: 0, missing: 0, unverifiable: 0, line: "No checkable LLM-only choices for this world.", range: null };
  const worldEvents: RunEvent[] = [
    // The second world starts first and stops early; the report still lists worlds in segment order.
    { seq: last + 1, at, type: "world.started", segmentId: second.id, label: second.label },
    { seq: last + 2, at, type: "world.started", segmentId, label: segment.label },
    { seq: last + 3, at, type: "stage.started", stage: "culture", segmentId },
    {
      seq: last + 4,
      at,
      type: "world.check",
      segmentId,
      check: { picks: artists.map((a) => ({ from: "qloo", kind: "entity", id: a.id, name: a.name, type: a.type, position: null, evidenceIds: a.evidenceIds })), cliches: [] },
    },
    {
      seq: last + 5,
      at,
      type: "world.culture",
      segmentId,
      settingCity: null,
      culture: [
        {
          field: "music",
          signal: "rich",
          scope: "segment",
          sources: artists.map((a) => ({ kind: "entity", id: a.id, name: a.name, type: a.type, rank: a.rank, position: null, why: [], evidenceIds: a.evidenceIds })),
          cues: [{ text: brief.music.text, origin: "interpreted", evidenceIds: artists[0].evidenceIds }],
        },
      ],
      brief: worldBrief,
      richSlots: ["music"],
    },
    { seq: last + 6, at, type: "stage.done", stage: "culture", stats, segmentId },
    { seq: last + 7, at, type: "world.partial", segmentId: second.id, stage: "culture", reason: "Claude did not answer within 45 s" },
    { seq: last + 8, at, type: "world.concepts", segmentId, concepts },
    { seq: last + 9, at, type: "world.pack", segmentId, pack: worldPack, kit },
    { seq: last + 10, at, type: "control.brief", run: 1, brief, assumed: { ageBands: run.brief.audience.ageBands, cities: run.brief.assumedCities }, mappings: [] },
    { seq: last + 11, at, type: "control.fit", fit },
    { seq: last + 12, at, type: "control.concepts", concepts },
    { seq: last + 13, at, type: "stage.done", stage: "concepts", stats, segmentId: "control" },
    { seq: last + 14, at, type: "control.pack", pack: controlPack, kit },
    {
      seq: last + 15,
      at,
      type: "comparison.ready",
      comparison: { headline: "One world checked.", worlds: [{ segmentId, control: fit.line, qloo: "Three Qloo artists back the music.", cliches: 0, evidenceIds: artists[0].evidenceIds }] },
    },
    { seq: last + 16, at, type: "run.done" },
  ];
  const events = [...beforeDone, ...worldEvents];

  it("every world, Control and comparison event parses with the one event schema", () => {
    for (const event of worldEvents) expect(runEventSchema.parse(event)).toEqual(event);
  });

  it("fills a world in as its stages land, and the report carries the worlds, the Control and the comparison", () => {
    const upTo = (seq: number) => reduce(events.filter((e) => e.seq <= seq));
    expect(upTo(last + 4).worlds.find((w) => w.segmentId === segmentId)).toMatchObject({ label: segment.label, culture: null, concepts: null, pack: null });
    expect(upTo(last + 5).worlds.find((w) => w.segmentId === segmentId)?.brief?.segment.id).toBe(segmentId);
    const report = toReport(reduce(events));
    expect(report.worlds.map((w) => w.segmentId)).toEqual([segmentId, second.id]);
    expect(report.worlds[0]).toMatchObject({ concepts, pack: worldPack, kit, richSlots: ["music"], partial: null });
    expect(report.control).toMatchObject({ run: 1, brief, concepts, pack: controlPack, fits: [fit] });
    expect(report.comparison?.worlds[0].segmentId).toBe(segmentId);
  });

  it("keeps world stages and partials on their own world, so worlds side by side never overwrite each other", () => {
    const state = reduce(events);
    expect(state.stats.stages.culture).toBeUndefined();
    expect(state.worlds.find((w) => w.segmentId === segmentId)?.stats).toEqual({ culture: stats });
    expect(state.control?.stats).toEqual({ concepts: stats });
    expect(state.worlds.find((w) => w.segmentId === second.id)?.partial).toEqual({ stage: "culture", reason: "Claude did not answer within 45 s" });
    // A world's stage.started never moves the run's own current stage.
    expect(reduce(events.filter((e) => e.seq <= last + 3)).stage).toBe(reduce(beforeDone).stage);
  });

  it("applies a world's events in any order, and a repeated fit replaces the old one in place", () => {
    const [started2, started1, ...rest] = worldEvents.slice(0, -1);
    const shuffled = [...rest.reverse(), started1, started2];
    const live = shuffled.reduce(apply, reduce(beforeDone));
    expect(toReport(apply(live, worldEvents.at(-1)!))).toEqual(toReport(reduce(events)));
    const refit = { seq: last + 50, at, type: "control.fit", fit: { ...fit, line: "Refit." } } as RunEvent;
    const state = reduce([...events.filter((e) => e.type !== "run.done"), refit]);
    expect(state.control?.fits.map((f) => f.line)).toEqual(["Refit."]);
  });

  it("leaves the Control out of the report until its brief arrives", () => {
    const withoutBrief = events.filter((e) => e.type !== "control.brief");
    expect(reduce(withoutBrief).control?.fits).toHaveLength(1);
    expect(toReport(reduce(withoutBrief)).control).toBeNull();
  });

  it("refuses a report whose world cites a receipt missing from its ledger", () => {
    const state = reduce(events);
    const forged = { ...state, worlds: state.worlds.map((w) => ({ ...w, check: w.check && { ...w.check, picks: w.check.picks.map((p) => ({ ...p, evidenceIds: ["ev_000000000000"] })) } })) };
    expect(() => toReport(forged)).toThrow(/not in the ledger/);
  });

  it("refuses a report whose parts disagree: a world that is no segment, another world's pack, a fit with no world", () => {
    const state = reduce(events);
    const stranger = { ...state, worlds: [...state.worlds, { ...state.worlds[0], segmentId: "seg-nobody", brief: null, pack: null }] };
    expect(() => toReport(stranger)).toThrow(/not a measured segment/);
    const swapped = { ...state, worlds: state.worlds.map((w) => (w.segmentId === segmentId ? { ...w, pack: controlPack } : w)) };
    expect(() => toReport(swapped)).toThrow(/carries the pack of control/);
    const orphan = { ...state, control: state.control && { ...state.control, fits: [{ ...fit, segmentId: "seg-nobody" }] } };
    expect(() => toReport(orphan)).toThrow(/has no world/);
  });

  it("a Gate 3 audience run still reduces to a report with no worlds yet", () => {
    expect(toReport(reduce(recorded))).toMatchObject({ worlds: [], control: null, comparison: null });
  });
});

describe("honesty rules in the world contract", () => {
  const artist = reduce(recorded).audience.segments!.items[0].artists[0];
  const source = { kind: "entity" as const, id: artist.id, name: artist.name, type: artist.type, rank: 1, position: null, why: [], evidenceIds: artist.evidenceIds };

  it("never calls a median on fewer than 5 panel items, and never beats more than the panel", () => {
    expect(panelPositionSchema.safeParse({ beats: 3, of: 4, aboveMedian: true }).success).toBe(false);
    expect(panelPositionSchema.safeParse({ beats: 3, of: 4, aboveMedian: null }).success).toBe(true);
    expect(panelPositionSchema.safeParse({ beats: 26, of: 25, aboveMedian: true }).success).toBe(false);
  });

  it("keeps a field's signal honest about its sources and cues", () => {
    const field = (signal: "rich" | "thin" | "none", sources: unknown[], cues: unknown[] = []) => cultureFieldSchema.safeParse({ field: "music", signal, scope: "segment", sources, cues });
    expect(field("rich", [source]).success).toBe(false);
    expect(field("thin", [source]).success).toBe(true);
    expect(field("none", [source]).success).toBe(false);
    expect(field("none", [], [{ text: "warm folk", origin: "interpreted", evidenceIds: artist.evidenceIds }]).success).toBe(false);
    expect(field("none", [], [{ text: "warm folk", origin: "creative", evidenceIds: [] }]).success).toBe(true);
  });

  it("refuses a Qloo or interpreted cue with no receipt", () => {
    expect(cueSchema.safeParse({ text: "warm folk", origin: "interpreted", evidenceIds: [] }).success).toBe(false);
    expect(cueSchema.safeParse({ text: "warm folk", origin: "qloo", evidenceIds: [] }).success).toBe(false);
    expect(cueSchema.safeParse({ text: "warm folk", origin: "creative", evidenceIds: [] }).success).toBe(true);
  });

  it("derives every count in a fit line from its choices", () => {
    const choice = (status: string) => ({ dimension: "music", text: "lo-fi hip hop", status, position: null, rank: null, measured: null, evidenceIds: [] });
    const choices = [choice("below"), choice("supported"), choice("missing"), choice("unverifiable")];
    const fit = { segmentId: "seg-a", choices, checkable: 3, below: 1, missing: 1, unverifiable: 1, line: "1 of 3 checkable LLM-only choices below this audience's reference median (1 unverifiable)", range: null };
    expect(controlFitSchema.safeParse(fit).success).toBe(true);
    expect(controlFitSchema.safeParse({ ...fit, below: 2 }).success).toBe(false);
    expect(controlFitSchema.safeParse({ ...fit, checkable: 4 }).success).toBe(false);
  });
});
