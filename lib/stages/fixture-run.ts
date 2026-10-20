// Test-only: a recorded example run (data/runs/<slug>) stored as if it were a finished live run, so
// frames and revisions are tested on real recorded worlds with the real store rules. Imported from
// *.test.ts files only.
import { readFileSync } from "node:fs";
import type { RunEvent } from "../events";
import type { Cost, Report } from "../report/schema";
import { keys, TTL } from "../store/keys";
import { appendRunEvents, setRunMeta } from "../store/runs";
import type { Store } from "../store/types";

export const LIVE_RUN_ID = `run_${"a1".repeat(12)}`;
export const AT = "2026-10-17T12:00:00.000Z";

export const exampleEvents = (slug = "food-hot-sauce") => JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];
export const exampleReport = (slug = "food-hot-sauce") => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

/**
 * A real name the run knows: the top world's first music source (an artist Qloo returned). Tests that
 * check real names are refused read it from the recording, so no Qloo name is written into a test.
 */
export function knownArtist(report: Pick<Report, "worlds">): string {
  const source = report.worlds[0]?.culture?.find((f) => f.field === "music")?.sources.find((s) => s.kind === "entity");
  if (!source) throw new Error("The recorded report has no music artist in its top world.");
  return source.name;
}

export const BASE_COST: Cost = {
  durationMs: 48_000,
  qloo: { live: 31, cached: 4 },
  claude: { calls: 6, inputTokens: 40_000, outputTokens: 18_000, cachedInputTokens: 9_000 },
  frames: 0,
  estimateUsd: 0.38,
};

/** Writes the example's events as one attempt of a live run, with its meta and seq counter, plus an optional final cost. */
export async function storeExampleRun(
  store: Store,
  options: { runId?: string; attempt?: number; status?: "running" | "stopped" | "done" | "failed"; slug?: string; cost?: Cost | null } = {},
): Promise<{ runId: string; attempt: number; events: RunEvent[] }> {
  const runId = options.runId ?? LIVE_RUN_ID;
  const attempt = options.attempt ?? 1;
  // The run starts as a live run under this id, so its stored report lands under it too.
  const events = exampleEvents(options.slug)
    .map((e) => (e.type === "run.started" ? { ...e, runId, kind: "live" as const } : e))
    .map((e) => (attempt > 1 ? { ...e, attempt } : e));
  await setRunMeta(store, { runId, attempt, status: options.status ?? "done", briefHash: "b".repeat(64), createdAt: AT, updatedAt: AT });
  await store.append(keys.run.events(runId, attempt), events, { ttlSeconds: TTL.runEvents });
  await store.incr(keys.run.seq(runId, attempt), { by: events.length, ttlSeconds: TTL.runEvents });
  if (options.cost !== null) await appendRunEvents(store, runId, attempt, [{ type: "run.cost", cost: options.cost ?? BASE_COST }], () => new Date(AT));
  return { runId, attempt, events };
}
