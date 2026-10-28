// Records an example store's plan: the pipeline runs live once (Qloo through record mode, capped at
// PLAN_CAP; Claude through the recording middleware), its new Qloo answers go to
// fixtures/plan-<slug>.json and its Claude answers to fixtures/llm/plan-<slug>.json, and the run's
// events and reduced report go to data/plans/<slug>/. Then it replays the run strictly from those
// recordings (no key, no network) and checks the replay lands on the same plan, so the example can
// always be rebuilt and tested offline.
//
// Recorded runs are never rewritten: to re-record one before it is approved, delete its
// data/plans/<slug>/ folder (and its fixtures, for fresh answers) and run again.
//
// Every path is relative to this repository (the script's own folder), not the working directory,
// so it can run from another checkout that holds the keys:
//   npx tsx scripts/record-plan-example.ts <slug>... | --all [--replay-only]
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LlmStore, recordingModel, replayModel } from "../lib/agent/llm-replay";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { PLAN_BUDGET, PLAN_CAP } from "../lib/qloo/budget";
import { createQlooClient, type QlooClient } from "../lib/qloo/client";
import { createRunContext } from "../lib/qloo/context";
import { FixtureCache, findFixture, loadFixtures } from "../lib/qloo/fixtures";
import { RecordingCache } from "../lib/qloo/recording";
import { createPlanEmitter, reducePlan, toPlanReport, type PlanEvent } from "../lib/plan/events";
import { examplePlanId, PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES, type PlanExampleSlug } from "../lib/plan/example-list";
import { runPlan } from "../lib/plan/pipeline";
import type { PlanReport } from "../lib/plan/schema";
import type { LanguageModel } from "ai";
import { loadLocalEnv } from "./env";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "fixtures");
const LLM_DIR = path.join(FIXTURES, "llm");
const planDir = (slug: string) => path.join(ROOT, "data", "plans", slug);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** JSON for committed files: U+2014 inside Qloo's names is written as an escape so the em dash scan stays clean. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

async function runOnce(slug: PlanExampleSlug, client: QlooClient, model: LanguageModel): Promise<{ events: PlanEvent[]; report: PlanReport; live: number }> {
  const runId = examplePlanId(slug);
  const ctx = createRunContext({ runId, cap: PLAN_CAP, rowCaps: PLAN_BUDGET });
  const emit = createPlanEmitter();
  const events: PlanEvent[] = [];
  const sink = { emit: (input: Parameters<typeof emit>[0]) => {
    const event = emit(input);
    events.push(event);
    return event;
  } };
  await runPlan({ client, ctx, sink, model }, { runId, kind: "example", inputs: PLAN_EXAMPLE_INPUTS[slug] });
  sink.emit({ type: "run.done" });
  return { events, report: toPlanReport(reducePlan(events)), live: ctx.liveCalls };
}

/** What a replay must reproduce: everything but timings and receipts' fetch metadata. */
const essence = (report: PlanReport) => JSON.stringify({ local: report.local, plan: report.plan, baseline: report.baseline, comparison: report.comparison });

