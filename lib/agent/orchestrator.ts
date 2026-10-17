// One full run: the audience stages, then a concept world per measured segment, the LLM-only Control
// scored against every world, and the with-vs-without comparison, emitted as run events.
//   Prove -> Reality Check -> Segments            (run-scoped stages)
//   creators + the Control mapped to Qloo          (run-scoped, once)
//   per world, side by side:                       (world-scoped stages, own stats, own partial)
//     culture: sweep, then the Culture agent's brief (the check runs inside it, before the agent)
//     score:   the check against the frozen panels (the agent reads the positions)
//     concepts: the shared Creative Director
//     prompts: the Production Pack and the kit
//   the Control's concepts and pack, next to the worlds (segment id "control")
//   comparison
// Worlds share the run's Qloo budget rows and client, so running them at once never raises the call
// count or the rate. One world failing stops only that world (world.partial); the run goes on. The
// creative steps (concept writer, pack, kit) are passed in, so this file depends only on their shapes.
import type { LanguageModel } from "ai";
import { ENTITY_PANELS } from "../culture/panels";
import type { BaselineRun } from "./baseline";
import { CONTROL_RUN, controlBrief } from "./baseline-brief";
import type { RunEvent } from "../events";
import { sellerText, type BriefSlots, type Concept, type PackSettings, type ProductSpec } from "../prompts/brief";
import type { PackProblem, ProductionPack } from "../prompts/pack";
import type { Stage, StageStats } from "../report/schema";
import { QlooBudgetError, QlooHttpError, QlooShapeError } from "../qloo/errors";
import { CONTROL_ID, MIN_PANEL_FOR_MEDIAN, type AdPlanEntry, type Comparison, type ConceptSet, type ControlFit, type CreatorBrief, type CultureFieldResult, type UgcScript, type World } from "../report/world";
import type { AgeBucket } from "../qloo/constants";
import { ageBandLabel, type CreativeDirection } from "../types";
import { measureAudience, stageTimer, type AudienceEnv, type AudienceRun, type MeasuredAudience } from "../stages/audience";
import { realityCheck, type GenericAssumption } from "../stages/gap";
import { checkWorld, controlMappings, mapControl, type ControlRunMap } from "../stages/check";
import { craftWorld } from "../stages/craft";
import { chooseSettingCities, measuredCandidates, sweepCreators, sweepWorld, type CultureCandidate, type SettingCityChoice } from "../stages/culture";
import { decide, forWorld, type StageEnv } from "../stages/env";
import type { ConceptRun } from "../stages/concepts";
import { runCultureAgent } from "./culture-agent";

/** The creative steps both sides share (lane B's concept writer, templates and kit). */
export interface Creative {
  writeConcepts(product: ProductSpec, brief: BriefSlots, options: { model: LanguageModel; modelId: string; names: readonly string[]; direction: CreativeDirection; now?: () => Date; abortSignal?: AbortSignal }): Promise<ConceptRun>;
  conceptSet(run: ConceptRun, brief: BriefSlots): ConceptSet;
  buildPack(input: { product: ProductSpec; brief: BriefSlots; concept: Concept; settings: PackSettings }): ProductionPack;
  checkPack(pack: ProductionPack, brief: BriefSlots, product: ProductSpec, names: readonly string[], options: { richSlots: readonly string[] }): PackProblem[];
  kitScripts(input: { product: ProductSpec; brief: BriefSlots; concept: Concept; names?: readonly string[] }): { captions: string | null; ugc: UgcScript[] };
  /** Which short-form format the kept concept fits, and why (for the trace). */
  formatReason(concept: Concept): { format: string; reason: string };
  adPlanEntry(input: { label: string; ageBands: AgeBucket[]; cities: { label: string; evidenceIds: string[] }[]; concept: Concept; evidenceIds: string[] }): AdPlanEntry;
  creatorBrief(input: { brief: BriefSlots; creators: CultureFieldResult | null; concepts: ConceptSet }): CreatorBrief | null;
}

export interface BriefRun extends AudienceRun {
  /**
   * The LLM-only Control's runs, run 1 first (examples carry all 3 recorded runs, for the range). A
   * live run passes a promise: the Control is written next to Prove, and the Reality Check gains its
   * generic-brief line when it lands.
   */
  control: readonly BaselineRun[] | Promise<readonly BaselineRun[]>;
  settings: PackSettings;
}

