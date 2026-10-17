// The face-filter check (docs: "test whether fal's face filter blocks our talent sheets"): two 4 second
// 480p draft videos of the same world, one with storyboard frames that show a fictional adult as
// references, one with only a product image, to see whether fal refuses references with a person in
// them before relying on them. It prints both plans and their cost; nothing is sent to fal unless
// --yes is given, and then only these two drafts, billed to FAL_KEY.
//
//   npx tsx scripts/render-check.ts                          dry run: print the plans and the cost
//   npx tsx scripts/render-check.ts --yes                    render both (about $1.76 at 4 s each)
//   options: --example <slug> (default the lead), --segment <world> (default its first world with talent),
//            --base <https origin fal fetches /demo from> (default RENDER_REFS_BASE_URL or NEXT_PUBLIC_APP_URL),
//            --talent-frames <url,url> and --product-frame <url> to use public images not yet in the manifest
// Prints statuses, fal's refusal text and the result URLs, never a key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFalClient } from "@fal-ai/client";
import { EXAMPLES, LEAD_EXAMPLE, type ExampleSlug } from "../lib/demo/examples";
import { approvalsSchema, demoMediaFor, manifestSchema } from "../lib/demo/manifest";
import { sha256 } from "../lib/hash";
import { draftUsd, VIDEO_MODELS } from "../lib/prompts/models.config";
import { reportSchema } from "../lib/report/schema";
import { FAL_QUEUE_URL, falInputFor } from "../lib/render/fal";
import { buildRenderPlan, demoBaseUrl, multiShotJob, renderSource, type ReferenceSource, type RenderSource } from "../lib/render/plan";
import type { RenderPlan } from "../lib/render/schema";
import { loadLocalEnv } from "./env";

const SECONDS = 4;
const POLL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60_000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const spend = process.argv.includes("--yes");
if (spend) loadLocalEnv();

const readJson = (...parts: string[]) => JSON.parse(readFileSync(path.join(process.cwd(), ...parts), "utf8")) as unknown;

function externalFrames(list: string): ReferenceSource[] {
  return list
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url, scene) => {
      if (!url.startsWith("https://")) throw new Error(`${url} is not an https URL fal can fetch.`);
      return { kind: "frame", role: "frame", scene, url, promptHash: sha256(`external:${url}`), modelId: "external", attempt: 1 } as const;
    });
}

async function plans(): Promise<{ talent: RenderPlan | null; productOnly: RenderPlan | null; notes: string[]; approved: boolean }> {
  const slug = (arg("example") ?? LEAD_EXAMPLE.slug) as ExampleSlug;
  if (!EXAMPLES.some((e) => e.slug === slug)) throw new Error(`No example "${slug}".`);
  const report = reportSchema.parse(readJson("data", "runs", slug, "run.report.json"));
  const approvals = approvalsSchema.parse(readJson("public", "demo", "approvals.json"));
  const demo = demoMediaFor(manifestSchema.parse(readJson("public", "demo", "manifest.json")), approvals, slug);
  const world = arg("segment") ? report.worlds.find((w) => w.segmentId === arg("segment")) : report.worlds.find((w) => w.pack?.cast === "adult_talent");
  if (!world) throw new Error(`No world with talent in ${slug}; pass --segment.`);
  const notes: string[] = [`${slug} / ${world.segmentId} (cast: ${world.pack?.cast ?? "no pack"})`];

  const base = arg("base") ?? demoBaseUrl(process.env);
  if (!base) notes.push("No public base URL for /demo files (--base, RENDER_REFS_BASE_URL or NEXT_PUBLIC_APP_URL): the URLs below use https://stoop.invalid and cannot render.");
  const deps = { now: Date.now(), draftSeconds: SECONDS, demoBase: base ?? "https://stoop.invalid", photoUrl: async () => "" };
  const target = { reportId: report.meta.id, segment: world.segmentId };

  // The approved storyboard and packshot, unless images are passed in.
  let source: RenderSource | null = null;
  try {
    source = renderSource(report, target, demo);
  } catch (error) {
    notes.push(`Approved media: ${error instanceof Error ? error.message : "none"} Approve the storyboard and packshot in public/demo/approvals.json, or pass --talent-frames and --product-frame.`);
  }
  const talentFrames = arg("talent-frames");
  const productFrame = arg("product-frame");
  const job = source?.job ?? (world.pack ? multiShotJob(world.pack) : null);
  // Like scripts/render-demo.ts: nothing renders from a prompt the founder has not approved.
  const approved = job !== null && approvals.prompts.includes(job.promptHash);
  notes.push(job ? `Prompt ${job.id} (${job.promptHash.slice(0, 12)}): ${approved ? "approved" : "not in public/demo/approvals.json yet, so --yes refuses"}.` : "This world has no multi-shot prompt.");
  const make = (references: ReferenceSource[]): RenderSource | null => (job && references.length ? { target, report: "example", pack: world.pack!, job, product: report.inputs.product, references } : null);

  const frames = talentFrames ? externalFrames(talentFrames) : (source?.references.filter((r) => r.role === "frame") ?? []);
  const product = productFrame ? [{ ...externalFrames(productFrame)[0], role: "product" as const, scene: null }] : (source?.references.filter((r) => r.role === "product") ?? []);
  const talentSource = make([...(product as ReferenceSource[]), ...frames]);
  const productSource = make(product as ReferenceSource[]);
  if (!productSource) notes.push("No product-only image: approve the packshot or pass --product-frame <https url>.");
  return {
    talent: talentSource ? await buildRenderPlan(talentSource, deps) : null,
    productOnly: productSource ? await buildRenderPlan(productSource, deps) : null,
    notes,
    approved,
  };
}

