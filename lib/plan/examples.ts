// The example stores and their recorded runs (data/plans/<slug>/plan.events.json and
// plan.report.json), read from disk on the server: zero API calls, always there. Server and scripts
// only (it reads files); a client component imports the list from ./example-list instead.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { planEventSchema, type PlanEvent } from "./events";
import { planReportSchema, type PlanReport } from "./schema";

export * from "./example-list";
import type { PlanExampleSlug } from "./example-list";

export const PLANS_DIR = path.join("data", "plans");

const file = (slug: PlanExampleSlug, name: string, root = process.cwd()) => path.join(root, PLANS_DIR, slug, name);

async function readJson(slug: PlanExampleSlug, name: string, root?: string): Promise<unknown> {
  return JSON.parse(await readFile(file(slug, name, root), "utf8"));
}

/** An example's recorded events, checked against the event schema. */
export async function loadExampleEvents(slug: PlanExampleSlug, root?: string): Promise<PlanEvent[]> {
  const raw = await readJson(slug, "plan.events.json", root);
  return planEventSchema.array().parse(raw);
}

/** An example's recorded report, checked against the report schema. */
export async function loadExampleReport(slug: PlanExampleSlug, root?: string): Promise<PlanReport> {
  return planReportSchema.parse(await readJson(slug, "plan.report.json", root));
}

/** The file of names the recorded runs found on more than one store's block (scripts/record-plan-chains.ts). */
export const KNOWN_CHAINS_FILE = "known-chains.json";

/** The known-chain names, normalized; throws when the file is missing. */
export async function readKnownChains(root = process.cwd()): Promise<Set<string>> {
  const raw = JSON.parse(await readFile(path.join(root, PLANS_DIR, KNOWN_CHAINS_FILE), "utf8")) as { names?: unknown };
  return new Set(Array.isArray(raw.names) ? raw.names.filter((n): n is string => typeof n === "string") : []);
}

/** Both files of one example. */
export async function loadPlanExample(slug: PlanExampleSlug, root?: string): Promise<{ events: PlanEvent[]; report: PlanReport }> {
  const [events, report] = await Promise.all([loadExampleEvents(slug, root), loadExampleReport(slug, root)]);
  return { events, report };
}
