// The plan runtime bound to its real vendors, for the routes: the shared store, the server's Qloo
// client and Claude. `server-only`: keys never reach a browser bundle. Each vendor is built only when a
// route needs it, so replay mode (STOOP_LIVE off) needs none.
import "server-only";
import { getBotCheck } from "../bot-check";
import { getQlooClient } from "../qloo/server";
import { liveModel } from "../runtime/server";
import { getStore } from "../store";
import type { PlanRouteDeps } from "./routes";
import { executePlan } from "./runtime";
import { loadExampleReport, PLAN_EXAMPLES, readKnownChains } from "./examples";
import { repeatedPlaceNames } from "./taste";

let chains: Promise<ReadonlySet<string>> | null = null;

/**
 * Names found on more than one recorded store's block (data/plans/known-chains.json, written by
 * scripts/record-plan-chains.ts from the examples and the proof runs): a business with several
 * branches is a chain. Without the file, the examples' own blocks.
 */
function knownChains(): Promise<ReadonlySet<string>> {
  chains ??= readKnownChains().catch(() =>
    Promise.all(PLAN_EXAMPLES.map((e) => loadExampleReport(e.slug).catch(() => null))).then((reports) => repeatedPlaceNames(reports.flatMap((r) => (r?.local.block ? [r.local.block] : [])))),
  ).catch(() => new Set<string>());
  return chains;
}

/** One live plan, bound to its vendors. Runs inside `after()`. */
export async function execute(runId: string): Promise<void> {
  return executePlan({ store: getStore(), client: getQlooClient(), model: liveModel(), knownChains: await knownChains() }, runId);
}

export const planRouteDeps = (): PlanRouteDeps => ({
  store: () => getStore(),
  start: () => ({ execute }),
  botCheck: getBotCheck,
});
