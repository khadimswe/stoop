// Renders an example store's poster background as a draft for the founder to review, from the prompt
// frozen in data/plans/<slug>/marketing/marketing.json (scripts/export-marketing.ts), on fal with
// POSTER_MODEL. At most 2 renders per store, ever: each attempt is recorded in marketing.json before fal
// is called, and the drafts stay listed there, so both count for good. A prompt that fails the poster check never renders. Each draft is written next to the
// export with two composited previews (the exact text layer over the art, portrait and link preview),
// and nothing is copied into public/: pages show demo media only after the founder approves it.
//   npx tsx scripts/render-poster.ts <slug> [--plans <dir>] [--logo <png>] [--plain]
// --logo puts the store's own official logo (a PNG the store supplied) at the top of the previews; Stoop
// never draws or generates one. --plain writes the previews on the plain neon ground and renders nothing.
// Reads FAL_KEY from the environment (run it from the checkout that holds the keys). Logs no response.
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, parseCliArgs } from "../lib/cli-args";
import { planEventSchema, reducePlan, toPlanReport } from "../lib/plan/events";
import { createPosterRenderer } from "../lib/plan/poster-art";
import { posterImage, type PosterLogo } from "../lib/plan/poster-image";
import { checkPosterPrompt, posterFalInput, posterPromptHash } from "../lib/plan/poster-prompt";
import { posterText } from "../lib/plan/poster-text";
import { MAX_DRAFT_RENDERS, marketingExportSchema, marketingMarkdown, type Draft, type MarketingExport } from "../lib/plan/posts-export";
import { POSTER_MODEL } from "../lib/prompts/models.config";
import { loadLocalEnv } from "./env";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** A store-supplied PNG logo, checked by its signature, with its size read from the PNG header. */
async function readLogo(file: string): Promise<PosterLogo> {
  const bytes = await readFile(file);
  if (bytes.byteLength > LOGO_MAX_BYTES) fail(`The logo is over ${LOGO_MAX_BYTES / 1024 / 1024} MB.`);
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) fail("The logo must be a PNG file.");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) fail("The logo PNG has no size.");
  return { dataUri: `data:image/png;base64,${bytes.toString("base64")}`, width, height };
}

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2), { flags: ["--plain"], options: ["--plans", "--logo"], positionals: { min: 1, max: 1 } });
  } catch (error) {
    fail(error instanceof CliError ? `${error.message}\nUsage: npx tsx scripts/render-poster.ts <slug> [--plans <dir>] [--logo <png>] [--plain]` : String(error));
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
  const logoFile = args.options.get("--logo");
  const logo = logoFile ? await readLogo(path.resolve(logoFile)) : null;
  const text = posterText(report);

  // The plain previews: the exact text layer on the plain neon ground, with nothing rendered.
  if (args.flags.has("--plain")) {
    for (const size of ["portrait", "og"] as const) {
      await writeFile(path.join(dir, `poster-preview-plain-${size}.png`), Buffer.from(await posterImage(text, null, size, {}, logo).arrayBuffer()));
    }
    console.log(`${slug}: wrote poster-preview-plain-portrait.png and poster-preview-plain-og.png. 0 renders.`);
    return;
  }
  const attempts = Math.max(exported.renderAttempts ?? 0, exported.drafts.length);

  // A render that was paid for but never recorded (the run stopped after saving the art) is adopted,
  // never rendered again: its file is on disk and its attempt is already counted.
  const listed = new Set(exported.drafts.map((d) => d.file));
  const orphan = attempts > exported.drafts.length ? readdirSync(dir).find((name) => /^poster-bg-[0-9a-f]{12}\.(?:png|jpg|webp)$/.test(name) && !listed.has(name)) : undefined;
  if (orphan) {
    const bytes = new Uint8Array(await readFile(path.join(dir, orphan)));
    const contentType = Object.entries(EXTENSIONS).find(([, ext]) => orphan.endsWith(`.${ext}`))![0];
    await recordDraft({ dir, jsonFile, exported, report, text, logo, bytes, contentType, file: orphan, promptHash: poster.promptHash });
    console.log(`${slug}: adopted ${orphan}, rendered earlier and not yet recorded. 0 renders.`);
    return;
  }
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
  const file = `poster-bg-${createHash("sha256").update(image.bytes).digest("hex").slice(0, 12)}.${extension}`;
  // The art is saved first, so a failure after this point leaves it to adopt, never to pay for again.
  await writeFile(path.join(dir, file), image.bytes);
  const previews = await recordDraft({ dir, jsonFile, exported: started, report, text, logo, bytes: image.bytes, contentType: image.contentType, file, promptHash: poster.promptHash });
  console.log(`${slug}: wrote ${file} and ${previews.join(", ")}. 1 render.`);
}

/** Writes the two previews (the poster exactly as the route draws it, over this art) and records the draft. */
async function recordDraft(input: {
  dir: string;
  jsonFile: string;
  exported: MarketingExport;
  report: Parameters<typeof marketingMarkdown>[0];
  text: ReturnType<typeof posterText>;
  logo: PosterLogo | null;
  bytes: Uint8Array;
  contentType: string;
  file: string;
  promptHash: string;
}): Promise<string[]> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const tag = sha256.slice(0, 12);
  const art = { dataUri: `data:${input.contentType};base64,${Buffer.from(input.bytes).toString("base64")}` };
  const previews: string[] = [];
  for (const size of ["portrait", "og"] as const) {
    const name = `poster-preview-${tag}-${size}.png`;
    await writeFile(path.join(input.dir, name), Buffer.from(await posterImage(input.text, art, size, {}, input.logo).arrayBuffer()));
    previews.push(name);
  }
  const draft: Draft = { file: input.file, previews, promptHash: input.promptHash, sha256, modelId: POSTER_MODEL.endpoint, renderedAt: new Date().toISOString() };
  const updated = marketingExportSchema.parse({ ...input.exported, drafts: [...input.exported.drafts, draft] });
  await writeFile(input.jsonFile, `${JSON.stringify(updated, null, 2)}\n`);
  await writeFile(path.join(input.dir, "marketing.md"), marketingMarkdown(input.report, updated));
  return previews;
}

main().catch((error: unknown) => fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