function show(name: string, plan: RenderPlan | null) {
  console.log(`\n${name}`);
  if (!plan) return console.log("  (cannot be planned yet, see the notes above)");
  console.log(`  endpoint   ${plan.endpoint}`);
  console.log(`  length     ${plan.durationSeconds} s at ${plan.resolution}, draft, ${plan.aspectRatio}, audio ${plan.generateAudio ? "on" : "off"}`);
  console.log(`  cost       about $${plan.estimatedUsd.toFixed(2)}`);
  plan.imageUrls.forEach((url, i) => console.log(`  @Image${i + 1}    ${url}`));
  console.log(`  prompt     ${plan.prompt.length} characters; first lines:`);
  for (const line of plan.prompt.split("\n").slice(0, 6)) console.log(`             ${line}`);
}

/** fal's own explanation of a refusal (its detail field), short. The rest of the body can echo the request. */
function detailOf(body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const text = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => (d as { msg?: unknown } | null)?.msg).filter((m): m is string => typeof m === "string").join("; ") : "";
  return text.slice(0, 300) || "no detail";
}

async function render(name: string, plan: RenderPlan, credentials: string) {
  const fal = createFalClient({ credentials });
  const input = falInputFor(plan, { endUserId: "stoop-face-filter-check" });
  console.log(`\n${name}: submitting`);
  // One plain POST, never retried: a retry after fal took the job would bill a second render.
  const submitted = await fetch(`${FAL_QUEUE_URL}/${plan.endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    redirect: "error",
  });
  const queued = (await submitted.json().catch(() => null)) as { request_id?: string } | null;
  if (!submitted.ok || !queued?.request_id) return console.log(`  refused (HTTP ${submitted.status}): ${detailOf(queued)}`);
  const requestId = queued.request_id;
  try {
    const started = Date.now();
    for (;;) {
      const { status } = await fal.queue.status(plan.endpoint, { requestId, logs: false });
      console.log(`  ${Math.round((Date.now() - started) / 1000)} s: ${status}`);
      if (status === "COMPLETED") break;
      if (Date.now() - started > MAX_WAIT_MS) return console.log(`  still running after 10 minutes; request ${requestId}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const { data } = await fal.queue.result(plan.endpoint, { requestId });
    console.log(`  done: ${(data as { video?: { url?: string } }).video?.url ?? "no video in the answer"}`);
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.log(`  failed${status ? ` (HTTP ${status})` : ""}: ${detailOf((error as { body?: unknown }).body)}`);
  }
}

async function main() {
  const { talent, productOnly, notes, approved } = await plans();
  console.log("Face-filter check: two drafts of one world on fal");
  for (const note of notes) console.log(`- ${note}`);
  show("A. Storyboard frames with a fictional adult (plus the product)", talent);
  show("B. A product-only image", productOnly);
  const each = draftUsd(VIDEO_MODELS.reference, SECONDS);
  const count = [talent, productOnly].filter(Boolean).length;
  console.log(`\nCost: about $${each.toFixed(2)} each at ${SECONDS} s, $${(each * count).toFixed(2)} for ${count}.`);
  if (!spend) return console.log("Dry run: nothing was sent to fal. Run again with --yes to render.");
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not set.");
  if (!approved) throw new Error("The prompt is not approved: add its hash to public/demo/approvals.json first.");
  if (talent?.imageUrls.some((u) => u.startsWith("https://stoop.invalid")) || productOnly?.imageUrls.some((u) => u.startsWith("https://stoop.invalid"))) throw new Error("Set a public base URL first (--base).");
  if (talent) await render("A", talent, key);
  if (productOnly) await render("B", productOnly, key);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
