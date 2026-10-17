// Records and replays the examples end to end: audience, concept worlds, the Control and the
// comparison. Replay (the default) uses recorded Qloo answers (fixtures/) and recorded Claude answers
// (fixtures/llm/<slug>.json) only: no key, no network, and a miss throws. --record answers misses
// live (Qloo through record mode, capped at OFFLINE_CAP; Claude through the recording middleware),
// writes the new answers, then re-runs in strict replay and stores that replay, so the stored run
// never depends on live timing.
//
//   npm run example -- <slug>|--picks [--record]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SHARED_CREATIVE } from "../lib/agent/creative";
import { LlmStore, recordingModel } from "../lib/agent/llm-replay";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { recordExampleBrief, replayOptions } from "../lib/demo/example-run";
import { EXAMPLES, type ExampleSlug } from "../lib/demo/examples";
import { createQlooClient } from "../lib/qloo/client";
import { findFixture, loadFixtures } from "../lib/qloo/fixtures";
import { RecordingCache } from "../lib/qloo/recording";
import { loadLocalEnv } from "./env";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** JSON for committed files: U+2014 inside Qloo's names is written as an escape so the em dash scan stays clean. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;
const runDir = (slug: string) => path.join("data", "runs", slug);

async function recordLive(slug: ExampleSlug): Promise<void> {
  loadLocalEnv();
  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) fail("QLOO_API_KEY missing. Add it to your local env file (never commit it), then rerun.");
  if (!process.env.ANTHROPIC_API_KEY?.trim()) fail("ANTHROPIC_API_KEY missing. Add it to your local env file (never commit it), then rerun.");
  const cache = new RecordingCache(loadFixtures());
  const client = createQlooClient({ apiKey, cache });
  const modelId = stoopModelId();
  const store = LlmStore.named(slug);
  const started = Date.now();
  const model = recordingModel(Object.assign(stoopModel(modelId), { modelId }), store);
  const { report } = await recordExampleBrief(slug, { client, model, modelId, creative: SHARED_CREATIVE });
  // A new name for every recording: earlier ones still hold answers this run replayed.
  let name = `culture-${slug}`;
  for (let n = 2; findFixture(name); n++) name = `culture-${slug}-${n}`;
  const file = await cache.save(name, `Gate 4: Qloo calls the ${slug} example's culture stages made live (sweep, check, the Culture agent's probes).`, { secret: apiKey });
  const pruned = store.prune();
  store.save();
  console.log(
    `${slug}: live run in ${((Date.now() - started) / 1000).toFixed(1)} s, ${cache.size} new Qloo answers${file ? ` (${file})` : ""}, Claude answers in ${store.file}${pruned ? ` (${pruned} unused dropped)` : ""}`,
  );
  for (const world of report.worlds) console.log(`  ${world.segmentId}: ${world.partial ? `stopped at ${world.partial.stage}: ${world.partial.reason}` : "complete"}`);
}

async function replay(slug: ExampleSlug): Promise<void> {
  const { events, report } = await recordExampleBrief(slug, replayOptions(slug, SHARED_CREATIVE));
  await mkdir(runDir(slug), { recursive: true });
  await writeFile(path.join(runDir(slug), "run.events.json"), json(events));
  await writeFile(path.join(runDir(slug), "run.report.json"), json(report));
  const worlds = report.worlds.map((w) => `${w.label}${w.partial ? ` (stopped at ${w.partial.stage})` : ""} in ${w.settingCity?.label ?? "no city"}: ${w.richSlots.length} rich slots`);
  console.log(`${slug}: ${events.length} events, ${report.ledger.length} receipts | ${worlds.join(" / ")} | ${report.comparison?.headline ?? "no comparison"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugs = args.includes("--picks") ? EXAMPLES.map((e) => e.slug) : args.filter((a) => !a.startsWith("--"));
  if (slugs.length === 0) fail("Usage: npm run example -- <slug>|--picks [--record]");
  for (const slug of slugs) {
    if (!EXAMPLES.some((e) => e.slug === slug)) fail(`"${slug}" is not an example. Examples: ${EXAMPLES.map((e) => e.slug).join(", ")}.`);
    if (args.includes("--record")) await recordLive(slug as ExampleSlug);
    await replay(slug as ExampleSlug);
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));
