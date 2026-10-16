// Generates the LLM-only Control briefs for the candidate pool, several runs each, so the report can
// show how a brief written without Qloo varies from run to run. Then, for run 1 (the Control, fixed in
// advance), it writes the 3 concepts with the same concept writer the Qloo path uses.
//
//   npm run baseline -- <slug>|--all [--runs 3] [--force] [--reroll-control --because "<reason>"]
//
// Writes data/baselines/<slug>/run-<n>.json and concepts.json, and skips runs that already exist
// unless --force. Run 1 (the Control) is replaced only with --reroll-control, and never once its pack
// is frozen. Concepts are rewritten whenever they no longer match run 1 (their input hash differs).
// Spends real Anthropic calls: at most 40 per invocation (each step takes 1 call, or 2 with a repair),
// and it stops before a step could cross that cap. Prints one summary line per step, never responses.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASELINE_MAX_ATTEMPTS, BaselineError, baselineNames, baselineRunSchema, generateBaseline } from "../lib/agent/baseline";
import { candidateDirection, candidateProduct, CONTROL_RUN, controlBrief } from "../lib/agent/baseline-brief";
import { conceptsFile, fitsCap, frozenPackFile, planRuns, runFile } from "../lib/agent/baseline-jobs";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { conceptInputHash, conceptRunSchema, writeConcepts } from "../lib/stages/concepts";
import { CANDIDATES, candidateBySlug, type Candidate } from "../lib/demo/candidates";
import { redact } from "../lib/qloo/errors";
import { loadLocalEnv } from "./env";

const MAX_CALLS = 40;
const MAX_RUNS = 10;
const DEFAULT_RUNS = 3;
const EM_DASH = String.fromCharCode(0x2014);
const USAGE = 'Usage: npm run baseline -- <slug>|--all [--runs 3] [--force] [--reroll-control --because "<reason>"]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface Args {
  candidates: readonly Candidate[];
  runs: number;
  force: boolean;
  rerollControl: boolean;
  because?: string;
}

function parseArgs(argv: readonly string[]): Args {
  let all = false;
  let force = false;
  let rerollControl = false;
  let because: string | undefined;
  let runs = DEFAULT_RUNS;
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") all = true;
    else if (arg === "--force") force = true;
    else if (arg === "--reroll-control") rerollControl = true;
    else if (arg === "--because") because = argv[++i]?.trim();
    else if (arg === "--runs" || arg.startsWith("--runs=")) {
      const value = arg === "--runs" ? argv[++i] : arg.slice("--runs=".length);
      runs = Number(value);
      if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) fail(`--runs takes a whole number from 1 to ${MAX_RUNS}.\n${USAGE}`);
    } else if (arg.startsWith("--")) fail(`Unknown option ${arg}.\n${USAGE}`);
    else slugs.push(arg);
  }
  if (all === (slugs.length > 0) || slugs.length > 1) fail(USAGE);
  if (rerollControl && !force) fail(`--reroll-control needs --force.\n${USAGE}`);
  // A Control is only regenerated when an input changed, and the run file records which.
  if (rerollControl && (!because || because.length < 10)) fail(`--reroll-control needs --because "<why an input changed>".\n${USAGE}`);
  if (all) return { candidates: CANDIDATES, runs, force, rerollControl, because };
  const candidate = candidateBySlug(slugs[0]);
  if (!candidate) fail(`No candidate "${slugs[0]}". Known: ${CANDIDATES.map((c) => c.slug).join(", ")}.`);
  return { candidates: [candidate], runs, force, rerollControl, because };
}