export interface BriefEnv extends AudienceEnv {
  model: LanguageModel;
  modelId: string;
  creative: Creative;
  abortSignal?: AbortSignal;
}

/** Times a world-scoped stage: its own stage events, and calls counted from its own trace steps. */
function worldStages(env: BriefEnv, segmentId: string) {
  const { emit } = env.emitter;
  const tally = { live: 0, cached: 0 };
  const counting: StageEnv["emit"] = (input) => {
    if (input.type === "trace.step" && input.step.kind === "tool") {
      if (input.step.cached) tally.cached++;
      else tally.live++;
    }
    return emit(input);
  };
  let current: Stage = "culture";
  const time = async <T>(stage: Stage, work: () => Promise<T>, carry?: StageStats): Promise<{ result: T; stats: StageStats }> => {
    current = stage;
    const started = env.now();
    const before = { ...tally };
    const result = await work();
    const stats = {
      durationMs: env.now() - started + (carry?.durationMs ?? 0),
      liveCalls: tally.live - before.live + (carry?.liveCalls ?? 0),
      cachedCalls: tally.cached - before.cached + (carry?.cachedCalls ?? 0),
    };
    return { result, stats };
  };
  const started = (stage: Stage) => emit({ type: "stage.started", stage, segmentId });
  const done = (stage: Stage, stats: StageStats) => emit({ type: "stage.done", stage, stats, segmentId });
  return { counting, time, started, done, current: () => current };
}

/**
 * Every real name the run knows, kept out of all wording and prompts (tags are genres, not names). A
 * one-word name written all in lowercase ("everyday") is a common word, not a name a prompt could leak.
 */
