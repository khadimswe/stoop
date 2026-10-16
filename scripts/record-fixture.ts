// Records real Qloo responses into fixtures/, the source of truth for tests.
//
//   npm run fixtures:record -- <name> [--probe] [--force] [--allow-large]
//   npm run fixtures:record -- <name> --reslim     re-applies slimming to a recorded fixture, no calls
//
// Reads fixtures/recipes/<name>.json, calls the live API through the same client the app uses
// (same validation, pacing, and retries, no cache, no run budget), and writes:
//   fixtures/<name>.json        committed: request, status, rate-limit headers, body (slimmed to the fields Stoop reads;
//                               gzipped as <name>.json.gz when over 1 MB)
//   fixtures/raw/<name>/*.json  gitignored: full raw bodies
// --probe skips param validation so we can test what Qloo does with params we don't allow yet, and
// allows probe-only endpoints (/v2/trending). An existing fixture is never re-recorded without
// --force, so a recipe is not paid for twice, and a recipe over MAX_REQUESTS needs --allow-large.
// No headers except rate-limit ones are saved, and the key is checked absent before writing.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createQlooClient } from "../lib/qloo/client";
import { ENDPOINTS, QLOO_BASE_URL, type Endpoint } from "../lib/qloo/constants";
import { QlooError, redact } from "../lib/qloo/errors";
import { paramsRecord, type QlooParams } from "../lib/qloo/params";
import { validateParams } from "../lib/qloo/schemas";
import { encodeFixture, findFixture, FIXTURES_DIR, readFixtureFile, type RecordedRequest } from "../lib/qloo/fixtures";
import { slimBody } from "../lib/qloo/types";
import { loadLocalEnv } from "./env";

interface RecipeRequest {
  id: string;
  endpoint: Endpoint;
  params: QlooParams;
  note?: string;
}

interface Recipe {
  description?: string;
  requests: RecipeRequest[];
}

const ENDPOINT_VALUES = new Set<string>(Object.values(ENDPOINTS));
/** Endpoints the app never calls, recordable only with --probe (one re-probe each in Gate 2). */
const PROBE_ENDPOINTS = new Set<string>(["/v2/trending"]);
/** Larger recipes need --allow-large, so a typo in a generated recipe cannot spend hundreds of calls. */
const MAX_REQUESTS = 80;
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readRecipe(text: string, file: string, probe: boolean): Recipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON.`);
  }
  const recipe = parsed as Partial<Recipe>;
  if (!Array.isArray(recipe.requests) || recipe.requests.length === 0) fail(`${file} needs a non-empty "requests" array.`);
  const ids = new Set<string>();
  for (const req of recipe.requests) {
    if (!req || typeof req.id !== "string" || !SAFE_NAME.test(req.id)) fail(`Every request needs a simple "id" (letters, digits, - or _).`);
    if (ids.has(req.id)) fail(`Duplicate request id "${req.id}".`);
    ids.add(req.id);
    const known = ENDPOINT_VALUES.has(req.endpoint) || (probe && PROBE_ENDPOINTS.has(req.endpoint));
    if (!known) fail(`Request "${req.id}" has unknown endpoint "${req.endpoint}".`);
    if (!req.params || typeof req.params !== "object") fail(`Request "${req.id}" needs a "params" object.`);
  }
  return recipe as Recipe;
}

async function writeRaw(file: string, value: unknown, apiKey: string): Promise<void> {
  const text = `${JSON.stringify(value)}\n`;
  if (text.includes(apiKey)) fail(`Refusing to write ${file}: the API key appeared in the output.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Writes a fixture as readable JSON, or gzipped when large, and removes the other variant. */