async function record(slug: PlanExampleSlug): Promise<void> {
  if (existsSync(path.join(planDir(slug), "plan.report.json"))) fail(`data/plans/${slug}/plan.report.json exists. Recorded runs are never rewritten: delete plan.events.json and plan.report.json first to re-record it.`);
  loadLocalEnv();
  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) fail("QLOO_API_KEY missing. Run this from a checkout whose local env file holds it (never commit it).");
  if (!process.env.ANTHROPIC_API_KEY?.trim()) fail("ANTHROPIC_API_KEY missing. Run this from a checkout whose local env file holds it.");
  const cache = new RecordingCache(loadFixtures(FIXTURES));
  const client = createQlooClient({ apiKey, cache });
  const modelId = stoopModelId();
  const llm = LlmStore.named(`plan-${slug}`, LLM_DIR);
  const model = recordingModel(Object.assign(stoopModel(modelId), { modelId }), llm);
  const started = Date.now();
  const { events, report, live } = await runOnce(slug, client, model);
  let name = `plan-${slug}`;
  for (let n = 2; findFixture(name, FIXTURES); n++) name = `plan-${slug}-${n}`;
  const fixture = await cache.save(name, `Store events: the Qloo calls the ${slug} example plan made live.`, { secret: apiKey, dir: FIXTURES });
  llm.prune();
  llm.save();
  await mkdir(planDir(slug), { recursive: true });
  await writeFile(path.join(planDir(slug), "plan.events.json"), json(events));
  await writeFile(path.join(planDir(slug), "plan.report.json"), json(report));
  console.log(`${slug}: recorded in ${((Date.now() - started) / 1000).toFixed(1)} s, ${live} live Qloo calls, ${cache.size} new answers${fixture ? ` (${path.relative(ROOT, fixture)})` : ""}, Claude answers in ${path.relative(ROOT, llm.file)}`);
  summarize(slug, report);
  await verifyReplay(slug, report);
}

/** Runs the example again from the recordings only and checks it lands on the same plan. */
async function verifyReplay(slug: PlanExampleSlug, expected: PlanReport): Promise<void> {
  const client = createQlooClient({ cache: FixtureCache.fromDir(FIXTURES, { strict: true }) });
  const modelId = stoopModelId({});
  const model = replayModel(Object.assign(stoopModel(modelId), { modelId }), LlmStore.named(`plan-${slug}`, LLM_DIR));
  const { report } = await runOnce(slug, client, model);
  if (essence(report) !== essence(expected)) fail(`${slug}: the offline replay did not reproduce the recorded plan.`);
  console.log(`${slug}: the offline replay reproduces the recorded plan.`);
}

function summarize(slug: string, report: PlanReport): void {
  const kept = report.plan?.concepts.find((c) => c.kept);
  const city = report.local.city;
  const block = report.local.block;
  console.log(`  city: ${city ? `${city.artists.length} artists, ${city.styles.length} styles (${city.styles.map((s) => s.name).join(", ")})` : "none"}`);
  console.log(`  block: ${block ? `${block.places.length} places (${block.places.map((p) => `${p.name} [${p.kind}]`).slice(0, 8).join(", ")})` : "none"}`);
  console.log(`  gaps: ${report.local.gaps.join(" | ") || "none"}`);
  console.log(`  kept: ${kept ? `${kept.title} (${kept.total})` : "none"}; concepts ${report.plan?.concepts.map((c) => `${c.title}=${c.total}`).join(", ")}`);
  console.log(`  plan: ${report.plan?.runOfShow.length ?? 0} steps, ${report.plan?.shopping.length ?? 0} buys, $${report.plan?.estimatedCostUsd ?? 0}`);
  console.log(`  baseline: ${report.baseline ? `${report.baseline.items.length} lines, ${report.baseline.cliches.length} cliches, check ${JSON.stringify(report.baseline.check && { ...report.baseline.check, evidenceIds: undefined })}` : "none"}`);
  console.log(`  partial: ${report.partial ? `${report.partial.stage}: ${report.partial.reason}` : "no"}; ${report.ledger.length} receipts, ${report.trace.length} trace steps`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugs = args.includes("--all") ? PLAN_EXAMPLES.map((e) => e.slug) : args.filter((a) => !a.startsWith("--"));
  if (slugs.length === 0) fail("Usage: npx tsx scripts/record-plan-example.ts <slug>... | --all [--replay-only]");
  for (const slug of slugs) {
    if (!PLAN_EXAMPLES.some((e) => e.slug === slug)) fail(`"${slug}" is not a plan example. Examples: ${PLAN_EXAMPLES.map((e) => e.slug).join(", ")}.`);
    if (args.includes("--replay-only")) {
      const { loadExampleReport } = await import("../lib/plan/examples");
      await verifyReplay(slug as PlanExampleSlug, await loadExampleReport(slug as PlanExampleSlug, ROOT));
    } else {
      await record(slug as PlanExampleSlug);
    }
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));
