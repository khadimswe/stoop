// Renders an example store's poster background as a draft for the founder to review, from the prompt
// frozen in data/plans/<slug>/marketing/marketing.json (scripts/export-marketing.ts), on fal with
// POSTER_MODEL. At most 2 renders per store, ever: each attempt is recorded in marketing.json before fal
// is called, and the drafts stay listed there, so both count for good. A prompt that fails the poster check never renders. Each draft is written next to the
// export with two composited previews (the exact text layer over the art, portrait and link preview),
// and nothing is copied into public/: pages show demo media only after the founder approves it.
//   npx tsx scripts/render-poster.ts <slug> [--plans <dir>]
// Reads FAL_KEY from the environment (run it from the checkout that holds the keys). Logs no response.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, parseCliArgs } from "../lib/cli-args";
import { planEventSchema, reducePlan, toPlanReport } from "../lib/plan/events";
import { createPosterRenderer } from "../lib/plan/poster-art";
import { posterImage } from "../lib/plan/poster-image";
import { checkPosterPrompt, posterFalInput, posterPromptHash } from "../lib/plan/poster-prompt";
import { posterText } from "../lib/plan/poster-text";
import { MAX_DRAFT_RENDERS, marketingExportSchema, marketingMarkdown, type Draft } from "../lib/plan/posts-export";
import { POSTER_MODEL } from "../lib/prompts/models.config";
import { loadLocalEnv } from "./env";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2), { flags: [], options: ["--plans"], positionals: { min: 1, max: 1 } });
  } catch (error) {
    fail(error instanceof CliError ? `${error.message}\nUsage: npx tsx scripts/render-poster.ts <slug> [--plans <dir>]` : String(error));
  }
  const slug = args.positional[0]!;
  if (!/^[a-z0-9-]+$/.test(slug)) fail(`"${slug}" is not a slug.`);
  const plansDir = path.resolve(args.options.get("--plans") ?? path.join(process.cwd(), "data", "plans"));
  const dir = path.join(plansDir, slug, "marketing");
  const jsonFile = path.join(dir, "marketing.json");
  if (!existsSync(jsonFile)) fail(`No ${jsonFile}. Run scripts/export-marketing.ts first.`);
  const exported = marketingExportSchema.parse(JSON.parse(await readFile(jsonFile, "utf8")));
  const report = toPlanReport(reducePlan(planEventSchema.array().parse(JSON.parse(await readFile(path.join(plansDir, slug, "plan.events.json"), "utf8")))));
  const poster = exported.events[0].poster;

  // The frozen prompt, checked again exactly as it will be sent.
  const input = posterFalInput(poster.prompt);
  if (posterPromptHash(input) !== poster.promptHash) fail(`${slug}: the frozen prompt does not match its promptHash. Export again.`);
  const problems = checkPosterPrompt(poster.prompt, report);
  if (problems.length) fail(`${slug}: the poster prompt fails its check: ${problems.map((p) => p.message).join("; ")}`);
  const attempts = Math.max(exported.renderAttempts ?? 0, exported.drafts.length);
  if (attempts >= MAX_DRAFT_RENDERS) fail(`${slug}: already ${attempts} renders started, the most a store gets. Review those drafts.`);

  loadLocalEnv();
  const key = process.env.FAL_KEY?.trim();
  if (!key) fail("FAL_KEY is not set.");
  const renderer = createPosterRenderer({ credentials: key });
  // The attempt is recorded before fal is called, so a render that bills and then fails still counts.
  const started = marketingExportSchema.parse({ ...exported, renderAttempts: attempts + 1 });
  await writeFile(jsonFile, `${JSON.stringify(started, null, 2)}\n`);
  console.log(`${slug}: rendering ${attempts + 1} of ${MAX_DRAFT_RENDERS} on ${POSTER_MODEL.displayName} (about $${POSTER_MODEL.usdPerImage.toFixed(2)}).`);
  const image = await renderer.render({ endpoint: POSTER_MODEL.endpoint, input });
  const extension = EXTENSIONS[image.contentType];
  if (!extension) fail(`The art came back as ${image.contentType}.`);
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  const tag = sha256.slice(0, 12);
  const file = `poster-bg-${tag}.${extension}`;
  await writeFile(path.join(dir, file), image.bytes);

  // The previews: the poster exactly as the route draws it, over this art.
  const art = { dataUri: `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}` };
  const text = posterText(report);
  const previews: string[] = [];
  for (const size of ["portrait", "og"] as const) {
    const name = `poster-preview-${tag}-${size}.png`;
    await writeFile(path.join(dir, name), Buffer.from(await posterImage(text, art, size).arrayBuffer()));
    previews.push(name);
  }
  const draft: Draft = { file, previews, promptHash: poster.promptHash, sha256, modelId: POSTER_MODEL.endpoint, renderedAt: new Date().toISOString() };
  const updated = marketingExportSchema.parse({ ...started, drafts: [...started.drafts, draft] });
  await writeFile(jsonFile, `${JSON.stringify(updated, null, 2)}\n`);
  await writeFile(path.join(dir, "marketing.md"), marketingMarkdown(report, updated));
  console.log(`${slug}: wrote ${file} and ${previews.join(", ")}. 1 render.`);
}

main().catch((error: unknown) => fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
