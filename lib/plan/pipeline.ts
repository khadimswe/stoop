// One plan, end to end: the stages in PLAN_STAGES order, each emitting stage.started, its trace steps
// and receipts, its result and stage.done. The same function runs live (from POST /api/plan) and
// offline (scripts/record-plan-example.ts), so an example is exactly what a live run produces.
// Marketing (the poster and the posts) is its own invocation after this (lib/plan/poster*.ts).
//
// Claude calls: the concepts, the plan and the generic plan (each with at most one repair). The
// generic plan needs no Qloo, so it starts next to the city stage and is awaited at its own stage.
import { planDecide, type PlanEnv, type PlanSink } from "./env";
import { textIssues, type GuardContext } from "./guard";
import { guardFor } from "./guard-context";
import { checkPicks, compare, genericCliches, namedPlaces, writeBaseline, type BaselineDraft } from "./baseline";
import { readBlockMusic } from "./block-music";
import { buildPlan } from "./builder";
import { dayContext } from "./calendar";
import { buildAbTest } from "./test-plan";
import { writeConcepts } from "./concepts";
import { readBlock, readCity } from "./local";
import type { Baseline, PlanInputs, PlanStage } from "./schema";

export interface PlanRun {
  runId: string;
  kind: "live" | "example";
  inputs: PlanInputs;
}

export interface PlanOutcome {
  status: "done" | "partial";
  partial: { stage: PlanStage; reason: string } | null;
}

/** Wraps a stage in stage.started and stage.done, with its time and its Qloo calls. */
async function stage<T>(env: PlanEnv, name: PlanStage, now: () => number, work: () => Promise<T>): Promise<T> {
  env.sink.emit({ type: "stage.started", stage: name });
  const started = now();
  const live = env.ctx.liveCalls;
  const cached = env.ctx.cachedCalls;
  const result = await work();
  env.sink.emit({ type: "stage.done", stage: name, stats: { durationMs: Math.max(0, now() - started), liveCalls: env.ctx.liveCalls - live, cachedCalls: env.ctx.cachedCalls - cached } });
  return result;
}

/** The manager's notes reach Claude only when they pass the same guard as generated text. */
export function usableNotes(inputs: PlanInputs, guard: GuardContext): { inputs: PlanInputs; problem: string | null } {
  if (!inputs.notes) return { inputs, problem: null };
  const problems = textIssues(inputs.notes, guard);
  if (problems.length === 0) return { inputs, problem: null };
  const rest: PlanInputs = { ...inputs };
  delete rest.notes;
  return { inputs: rest, problem: problems[0] as string };
}

export { guardFor };

/**
 * Runs every stage up to marketing. It ends without run.done: the caller adds the run's cost (live
 * runs) and then run.done, so the last event is always the caller's.
 */
