// Writes each example store's marketing drafts for review: the frozen poster art prompt, the exact
// text layer, and the Facebook, Instagram and WhatsApp posts, as data/plans/<slug>/marketing/
// marketing.md (to read) and marketing.json (the poster.updated and posts.ready payloads).
//   npx tsx scripts/export-marketing.ts <slug>|--all [--no-llm] [--plans <dir>]
// --plans is the folder holding <slug>/plan.events.json (default data/plans under the current folder),
// so the script can run from a checkout with the API keys while writing into another.
// Claude writes the posts (at most 2 calls per store: one answer and one repair); --no-llm writes the
// deterministic template instead. Zero Qloo calls, zero renders (scripts/render-poster.ts renders).
// The poster payload stays "skipped" with the plain background until the founder approves a draft.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { parseCliArgs, CliError } from "../lib/cli-args";
import { POSTER_REASONS, queuedPoster } from "../lib/plan/poster-art";
import { checkPosterPrompt } from "../lib/plan/poster-prompt";
import { generatePosts } from "../lib/plan/posts";
import { exportOf, marketingExportSchema, marketingMarkdown, pendingPoster, type MarketingExport } from "../lib/plan/posts-export";
import { planEventSchema, reducePlan, toPlanReport } from "../lib/plan/events";
import { loadLocalEnv } from "./env";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2), { flags: ["--all", "--no-llm"], options: ["--plans"], positionals: { min: 0, max: 1 } });
  } catch (error) {
    fail(error instanceof CliError ? `${error.message}\nUsage: npx tsx scripts/export-marketing.ts <slug>|--all [--no-llm] [--plans <dir>]` : String(error));
  }
  const plansDir = path.resolve(args.options.get("--plans") ?? path.join(process.cwd(), "data", "plans"));
  if (!existsSync(plansDir)) fail(`No plans folder at ${plansDir}.`);
  const all = readdirSync(plansDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(plansDir, d.name, "plan.events.json")))
    .map((d) => d.name)
    .sort();
  const slugs = args.flags.has("--all") ? all : args.positional;
  if (slugs.length === 0) fail(`Name a slug or pass --all. Plans found: ${all.join(", ") || "none"}.`);
  const useLlm = !args.flags.has("--no-llm");
  if (useLlm) loadLocalEnv();
  const model = useLlm ? stoopModel() : null;
  let calls = 0;

  for (const slug of slugs) {
    if (!/^[a-z0-9-]+$/.test(slug)) fail(`"${slug}" is not a slug.`);
    // The recorded events, folded the way every page reads them (a report written before a contract
    // change still reduces to the current shape).
    const file = path.join(plansDir, slug, "plan.events.json");
    if (!existsSync(file)) fail(`No recorded events at ${file}.`);
    const report = toPlanReport(reducePlan(planEventSchema.array().parse(JSON.parse(await readFile(file, "utf8")))));
    if (!report.plan) fail(`${slug}: the plan report has no plan.`);
    const queued = queuedPoster(report);
    const problems = checkPosterPrompt(queued.prompt, report);
    if (problems.length) fail(`${slug}: the poster prompt fails its check: ${problems.map((p) => p.message).join("; ")}`);
    const written = await generatePosts(model, report);
    calls += written.usage.calls;

    const outDir = path.join(plansDir, slug, "marketing");
    await mkdir(outDir, { recursive: true });
    const jsonFile = path.join(outDir, "marketing.json");
    // Drafts already rendered stay listed: they count toward the store's render limit for good.
    const previous: MarketingExport | null = existsSync(jsonFile) ? marketingExportSchema.parse(JSON.parse(await readFile(jsonFile, "utf8"))) : null;
    const drafts = previous?.drafts ?? [];
    for (const d of drafts) if (d.promptHash !== queued.promptHash) console.warn(`${slug}: draft ${d.file} was rendered from an older prompt.`);
    const exported = exportOf({
      slug,
      generatedAt: new Date().toISOString(),
      writer: { source: written.source, modelId: written.source === "claude" ? stoopModelId() : null, attempts: written.attempts, refusedFor: written.refusedFor },
      poster: pendingPoster(queued, POSTER_REASONS.pending),
      posts: written.posts,
      drafts,
    });
    await writeFile(jsonFile, `${JSON.stringify(exported, null, 2)}\n`);
    await writeFile(path.join(outDir, "marketing.md"), marketingMarkdown(report, exported));
    console.log(`${slug}: posts by ${written.source} (${written.usage.calls} Claude call${written.usage.calls === 1 ? "" : "s"}), poster prompt ${queued.promptHash.slice(0, 12)}. Wrote ${path.relative(process.cwd(), outDir) || outDir}.`);
  }
  console.log(`Done. ${calls} Claude call${calls === 1 ? "" : "s"}, 0 renders.`);
}

main().catch((error: unknown) => fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
