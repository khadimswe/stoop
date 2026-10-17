// What storyboard frames and revisions share: they run after a run's own work, as their own
// invocations, and add to the run's events, receipts and cost under the store's rules
// (lib/store/runs.ts). Zero Qloo calls here.
//   countingModel  wraps the Claude model to count calls and tokens for the cost record
//   addRunCost     adds a frames or revise job's cost to the run's last cost, as a new run.cost
//   reportNames    every real name a report knows, kept out of rewritten prompts and notes
import { wrapLanguageModel, type LanguageModel } from "ai";
import { ENTITY_PANELS } from "../culture/panels";
import { reduce, type RunEvent } from "../events";
import type { Cost, Report } from "../report/schema";
import { appendRunEvents, readRunEvents } from "../store/runs";
import type { Store } from "../store/types";

export interface ClaudeTally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export const emptyTally = (): ClaudeTally => ({ calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

/** The same model, counting every call it answers and the tokens it reports (for the run's cost record). */
export function countingModel(model: LanguageModel, tally: ClaudeTally = emptyTally()): { model: LanguageModel; tally: ClaudeTally } {
  if (typeof model === "string") return { model, tally };
  const wrapped = wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        tally.calls++;
        tally.inputTokens += result.usage?.inputTokens?.total ?? 0;
        tally.outputTokens += result.usage?.outputTokens?.total ?? 0;
        tally.cachedInputTokens += result.usage?.inputTokens?.cacheRead ?? 0;
        return result;
      },
    },
  });
  return { model: wrapped, tally };
}

/** What one frames or revise job adds to the run's cost. */
export interface CostDelta {
  durationMs: number;
  qloo: { live: number; cached: number };
  claude: ClaudeTally;
  frames: number;
  estimateUsd: number;
}

export const emptyDelta = (): CostDelta => ({ durationMs: 0, qloo: { live: 0, cached: 0 }, claude: emptyTally(), frames: 0, estimateUsd: 0 });

export function addCost(cost: Cost, delta: CostDelta): Cost {
  return {
    durationMs: cost.durationMs + delta.durationMs,
    qloo: { live: cost.qloo.live + delta.qloo.live, cached: cost.qloo.cached + delta.qloo.cached },
    claude: {
      calls: cost.claude.calls + delta.claude.calls,
      inputTokens: cost.claude.inputTokens + delta.claude.inputTokens,
      outputTokens: cost.claude.outputTokens + delta.claude.outputTokens,
      cachedInputTokens: cost.claude.cachedInputTokens + delta.claude.cachedInputTokens,
    },
    frames: cost.frames + delta.frames,
    // Rounded to a tenth of a cent, so repeated additions never print as 0.38000000000000006.
    estimateUsd: Math.round((cost.estimateUsd + delta.estimateUsd) * 1000) / 1000,
  };
}

const costEvents = (events: readonly RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "run.cost" }> => e.type === "run.cost").sort((a, b) => a.seq - b.seq);

/**
 * Adds a job's cost to the run's last cost (the latest run.cost by seq) and appends the new total.
 * Nothing is appended while the run has no cost yet: the runtime's own final cost covers what lands
 * before it. Two jobs finishing at once could each add to the same total; after appending, a job that
 * finds an earlier concurrent total it did not include appends one correction, so the highest seq
 * holds both (best effort: the store has no compare-and-set).
 */
export async function addRunCost(store: Store, runId: string, attempt: number, delta: CostDelta, now?: () => Date): Promise<Cost | null> {
  const isEmpty = delta.frames === 0 && delta.claude.calls === 0 && delta.qloo.live === 0 && delta.qloo.cached === 0;
  if (isEmpty) return null;
  const before = costEvents(await readRunEvents(store, runId, attempt));
  const base = before.at(-1);
  if (!base) return null;
  const total = addCost(base.cost, delta);
  const [mine] = await appendRunEvents(store, runId, attempt, [{ type: "run.cost", cost: total }], now);
  const after = costEvents(await readRunEvents(store, runId, attempt));
  const missed = after.filter((e) => e.seq > base.seq && e.seq < mine.seq);
  if (missed.length === 0) return total;
  // Each concurrent total is its writer's delta on the same base; fold the latest one into ours.
  const theirs = missed.at(-1)!.cost;
  const merged: Cost = addCost(theirs, delta);
  await appendRunEvents(store, runId, attempt, [{ type: "run.cost", cost: merged }], now);
  return merged;
}

/** The run's current state from its event list (the stored report lags until the run ends). */
export async function runState(store: Store, runId: string, attempt: number) {
  return reduce(await readRunEvents(store, runId, attempt));
}

/** A one-word name in lowercase ("everyday") is a common word, not a name a prompt could leak. */
const isName = (name: string) => /\s/.test(name.trim()) || name !== name.toLowerCase();

/**
 * Every real name a stored run knows: seeds, segment artists and brands, every world's Qloo sources
 * and scored picks, the frozen panels and the generic brief's references (as lib/agent/orchestrator.ts
 * knownNames gathers them during the run).
 */
export function reportNames(report: Pick<Report, "inputs" | "audience" | "worlds"> & { control: Pick<NonNullable<Report["control"]>, "mappings"> | null }): string[] {
  const names = new Set<string>();
  for (const seed of report.inputs.seeds) if (seed.ref.kind === "entity") names.add(seed.ref.name);
  for (const segment of report.audience.segments?.items ?? []) for (const ref of [...segment.artists, ...segment.brands]) names.add(ref.name);
  for (const world of report.worlds) {
    for (const field of world.culture ?? []) for (const source of field.sources) if (source.kind === "entity") names.add(source.name);
    for (const pick of world.check?.picks ?? []) if (pick.kind === "entity") names.add(pick.name);
    for (const revision of world.revisions) for (const field of revision.culture) for (const source of field.sources) if (source.kind === "entity") names.add(source.name);
  }
  for (const panel of Object.values(ENTITY_PANELS)) for (const entry of panel) names.add(entry.name);
  for (const mapping of report.control?.mappings ?? []) {
    if (mapping.dimension !== "reference") continue;
    names.add(mapping.text);
    if (mapping.ref) names.add(mapping.ref.name);
  }
  return [...names].filter(isName);
}

/** n random bytes as lowercase hex (revision ids). */
export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