export function knownNames(run: Pick<BriefRun, "inputs">, candidates: readonly CultureCandidate[], control: readonly ControlRunMap[]): string[] {
  const names = new Set<string>();
  for (const seed of run.inputs.seeds) if (seed.ref.kind === "entity") names.add(seed.ref.name);
  for (const c of candidates) if (c.kind === "entity") names.add(c.name);
  for (const panel of Object.values(ENTITY_PANELS)) for (const entry of panel) names.add(entry.name);
  for (const map of control) for (const ref of map.references) names.add(ref.text);
  return [...names].filter((name) => /\s/.test(name.trim()) || name !== name.toLowerCase());
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** The scored types in the order the comparison names them. */
const PANEL_TYPES = [
  ["urn:entity:artist", "artists"],
  ["urn:entity:brand", "brands"],
  ["urn:entity:movie", "films"],
  ["urn:entity:tv_show", "TV shows"],
  ["urn:tag:genre:music", "music tags"],
  ["urn:tag:emotional_tone:qloo", "mood tags"],
] as const;

/**
 * How Qloo's own picks placed for one world, per type: the median pick's position against that
 * type's panel (positions only compare within one scoring call, so types are never pooled). A type
 * whose panel came back with fewer than 5 items gets no median.
 */
export function qlooLine(picks: readonly NonNullable<World["check"]>["picks"][number][]): string | null {
  const parts = PANEL_TYPES.flatMap(([type, label]) => {
    const placed = picks.filter((p) => p.from === "qloo" && p.type === type && p.position && p.position.of >= MIN_PANEL_FOR_MEDIAN);
    const beats = median(placed.map((p) => p.position!.beats));
    return beats === null ? [] : [`${label} ${beats} of ${placed[0].position!.of}`];
  });
  return parts.length ? `Qloo's own picks for this world, median against each reference panel: ${parts.join(", ")}` : null;
}

/** The comparison: per world, the Control's fit line next to how Qloo's own picks placed. */
export function compareWorlds(worlds: readonly { segmentId: string; band: string; check: World["check"] }[], fits: readonly ControlFit[]): Comparison | null {
  const lines = worlds.flatMap((world) => {
    const fit = fits.find((f) => f.segmentId === world.segmentId);
    const picks = world.check?.picks ?? [];
    const qloo = qlooLine(picks);
    if (!fit || !qloo) return [];
    const evidenceIds = [...new Set(picks.filter((p) => p.from === "qloo").flatMap((p) => p.evidenceIds))];
    return [{ segmentId: world.segmentId, control: fit.line, qloo, cliches: world.check?.cliches.length ?? 0, evidenceIds }];
  });
  if (lines.length === 0) return null;
  const counted = lines.map((l) => ({ fit: fits.find((f) => f.segmentId === l.segmentId) as ControlFit, band: worlds.find((w) => w.segmentId === l.segmentId)?.band ?? l.segmentId }));
  const same = counted.every(({ fit }) => fit.below === counted[0].fit.below && fit.checkable === counted[0].fit.checkable);
  const missed = same
    ? `${counted[0].fit.below} of ${counted[0].fit.checkable} checkable choices ${counted.length === 1 ? "in this world" : "in each world"}`
    : counted.map(({ fit, band }) => `${fit.below} of ${fit.checkable} checkable choices for ${band}`).join(" and ");
  return { headline: `The generic brief missed ${missed}.`, worlds: lines };
}

export async function runBrief(env: BriefEnv, run: BriefRun): Promise<RunEvent[]> {
  const { emit } = env.emitter;
  const stageEnv: StageEnv = { client: env.client, ctx: env.ctx, emit, reference: env.reference, inReference: env.inReference };
  emit({ type: "run.started", runId: run.runId, kind: run.kind, inputs: run.inputs });
  for (const evidence of run.seedEvidence) emit({ type: "evidence.added", evidence });
  const timer = stageTimer(env);
  try {
    const measured = await measureAudience(stageEnv, run, timer.timed);
    if ("partial" in measured) {
      emit({ type: "run.partial", stage: "prove", reason: measured.partial });
      emit({ type: "run.done" });
      return env.emitter.events;
    }
    const controlRuns = await run.control;
    const control = controlRuns.find((r) => r.run === CONTROL_RUN);
    if (!control) throw new Error(`The run has no Control run ${CONTROL_RUN}.`);
    const runs = [control, ...controlRuns.filter((r) => r.run !== CONTROL_RUN)];
    if (!run.generic) {
      // A live run's Control landed after the Reality Check: send it again with what the generic brief
      // assumed. Same Qloo calls (served from cache), so its trace steps are not repeated.
      const quiet: StageEnv = { ...stageEnv, emit: (input) => (input.type === "trace.step" ? (undefined as never) : emit(input)) };
      // Not timed as a stage again, so the progress rail never steps back to the Reality Check.
      const gap = await realityCheck(quiet, { seeds: run.inputs.seeds, proof: measured.proof, stated: run.stated, site: run.site, generic: genericOf(control) });
      emit({ type: "audience.gap", gap });
      decide(stageEnv, "gap", "Added what the generic AI brief assumed to the Reality Check", "The LLM-only brief was written next to Prove, with no Qloo data.");
    }
    // Run-scoped culture: the audience's creators, and the Control mapped to Qloo once. Neither can
    // stop the run: creators fall back to none, and a refused mapping leaves choices unverifiable.
    const { creators, maps } = await timer.timed("culture", async () => ({
      creators: await sweepCreators(stageEnv, run.inputs.seeds).catch((error: unknown) => {
        if (!(error instanceof QlooBudgetError || error instanceof QlooHttpError || error instanceof QlooShapeError)) throw error;
        decide(stageEnv, "culture", "No creators for this run", `Qloo's people and podcasts could not be read (${error.message}), so creator briefs show no Qloo signal.`);
        return [];
      }),
      maps: await mapControl(stageEnv, runs, run.inputs.seeds),
    }));
    const cBrief = controlBrief(control);
    emit({ type: "control.brief", run: control.run, brief: cBrief, assumed: { ageBands: control.brief.audience.ageBands, cities: control.brief.assumedCities }, mappings: controlMappings(maps[0]) });

    const worldIds = measured.segments.items.map((s) => s.id);
    const cities = chooseSettingCities(
      measured.proof,
      worldIds.map((id) => ({ segmentId: id, cells: measured.raw.get(id)?.heatmap ?? [] })),
      env.reference,
      env.inReference ? { exclude: measured.heatmap } : {},
    );
    const results = await Promise.all([
      ...worldIds.map((id) => runWorld(env, run, measured, id, cities.get(id) ?? null, creators, maps)),
      runControl(env, run, cBrief, maps),
    ]);
    const worlds = results.slice(0, worldIds.length) as WorldOutcome[];
    const comparison = compareWorlds(
      worlds.filter((w): w is WorldOutcome & { fit: ControlFit } => w.fit !== null),
      worlds.flatMap((w) => (w.fit ? [w.fit] : [])),
    );
    if (comparison) emit({ type: "comparison.ready", comparison });
    emit({ type: "run.done" });
  } catch (error) {
    // Hitting the deadline stops the run where it is, resumable: the caller records it, not a failure.
    if (env.abortSignal?.aborted) throw error;
    emit({ type: "run.failed", stage: timer.current(), message: error instanceof Error ? error.message : String(error) });
  }
  return env.emitter.events;
}

/** What the LLM-only Control assumed, in the Reality Check's dimensions. */
export function genericOf(control: BaselineRun): GenericAssumption {
  return { ages: control.brief.audience.ageBands, gender: control.brief.audience.genderSkew, cities: control.brief.assumedCities };
}

interface WorldOutcome {
  segmentId: string;
  label: string;
  band: string;
  check: World["check"];
  fit: ControlFit | null;
}

async function runWorld(
  env: BriefEnv,
  run: BriefRun,
  measured: MeasuredAudience,
  segmentId: string,
  city: SettingCityChoice | null,
  creators: readonly CultureCandidate[],
  maps: readonly ControlRunMap[],
): Promise<WorldOutcome> {
  const segment = measured.segments.items.find((s) => s.id === segmentId)!;
  const raw = measured.raw.get(segmentId)!;
  const stages = worldStages(env, segmentId);
  const wenv = forWorld({ client: env.client, ctx: env.ctx, emit: stages.counting, reference: env.reference, inReference: env.inReference }, segmentId);
  const { emit } = env.emitter;
  const band = ageBandLabel(segment.bucket);
  const outcome: WorldOutcome = { segmentId, label: segment.label, band, check: null, fit: null };
  emit({ type: "world.started", segmentId, label: segment.label });
  try {
    // Culture, part 1: the sweep, in the setting city chosen for this world.
    stages.started("culture");
    const sweep = await stages.time("culture", () => sweepWorld(wenv, { seeds: run.inputs.seeds, bucket: segment.bucket, proof: measured.proof, city }));
    const candidates = [...measuredCandidates(segment, raw, measured.proof), ...sweep.result.candidates, ...creators];

    // The check, which the agent reads.
    stages.started("score");
    const checked = await stages.time("score", () =>
      checkWorld(wenv, {
        seeds: run.inputs.seeds,
        segment,
        candidates,
        control: maps,
        proof: measured.proof,
        segmentCells: raw.heatmap,
        heatmapEvidence: raw.evidence.heatmap,
        parentCells: measured.heatmap,
        reference: env.reference,
      }),
    );
    stages.done("score", checked.stats);
    outcome.check = checked.result.check;
    outcome.fit = checked.result.fit;
    emit({ type: "world.check", segmentId, check: checked.result.check });
    emit({ type: "control.fit", fit: checked.result.fit });

    // Culture, part 2: the agent writes the brief from the scored candidates.
    const names = knownNames(run, checked.result.candidates, maps);
    // Product-only and pet ads have no on-screen person; "auto" lets the brief decide.
    const talent = run.inputs.direction.cast === "auto" || run.inputs.direction.cast === "adult_talent";
    const agent = await stages.time(
      "culture",
      () =>
        runCultureAgent(
          wenv,
          {
            segmentId,
            label: segment.label,
            bucket: segment.bucket,
            seeds: run.inputs.seeds,
            candidates: checked.result.candidates,
            settingCity: sweep.result.settingCity?.label ?? null,
            anchor: sweep.result.anchor,
            product: { name: run.inputs.product.name, oneLine: run.inputs.product.oneLine },
            direction: run.inputs.direction,
            names,
            talent,
            chains: sweep.result.chains,
            sellerText: sellerText(run.inputs.product),
          },
          { model: env.model, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) },
        ),
      sweep.stats,
    );
    const crafted = craftWorld({ segmentId, label: segment.label, bucket: segment.bucket, brief: agent.result.guarded.brief, settingCity: sweep.result.settingCity, productLine: run.inputs.product.oneLine });
    decide(wenv, "culture", `Wrote the Culture Brief for ${band}`, `${agent.result.steps} ${agent.result.steps === 1 ? "step" : "steps"}, ${agent.result.probes} ${agent.result.probes === 1 ? "probe" : "probes"}; ${crafted.richSlots.length} brief fields backed richly by Qloo.`);
    stages.done("culture", agent.stats);
    emit({ type: "world.culture", segmentId, settingCity: sweep.result.settingCity, culture: crafted.culture, brief: crafted.brief, richSlots: crafted.richSlots });

    // The Creative Director, shared with the Control.
    stages.started("concepts");
    const concepts = await stages.time("concepts", async () => {
      const conceptRun = await env.creative.writeConcepts(run.inputs.product, crafted.brief, { model: env.model, modelId: env.modelId, names, direction: run.inputs.direction, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) });
      return env.creative.conceptSet(conceptRun, crafted.brief);
    });
    stages.done("concepts", concepts.stats);
    emit({ type: "world.concepts", segmentId, concepts: concepts.result });

    // The Production Pack and the kit.
    stages.started("prompts");
    const packed = await stages.time("prompts", async () => {
      const concept = concepts.result.best.concept;
      const pack = env.creative.buildPack({ product: run.inputs.product, brief: crafted.brief, concept, settings: run.settings });
      const problems = env.creative.checkPack(pack, crafted.brief, run.inputs.product, names, { richSlots: crafted.richSlots });
      if (problems.length) decide(wenv, "prompts", `The pack for ${band} has ${problems.length} ${problems.length === 1 ? "problem" : "problems"}`, problems.slice(0, 3).map((p) => p.message).join(" "));
      const scripts = env.creative.kitScripts({ product: run.inputs.product, brief: crafted.brief, concept, names });
      const format = env.creative.formatReason(concept);
      decide(wenv, "prompts", `Picked the ${format.format} format for ${band}'s scripts`, format.reason);
      const cityCues = segment.cities.slice(0, 3).map((c) => ({ label: c.label, evidenceIds: c.evidenceIds }));
      const adPlan = env.creative.adPlanEntry({ label: segment.label, ageBands: [segment.bucket], cities: cityCues, concept, evidenceIds: segment.evidenceIds });
      const creatorField = crafted.culture.find((f) => f.field === "creators") ?? null;
      const creatorBrief = env.creative.creatorBrief({ brief: crafted.brief, creators: creatorField, concepts: concepts.result });
      return { pack, kit: { ...scripts, adPlan, creatorBrief } };
    });
    stages.done("prompts", packed.stats);
    emit({ type: "world.pack", segmentId, pack: packed.result.pack, kit: packed.result.kit });
  } catch (error) {
    if (env.abortSignal?.aborted) throw error;
    emit({ type: "world.partial", segmentId, stage: stages.current(), reason: error instanceof Error ? error.message : String(error) });
  }
  return outcome;
}

