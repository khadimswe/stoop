// Proof lab, step 3: run Lane A's plan pipeline, unchanged, once per proof store with the template
// inputs (lib/plan/pipeline.ts runPlan; the same call scripts/record-plan-example.ts makes). Only the
// store differs between runs: its address, its city name for Qloo and its map point.
//
// Per store it writes data/proof/runs/<id>/:
//   plan.report.json   the reduced plan report (Stoop's plan, the generic plan, the comparison)
//   generic.json       the generic plan's structured answers as Claude returned them, including the
//                      real artists and food brands it said it leans on (kept for scoring only and
//                      never shown in the plan, so the report does not carry them)
//   meta.json          the pipeline commit, the model, Qloo calls, the locality Qloo resolved, timing
// and records the Qloo answers it fetched to data/proof/fixtures/proof-run-<id>.json and Claude's
// answers to data/proof/llm/proof-<id>.json, so every run replays offline (--replay-only).
// A finished run is never rewritten: delete its folder to run it again.
//
//   cd /Users/khadim/Stoop && npx tsx <worktree>/scripts/proof-run.ts <id>... | --set task1|task2|all [--replay-only] [--concurrency 3] [--repeat 2]
// --repeat N runs the same store again with fresh Claude answers (runs/<id>-rN), for model variance.
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { PLAN_BUDGET, PLAN_CAP } from "../lib/qloo/budget";
import { createRunContext } from "../lib/qloo/context";
import { createLimiter } from "../lib/qloo/limiter";
import { createPlanEmitter, reducePlan, toPlanReport, type PlanEvent } from "../lib/plan/events";
import { runPlan } from "../lib/plan/pipeline";
import type { PlanReport } from "../lib/plan/schema";
import { loadLocalEnv } from "./env";
import { exists, json, loadStores, PROOF_FIXTURES, PROOF_RUNS, proofModel, readJson, recordingClient, replayClient, resolvedLocality, ROOT, templateInputs, type ProofStore } from "./proof-lib";

const git = (args: string) => execSync(`git -C "${ROOT}" ${args}`, { encoding: "utf8" }).trim();

/** What a replay must reproduce: everything but timings and receipts' fetch metadata. */
const essence = (report: PlanReport) => JSON.stringify({ local: report.local, plan: report.plan, baseline: report.baseline, comparison: report.comparison });

