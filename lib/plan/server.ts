// The plan runtime bound to its real vendors, for the routes: the shared store, the server's Qloo
// client and Claude. `server-only`: keys never reach a browser bundle. Each vendor is built only when a
// route needs it, so replay mode (STOOP_LIVE off) needs none.
import "server-only";
import { getBotCheck } from "../bot-check";
import { getQlooClient } from "../qloo/server";
import { liveModel } from "../runtime/server";
import { getStore } from "../store";
import type { TokenVisitorId, VisitorId } from "../store/visitor";
import { marketingJob } from "./marketing-server";
import { autoMarketing } from "./posts-run";
import { storePlanSource } from "./posts-store";
import type { PlanRouteDeps } from "./routes";
import { executePlan } from "./runtime";
import { getPlanMeta } from "./store";
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

/** POST /api/plan's maxDuration (300 s), less a margin: the plan and its marketing share it. */
const INVOCATION_MS = 290_000;

/**
 * One live plan, bound to its vendors. Runs inside `after()`. When the plan finishes, its poster and
 * posts start right here (lib/plan/posts-run.ts autoMarketing), so nobody has to ask for them.
 */
export async function execute(runId: string): Promise<void> {
  const began = Date.now();
  const store = getStore();
  await executePlan({ store, client: getQlooClient(), model: liveModel(), knownChains: await knownChains() }, runId);
  try {
    const meta = await getPlanMeta(store, runId);
    if (!meta || (meta.status !== "done" && meta.status !== "partial")) return;
    const visitor = meta.visitor ? (meta.visitor as VisitorId | TokenVisitorId) : null;
    await autoMarketing({ store, source: storePlanSource(store), visitor, remainingMs: began + INVOCATION_MS - Date.now(), job: marketingJob }, runId);
  } catch (error) {
    console.error(`[plan ${runId}] marketing did not start: ${error instanceof Error ? error.name : "error"}`);
  }
}

export const planRouteDeps = (): PlanRouteDeps => ({
  store: () => getStore(),
  start: () => ({ execute }),
  botCheck: getBotCheck,
});