/** The Control's concepts and pack, from the same writer, templates and settings as every world. */
async function runControl(env: BriefEnv, run: BriefRun, brief: BriefSlots, maps: readonly ControlRunMap[]): Promise<null> {
  const { emit } = env.emitter;
  const stages = worldStages(env, CONTROL_ID);
  const names = knownNames(run, [], maps);
  try {
    stages.started("concepts");
    const concepts = await stages.time("concepts", async () => {
      const conceptRun = await env.creative.writeConcepts(run.inputs.product, brief, { model: env.model, modelId: env.modelId, names, direction: run.inputs.direction, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) });
      return env.creative.conceptSet(conceptRun, brief);
    });
    stages.done("concepts", concepts.stats);
    emit({ type: "control.concepts", concepts: concepts.result });
    stages.started("prompts");
    const packed = await stages.time("prompts", async () => {
      const concept = concepts.result.best.concept;
      const pack = env.creative.buildPack({ product: run.inputs.product, brief, concept, settings: run.settings });
      // The Control has no Qloo-backed slots; its pack still passes the same coverage and guardrail checks.
      const problems = env.creative.checkPack(pack, brief, run.inputs.product, names, { richSlots: [] });
      if (problems.length) decide({ client: env.client, ctx: env.ctx, emit, reference: env.reference, inReference: env.inReference, segmentId: CONTROL_ID }, "prompts", `The generic brief's pack has ${problems.length} ${problems.length === 1 ? "problem" : "problems"}`, problems.slice(0, 3).map((p) => p.message).join(" "));
      const scripts = env.creative.kitScripts({ product: run.inputs.product, brief, concept, names });
      return { pack, kit: { ...scripts, adPlan: null, creatorBrief: null } };
    });
    stages.done("prompts", packed.stats);
    emit({ type: "control.pack", pack: packed.result.pack, kit: packed.result.kit });
  } catch (error) {
    if (env.abortSignal?.aborted) throw error;
    emit({ type: "control.partial", stage: stages.current(), reason: error instanceof Error ? error.message : String(error) });
  }
  return null;
}
