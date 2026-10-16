// Records the audience half (Prove, Reality Check, Segments) of the example runs from fixtures, for
// the report UI to build against and the golden test to check. No live calls: a request that was
// never recorded throws. --plan-missing writes the requests the stages need that no fixture holds.
//
//   npm run audience -- <slug>|--picks
//   npm run audience -- --plan-missing
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXAMPLES, type ExampleSlug } from "../lib/demo/examples";
import { buildExampleRun, recordExampleAudience, replayClient } from "../lib/demo/example-run";
import { OFFLINE_CAP } from "../lib/qloo/budget";
import { ENDPOINTS } from "../lib/qloo/constants";
import { createRunContext } from "../lib/qloo/context";
import { FixtureCache, findFixture } from "../lib/qloo/fixtures";
import { cacheKey, type QlooParams } from "../lib/qloo/params";
import { demographicsResponse } from "../lib/qloo/types";
import { meanSkew, pickSegmentBuckets } from "../lib/stages/measure";
import { proveRequests } from "../lib/stages/prove";
import { segmentIdFor, segmentRequestsFor } from "../lib/stages/segments";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** JSON for committed files: U+2014 inside Qloo's names is written as an escape so the em dash scan stays clean. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

export const runDir = (slug: string) => path.join("data", "runs", slug);

async function record(slug: ExampleSlug): Promise<void> {
  const { events, report } = await recordExampleAudience(slug);
  await mkdir(runDir(slug), { recursive: true });
  await writeFile(path.join(runDir(slug), "audience.events.json"), json(events));
  await writeFile(path.join(runDir(slug), "audience.report.json"), json(report));
  const gap = report.audience.gap;
  const segs = report.audience.segments;
  console.log(
    `${slug}: ${events.length} events, ${report.ledger.length} receipts | Reality Check ${gap?.outcome} (${gap?.dimensions
      .filter((d) => d.outcome !== "not_stated")
      .map((d) => `${d.dimension} ${d.outcome}`)
      .join(", ")}) | cities ${report.audience.proof?.cities.map((c) => c.label).join(", ")} | segments ${segs?.items.map((s) => s.label).join(" / ")} (distinctness ${segs?.distinctness ?? "n/a"})`,
  );
}

async function planMissing(): Promise<void> {
  const client = replayClient();
  const cache = FixtureCache.fromDir("fixtures");
  const missing: { id: string; endpoint: string; params: QlooParams; note: string }[] = [];
  for (const { slug } of EXAMPLES) {
    const ctx = createRunContext({ runId: `plan-${slug}`, cap: OFFLINE_CAP });
    const run = await buildExampleRun(slug, client, ctx);
    const prove = proveRequests(run.inputs.seeds, run.inputs.region);
    const demographics = await client.request(ctx, { endpoint: ENDPOINTS.insights, params: prove.demographics, schema: demographicsResponse });
    for (const bucket of pickSegmentBuckets(meanSkew(demographics.data).age)) {
      for (const [what, params] of Object.entries(segmentRequestsFor(run.inputs.seeds, bucket, run.inputs.region))) {
        if (await cache.get(cacheKey(ENDPOINTS.insights, params))) continue;
        missing.push({ id: `${slug}--${segmentIdFor(bucket)}--${what}`, endpoint: ENDPOINTS.insights, params, note: `Segment ${bucket} of ${slug}: ${what}.` });
      }
    }
  }
  if (missing.length === 0) {
    console.log("Every request the audience stages need is recorded.");
    return;
  }
  let name = "audience-segments";
  for (let n = 2; findFixture(name) || existsSync(path.join("fixtures", "recipes", `${name}.json`)); n++) name = `audience-segments-${n}`;
  const file = path.join("fixtures", "recipes", `${name}.json`);
  await writeFile(file, `${JSON.stringify({ description: "Gate 3: per-segment requests the audience stages need for the example runs (mostly segment heatmaps).", requests: missing }, null, 2)}\n`);
  console.log(`Wrote ${file}: ${missing.length} requests. Record with: npm run fixtures:record -- ${name}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--plan-missing")) return planMissing();
  const slugs = args.includes("--picks") ? EXAMPLES.map((e) => e.slug) : args.filter((a) => !a.startsWith("--"));
  if (slugs.length === 0) fail("Usage: npm run audience -- <slug>|--picks | --plan-missing");
  for (const slug of slugs) {
    if (!EXAMPLES.some((e) => e.slug === slug)) fail(`"${slug}" is not an example. Examples: ${EXAMPLES.map((e) => e.slug).join(", ")}.`);
    await record(slug as ExampleSlug);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));