async function runStore(store: ProofStore, options: { apiKey: string; limiter: ReturnType<typeof createLimiter>; replayOnly: boolean; repeat?: number }): Promise<void> {
  // A repeat is the same store and inputs with fresh Claude answers (its own answer file), for model
  // variance; Qloo's answers replay from the first run's recording.
  const key = options.repeat ? `${store.id}-r${options.repeat}` : store.id;
  const dir = path.join(PROOF_RUNS, key);
  const reportFile = path.join(dir, "plan.report.json");
  if (!options.replayOnly && exists(reportFile)) {
    console.log(`${key}: already run, skipped (delete ${path.relative(ROOT, dir)} to run it again)`);
    return;
  }
  const inputs = templateInputs(store);
  const qloo = options.replayOnly ? { ...replayClient(), recording: null } : recordingClient(options.apiKey, options.limiter);
  const { model, captured, store: llm, modelId } = proofModel(`proof-${key}`, { replayOnly: options.replayOnly });
  const runId = `proof-${key}`;
  const ctx = createRunContext({ runId, cap: PLAN_CAP, rowCaps: PLAN_BUDGET });
  const emit = createPlanEmitter();
  const events: PlanEvent[] = [];
  const sink = {
    emit: (input: Parameters<typeof emit>[0]) => {
      const event = emit(input);
      events.push(event);
      return event;
    },
  };
  const started = Date.now();
  const outcome = await runPlan({ client: qloo.client, ctx, sink, model }, { runId, kind: "live", inputs });
  sink.emit({ type: "run.done" });
  const report = toPlanReport(reducePlan(events));
  const seconds = (Date.now() - started) / 1000;

  if (options.replayOnly) {
    const recorded = readJson<PlanReport>(reportFile);
    console.log(`${key}: offline replay ${essence(report) === essence(recorded) ? "reproduces" : "DOES NOT reproduce"} the recorded run`);
    return;
  }

  const localities = new Map<string, ReturnType<typeof resolvedLocality>>();
  for (const { request, entry } of qloo.cache.seen.values()) {
    if (!request?.includes("signal.location.query")) continue;
    const q = new URLSearchParams(request.slice(request.indexOf("?") + 1)).get("signal.location.query");
    if (q) localities.set(q, resolvedLocality(entry.body));
  }
  const generic = captured.filter((c) => c.name === "generic_event_plan").map((c) => {
    try {
      return JSON.parse(c.text) as unknown;
    } catch {
      return { unparsed: c.text };
    }
  });
  await mkdir(dir, { recursive: true });
  await mkdir(PROOF_FIXTURES, { recursive: true });
  const fixture = await qloo.recording?.save(`proof-run-${key}`, `Proof lab: the Qloo calls the ${key} proof plan made live.`, { secret: options.apiKey, dir: PROOF_FIXTURES });
  llm.prune();
  llm.save();
  await writeFile(reportFile, json(report));
  await writeFile(path.join(dir, "generic.json"), json({ note: "The generic plan's answers as Claude returned them, in order (the last one with 4 or more usable lines is the plan). picks are kept for scoring only.", answers: generic }));
  await writeFile(
    path.join(dir, "meta.json"),
    json({
      store: store.id,
      repeat: options.repeat ?? 1,
      area: store.area,
      ranAt: new Date().toISOString(),
      head: git("rev-parse --short HEAD"),
      pipelineCommit: git("log -1 --format=%h -- lib/plan lib/qloo"),
      modelId,
      qlooLiveCalls: ctx.liveCalls,
      qlooCachedCalls: ctx.cachedCalls,
      claudeAnswers: captured.length,
      seconds,
      status: outcome.status,
      partial: outcome.partial,
      localities: Object.fromEntries(localities),
      fixture: fixture ? path.relative(ROOT, fixture) : null,
      inputs,
    }),
  );
  const kept = report.plan?.concepts.find((c) => c.kept);
  console.log(`${key}: ${outcome.status} in ${seconds.toFixed(0)} s, ${ctx.liveCalls} live Qloo calls, ${captured.length} Claude answers; city ${[...localities.values()].map((l) => l?.disambiguation).join(" / ")}; kept "${kept?.title ?? "none"}"`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replayOnly = args.includes("--replay-only");
  const setArg = args.includes("--set") ? args[args.indexOf("--set") + 1] : null;
  const concurrency = args.includes("--concurrency") ? Number(args[args.indexOf("--concurrency") + 1]) : 3;
  const repeat = args.includes("--repeat") ? Number(args[args.indexOf("--repeat") + 1]) : undefined;
  const stores = loadStores();
  const ids = setArg
    ? stores.filter((s) => setArg === "all" || s.sets.includes(setArg as ProofStore["sets"][number])).map((s) => s.id)
    : args.filter((a) => !a.startsWith("--") && stores.some((s) => s.id === a));
  if (ids.length === 0) throw new Error(`Usage: proof-run.ts <id>... | --set task1|task1-robustness|task2|all. Stores: ${stores.map((s) => s.id).join(", ")}`);
  loadLocalEnv();
  const apiKey = process.env.QLOO_API_KEY?.trim() ?? "";
  if (!replayOnly && !apiKey) throw new Error("No Qloo key loaded: run from the Stoop checkout.");
  if (!replayOnly && !process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("No Anthropic key loaded: run from the Stoop checkout.");
  const limiter = createLimiter();
  const limit = pLimit(Math.max(1, concurrency));
  const failures: string[] = [];
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        try {
          await runStore(stores.find((s) => s.id === id) as ProofStore, { apiKey, limiter, replayOnly, ...(repeat ? { repeat } : {}) });
        } catch (error) {
          failures.push(id);
          console.error(`${id}: failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    ),
  );
  if (failures.length) {
    console.error(`failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