async function writeChecked(file: string, value: unknown, apiKey: string): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (text.includes(apiKey)) fail(`Refusing to write ${file}: the API key appeared in the output.`);
  if (text.includes(EM_DASH)) fail(`Refusing to write ${file}: it contains an em dash.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const tokens = (value: number | null) => (value === null ? "?" : value.toLocaleString("en-US"));

async function main(): Promise<void> {
  const { candidates, runs, force, rerollControl, because } = parseArgs(process.argv.slice(2));

  loadLocalEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) fail("ANTHROPIC_API_KEY missing. Add it to .env.local (never commit it), then rerun.");

  const modelId = stoopModelId();
  const model = stoopModel(modelId);

  const plan = planRuns({ slugs: candidates.map((c) => c.slug), runs, force, rerollControl, exists: existsSync });
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  const pending = plan.pending.map((job) => ({ ...job, candidate: bySlug.get(job.slug) as Candidate }));
  const skipped = plan.skipped + plan.kept.length;
  if (plan.skipped > 0) console.log(`Skipping ${plan.skipped} existing run(s); pass --force to regenerate them.`);
  for (const { slug, reason } of plan.kept) {
    console.log(
      reason === "frozen"
        ? `${slug} run ${CONTROL_RUN}: kept, its pack is frozen (approved).`
        : `${slug} run ${CONTROL_RUN}: kept, it is the Control; pass --reroll-control to replace it.`,
    );
  }
  console.log(`Model ${modelId}. ${pending.length} run(s) to generate, cap ${MAX_CALLS} LLM calls.`);

  let calls = 0;
  let written = 0;
  let failed = 0;
  const total = { input: 0, output: 0, unknown: false };
  const add = (usage: { inputTokens: number | null; outputTokens: number | null }) => {
    if (usage.inputTokens === null || usage.outputTokens === null) total.unknown = true;
    total.input += usage.inputTokens ?? 0;
    total.output += usage.outputTokens ?? 0;
  };

  const freshControls = new Set<string>();
  // Set when the provider fails or the cap is reached, so the concepts step doesn't keep spending.
  let stopped = false;
  for (const [index, { candidate, run, file }] of pending.entries()) {
    if (!fitsCap(calls, BASELINE_MAX_ATTEMPTS, MAX_CALLS)) {
      console.log(
        `Stopping at the cap: ${calls} of ${MAX_CALLS} LLM calls used, ${MAX_CALLS - calls} left, which may not cover a run with a repair. ` +
          `${pending.length - index} run(s) remain; rerun to continue (finished runs are skipped).`,
      );
      process.exitCode = 1;
      stopped = true;
      break;
    }
    try {
      const result = await generateBaseline(candidate, { model, modelId, run, because: force ? because : undefined });
      calls += result.attempts;
      add(result.usage);
      await writeChecked(file, result, apiKey);
      if (run === CONTROL_RUN) freshControls.add(candidate.slug);
      written++;
      console.log(
        `${candidate.slug} run ${run}: ${result.attempts} attempt(s), ${tokens(result.usage.inputTokens)} in / ${tokens(result.usage.outputTokens)} out tokens`,
      );
      for (const issue of result.repairedFor ?? []) console.log(`  repaired for: ${redact(issue, apiKey)}`);
    } catch (error) {
      if (!(error instanceof BaselineError)) {
        // Provider or network trouble: stop rather than repeat it for every run. Count the worst case.
        calls += BASELINE_MAX_ATTEMPTS;
        console.error(`${candidate.slug} run ${run}: request failed, stopping. ${redact(String(error), apiKey)}`);
        process.exitCode = 1;
        stopped = true;
        break;
      }
      calls += error.attempts;
      add(error.usage);
      failed++;
      process.exitCode = 1;
      console.error(`${candidate.slug} run ${run}: rejected after ${error.attempts} attempts:\n${redact(error.issues.map((i) => `  - ${i}`).join("\n"), apiKey)}`);
    }
  }

  // Concepts for the Control (run 1), with the shared concept writer.
  let conceptsWritten = 0;
  if (!stopped) {
    for (const candidate of candidates) {
      const controlFile = runFile(candidate.slug, CONTROL_RUN);
      const targetFile = conceptsFile(candidate.slug);
      if (!existsSync(controlFile)) continue;
      // An approved (frozen) pack pins its concepts; they are never rewritten.
      if (existsSync(frozenPackFile(candidate.slug))) continue;
      const control = baselineRunSchema.parse(JSON.parse(await readFile(controlFile, "utf8")));
      const product = candidateProduct(candidate);
      const brief = controlBrief(control);
      const direction = candidateDirection(candidate);
      // Concepts are current only if they were written from exactly this run 1.
      const existing = existsSync(targetFile) ? conceptRunSchema.safeParse(JSON.parse(await readFile(targetFile, "utf8"))) : null;
      const current = existing?.success && existing.data.inputHash === conceptInputHash(product, brief, direction);
      if (current && !freshControls.has(candidate.slug)) continue;
      if (!fitsCap(calls, 2, MAX_CALLS)) {
        console.log(`Stopping at the cap before the concepts for ${candidate.slug}; rerun to continue.`);
        process.exitCode = 1;
        break;
      }
      try {
        const result = await writeConcepts(product, brief, {
          model,
          modelId,
          names: baselineNames(control, candidate),
          direction,
        });
        calls += result.attempts;
        add(result.usage);
        await writeChecked(targetFile, result, apiKey);
        conceptsWritten++;
        console.log(
          `${candidate.slug} concepts: ${result.attempts} attempt(s), kept #${result.bestIndex + 1}, ${tokens(result.usage.inputTokens)} in / ${tokens(result.usage.outputTokens)} out tokens`,
        );
        for (const issue of result.repairedFor ?? []) console.log(`  repaired for: ${redact(issue, apiKey)}`);
      } catch (error) {
        calls += 2;
        failed++;
        process.exitCode = 1;
        console.error(`${candidate.slug} concepts: ${redact(String(error), apiKey)}`);
        // A validation failure is this brief's problem; anything else (provider, network) stops the run.
        if (!(error instanceof Error && /failed validation twice|break the guardrails/.test(error.message))) break;
      }
    }
  }

  const usageNote = total.unknown ? " (some usage unreported)" : "";
  console.log(
    `Done: ${written} run(s) and ${conceptsWritten} concept set(s) written, ${failed} failed, ${skipped} skipped. ${calls} LLM call(s), ${tokens(total.input)} in / ${tokens(total.output)} out tokens${usageNote}.`,
  );
}

main().catch((error: unknown) => {
  fail(redact(String(error), process.env.ANTHROPIC_API_KEY?.trim()));
});
