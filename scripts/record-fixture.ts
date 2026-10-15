// Records real Qloo responses into fixtures/, the source of truth for tests.
//
//   npm run fixtures:record -- <name> [--probe]
//
// Reads fixtures/recipes/<name>.json, calls the live API through the same client the app uses
// (same validation, pacing, and retries, no cache, no run budget), and writes:
//   fixtures/<name>.json        committed: request, status, rate-limit headers, body (heatmaps slimmed)
//   fixtures/raw/<name>/*.json  gitignored: full raw bodies
// --probe skips param validation so we can test what Qloo does with params we don't allow yet.
// No headers except rate-limit ones are saved, and the key is checked absent before writing.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createQlooClient } from "../lib/qloo/client";
import { ENDPOINTS, QLOO_BASE_URL, type Endpoint } from "../lib/qloo/constants";
import { QlooError, redact } from "../lib/qloo/errors";
import { paramsRecord, type QlooParams } from "../lib/qloo/params";
import { validateParams } from "../lib/qloo/schemas";
import { slimHeatmapBody } from "../lib/qloo/types";

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
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readRecipe(text: string, file: string): Recipe {
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
    if (!ENDPOINT_VALUES.has(req.endpoint)) fail(`Request "${req.id}" has unknown endpoint "${req.endpoint}".`);
    if (!req.params || typeof req.params !== "object") fail(`Request "${req.id}" needs a "params" object.`);
  }
  return recipe as Recipe;
}

async function writeChecked(file: string, value: unknown, apiKey: string): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (text.includes(apiKey)) fail(`Refusing to write ${file}: the API key appeared in the output.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith("--"));
  const probe = args.includes("--probe");

  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) fail("QLOO_API_KEY missing. Add it to .env.local (never commit it), then rerun.");

  if (!name || !SAFE_NAME.test(name)) fail("Usage: npm run fixtures:record -- <name> [--probe]");
  const recipeFile = path.join("fixtures", "recipes", `${name}.json`);
  if (!existsSync(recipeFile)) fail(`No recipe at ${recipeFile}.`);
  const recipe = readRecipe(await readFile(recipeFile, "utf8"), recipeFile);

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
  const recorded = [];
  for (const req of recipe.requests) {
    const response = await client.raw(req.endpoint, req.params, { validate: !probe });
    const isHeatmap = req.params["filter.type"] === "urn:heatmap";
    await writeChecked(path.join("fixtures", "raw", name, `${req.id}.json`), response.body, apiKey);
    recorded.push({
      id: req.id,
      note: req.note,
      endpoint: req.endpoint,
      params: paramsRecord(req.params),
      query: response.query,
      status: response.status,
      headers: response.headers,
      durationMs: response.durationMs,
      body: isHeatmap ? slimHeatmapBody(response.body) : response.body,
    });
    console.log(`${req.id}: ${response.status} in ${response.durationMs} ms`);
  }

  const outFile = path.join("fixtures", `${name}.json`);
  await writeChecked(
    outFile,
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
  console.log(`Wrote ${outFile} (${recorded.length} requests).`);
}

main().catch((error: unknown) => {
  const message = error instanceof QlooError ? error.message : String(error);
  fail(redact(message, process.env.QLOO_API_KEY?.trim()));
});