async function writeFixture(name: string, value: unknown, apiKey: string): Promise<string> {
  const { file, text, data } = encodeFixture(name, value);
  if (text.includes(apiKey)) fail(`Refusing to write ${file}: the API key appeared in the output.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  for (const other of [path.join(FIXTURES_DIR, `${name}.json`), path.join(FIXTURES_DIR, `${name}.json.gz`)]) {
    if (other !== file) await rm(other, { force: true });
  }
  return file;
}

/**
 * Re-applies the current slimmers to a recorded fixture, from the gitignored raw bodies when they
 * exist. No calls are made, so a slimming rule can change without paying for the recording again.
 */
async function reslim(name: string): Promise<void> {
  const file = findFixture(name);
  if (!file) fail(`No fixture named ${name} in ${FIXTURES_DIR}/.`);
  const fixture = readFixtureFile(file);
  for (const req of fixture.requests) {
    if (req.body === undefined) continue;
    const rawFile = path.join(FIXTURES_DIR, "raw", name, `${req.id}.json`);
    const body = existsSync(rawFile) ? (JSON.parse(await readFile(rawFile, "utf8")) as unknown) : req.body;
    req.body = slimBody(req.endpoint, req.params["filter.type"], body);
  }
  // The key never reached this file, but the same check runs before writing.
  const written = await writeFixture(name, fixture, process.env.QLOO_API_KEY?.trim() || "\u0000no-key");
  console.log(`Re-slimmed ${written} (${fixture.requests.length} requests, no calls).`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith("--"));
  const probe = args.includes("--probe");
  const force = args.includes("--force");
  const allowLarge = args.includes("--allow-large");

  loadLocalEnv();
  if (args.includes("--reslim")) {
    if (!name || !SAFE_NAME.test(name)) fail("Usage: npm run fixtures:record -- <name> --reslim");
    await reslim(name);
    return;
  }
  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) fail("QLOO_API_KEY missing. Add it to .env.local (never commit it), then rerun.");

  if (!name || !SAFE_NAME.test(name)) fail("Usage: npm run fixtures:record -- <name> [--probe]");
  const recipeFile = path.join(FIXTURES_DIR, "recipes", `${name}.json`);
  if (!existsSync(recipeFile)) fail(`No recipe at ${recipeFile}.`);
  const recipe = readRecipe(await readFile(recipeFile, "utf8"), recipeFile, probe);
  const existing = findFixture(name);
  if (existing && !force) fail(`${existing} already exists. Pass --force to record it again (it spends the calls again).`);
  if (recipe.requests.length > MAX_REQUESTS && !allowLarge) {
    fail(`${recipeFile} has ${recipe.requests.length} requests (over ${MAX_REQUESTS}). Pass --allow-large if that is intended.`);
  }

  // Validate everything before spending a single call.
  if (!probe) {
    for (const req of recipe.requests) {
      try {
        validateParams(req.endpoint, req.params);
      } catch (error) {
        fail(`Request "${req.id}": ${(error as Error).message}`);
      }
    }
  }

  const client = createQlooClient({ apiKey });
  const recorded: RecordedRequest[] = [];
  for (const req of recipe.requests) {
    let response;
    try {
      response = await client.raw(req.endpoint, req.params, { validate: !probe });
    } catch (error) {
      // A network failure after retries is recorded instead of thrown, so the calls already made in
      // this recipe are still written and never have to be paid for again.
      const message = redact(error instanceof Error ? error.message : String(error), apiKey);
      console.log(`${req.id}: failed (${message})`);
      recorded.push({ id: req.id, note: req.note, endpoint: req.endpoint, params: paramsRecord(req.params), status: 0, error: message });
      continue;
    }
    await writeRaw(path.join(FIXTURES_DIR, "raw", name, `${req.id}.json`), response.body, apiKey);
    recorded.push({
      id: req.id,
      note: req.note,
      endpoint: req.endpoint,
      params: paramsRecord(req.params),
      query: response.query,
      status: response.status,
      headers: response.headers,
      durationMs: response.durationMs,
      body: slimBody(req.endpoint, req.params["filter.type"], response.body),
    });
    const left = response.headers["x-month-ratelimit-remaining"];
    console.log(`${req.id}: ${response.status} in ${response.durationMs} ms${left ? ` (${left} left this month)` : ""}`);
  }

  const written = await writeFixture(
    name,
    {
      name,
      description: recipe.description,
      recordedAt: new Date().toISOString(),
      baseUrl: QLOO_BASE_URL,
      probe,
      requests: recorded,
    },
    apiKey,
  );
  console.log(`Wrote ${written} (${recorded.length} requests).`);
}

main().catch((error: unknown) => {
  const message = error instanceof QlooError ? error.message : String(error);
  fail(redact(message, process.env.QLOO_API_KEY?.trim()));
});