export async function runPlan(base: PlanEnv, run: PlanRun, options: { now?: () => number } = {}): Promise<PlanOutcome> {
  const now = options.now ?? Date.now;
  // Gaps are collected as they are emitted, so the prompts say plainly what Qloo had no signal for.
  const gaps: string[] = [];
  const sink: PlanSink = {
    emit(input) {
      if (input.type === "local.gap" && !gaps.includes(input.text)) gaps.push(input.text);
      return base.sink.emit(input);
    },
  };
  const env: PlanEnv = { ...base, sink };
  sink.emit({ type: "plan.started", runId: run.runId, kind: run.kind, inputs: run.inputs });
  const stop = (stageName: PlanStage, reason: string): PlanOutcome => {
    sink.emit({ type: "run.partial", stage: stageName, reason });
    return { status: "partial", partial: { stage: stageName, reason } };
  };

  // 1. The store: the inputs are already validated; the notes pass the guard or stay out.
  const inputs = await stage(env, "store", now, async () => {
    const { store, location } = run.inputs;
    planDecide(
      env,
      "store",
      `Planning for ${store.name}, ${store.address}`,
      location
        ? `The event is at ${location.name}, so places are searched around it; taste is read for ${store.city} as a whole.`
        : `Places are searched around the store's own point; taste is read for ${store.city} as a whole.`,
    );
    const { inputs: cleaned, problem } = usableNotes(run.inputs, guardFor(run.inputs));
    if (problem) planDecide(env, "store", "Left the manager's notes out", problem);
    const day = dayContext(run.inputs.date);
    planDecide(env, "store", `Read the day: ${day.label}`, [...day.notes, ...day.hints.map((h) => `Hint only: ${h}`)].join(" ") || "Nothing special about this date.");
    return cleaned;
  });

  // The generic plan needs no Qloo: it starts now and is awaited at its own stage.
  const baselinePromise = writeBaseline(env, inputs, guardFor(inputs));
  baselinePromise.catch(() => undefined);

  // 2. The city, by name, checked against the store's state.
  const { taste: city, query: cityQuery } = await stage(env, "city", now, async () => {
    const read = await readCity(env, inputs);
    if (read.taste) sink.emit({ type: "local.city", city: read.taste });
    return read;
  });

  // 3. The block, around the store's point, and the music its own places point to (a tested option).
  const { block, blockMusic } = await stage(env, "block", now, async () => {
    const found = await readBlock(env, inputs);
    if (found) sink.emit({ type: "local.block", block: found });
    const music = await readBlockMusic(env, inputs, found, city);
    if (music) sink.emit({ type: "local.blockMusic", blockMusic: music });
    return { block: found, blockMusic: music };
  });

  const local = { city, block, gaps, blockMusic };
  const offered = blockMusic?.used ? blockMusic.artists : [];
  const known = [...(city?.artists.map((a) => a.id) ?? []), ...offered.map((a) => a.id), ...(block?.places.map((p) => p.id) ?? [])];
  if (known.length === 0 && (city?.styles.length ?? 0) === 0) {
    return stop("block", "Qloo had no signal for this store's city or block, so there is nothing to plan from.");
  }
  const names = [...(city?.artists.map((a) => a.name) ?? []), ...offered.map((a) => a.name), ...(block?.places.map((p) => p.name) ?? [])];
  const guard = guardFor(inputs, known, names);

  // 4. Three concepts, scored; the best is kept.
  const written = await stage(env, "concepts", now, async () => {
    const outcome = await writeConcepts(env, inputs, local, guard);
    if (outcome) sink.emit({ type: "plan.concepts", concepts: outcome.concepts });
    return outcome;
  });
  if (!written) return stop("concepts", "Claude's concepts could not be used. The city and the block above are still Qloo's.");

  // 5. The plan for the kept concept.
  const plan = await stage(env, "plan", now, async () => {
    const built = await buildPlan(env, inputs, written.concepts, written.aliases, guard);
    sink.emit({ type: "plan.ready", plan: built });
    // A fair test of the kept concept against the runner-up, written before anything runs.
    const test = buildAbTest(inputs, built.concepts);
    if (test) {
      sink.emit({ type: "test.ready", test });
      planDecide(env, "plan", `Wrote a test: "${test.variants[0].label}" against "${test.variants[1].label}"`, `${test.decisionRule} ${test.caveat}`);
    }
    return built;
  });

  // 6. The generic plan, its cliches and Qloo's check of its picks; then the side by side.
  let baselinePlaces: string[] = [];
  const baseline = await stage(env, "baseline", now, async (): Promise<Baseline | null> => {
    let draft: BaselineDraft | null = null;
    try {
      const written = await baselinePromise;
      draft = written.draft;
      for (const note of written.notes) planDecide(env, "baseline", "Asked Claude again for the generic plan", note);
    } catch (error) {
      if (env.abortSignal?.aborted) throw error;
      draft = null;
    }
    if (!draft) return null;
    planDecide(env, "baseline", "Wrote the generic plan with no Qloo", "The same facts and the same model, with no city or block data: every line is a creative suggestion.");
    const picks = await checkPicks(env, inputs, city, draft.picks, cityQuery);
    for (const line of picks?.lines ?? []) planDecide(env, "baseline", "Checked a generic pick against Qloo", line);
    const check = picks?.check ?? null;
    const named = namedPlaces(draft.picks.places, block, env.knownChains);
    if (draft.picks.places.length) planDecide(env, "baseline", `Checked the ${named.named} ${named.named === 1 ? "place" : "places"} the generic plan named`, `${named.chains} ${named.chains === 1 ? "is a chain" : "are chains"}; ${named.onBlock} ${named.onBlock === 1 ? "is" : "are"} on Qloo's list for this block.`);
    baselinePlaces = draft.picks.places;
    const cliches = [...draft.cliches, ...genericCliches(draft.items, check, block?.places.map((p) => p.name) ?? [], city?.city ?? inputs.store.city, named)];
    if (cliches.length) planDecide(env, "baseline", `Flagged ${cliches.length} generic ${cliches.length === 1 ? "choice" : "choices"} in the generic plan`, cliches.map((c) => `${c.text}: ${c.why}`).join(" "));
    const result: Baseline = { items: draft.items, cliches, check };
    sink.emit({ type: "baseline.ready", baseline: result });
    return result;
  });
  const kept = plan.concepts.find((c) => c.id === plan.conceptId) ?? null;
  sink.emit({
    type: "comparison.ready",
    comparison: compare({ kept, plan, baseline, block, blockMusic, baselinePlaces, ...(env.knownChains ? { knownChains: env.knownChains } : {}), city: city?.city ?? inputs.store.city, where: inputs.location ? inputs.location.name : "the store" }),
  });
  if (!baseline) return stop("baseline", "The generic plan could not be written, so the side by side has only this plan.");
  return { status: "done", partial: null };
}
