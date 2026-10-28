// Proof lab, step 2: which city name does Qloo resolve for each area? The plan reads the city's taste
// by name (signal.location.query), and small Georgia towns share names with bigger cities elsewhere
// (Jonesboro, Arkansas; Duluth, Minnesota; Decatur, Illinois). For each area this sends exactly the
// pipeline's own city-artists request (lib/plan/requests.ts cityArtistsParams, template ages), so the
// answer is reused by the plan run at no extra cost, and reads which locality Qloo matched from the
// response's query block. A bare name that resolves outside Georgia is tried again as "<name>, GA",
// then "<name>, Georgia".
//
// Writes data/proof/cities.json and records new Qloo answers to data/proof/fixtures/proof-cities*.json.
// Run from the checkout that holds the keys:
//   cd /Users/khadim/Stoop && npx tsx <worktree>/scripts/proof-cities.ts [area...]
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ENDPOINTS } from "../lib/qloo/constants";
import { createRunContext } from "../lib/qloo/context";
import { findFixture } from "../lib/qloo/fixtures";
import { insightsEntitiesResponse, slimEntitiesBody } from "../lib/qloo/types";
import { cityArtistsParams } from "../lib/plan/requests";
import { loadLocalEnv } from "./env";
import { json, PROOF, PROOF_FIXTURES, readJson, recordingClient, resolvedLocality, templateInputs, exists, type ProofStore } from "./proof-lib";

const AREAS = [
  "Jonesboro", "Riverdale", "Lovejoy", "Hampton", "Forest Park", "Kennesaw", "Atlanta", "Decatur", "Doraville", "Lawrenceville", "Marietta",
  "Austell", "East Point", "Stone Mountain", "Duluth", "Morrow", "Smyrna", "Norcross", "Tucker", "Buford", "Snellville",
];

const OUT = path.join(PROOF, "cities.json");

interface CityProbe {
  area: string;
  tried: { query: string; resolved: ReturnType<typeof resolvedLocality>; georgia: boolean; topArtists: string[] }[];
  /** The first query that resolved to a Georgia locality, or null. */
  use: string | null;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const apiKey = process.env.QLOO_API_KEY?.trim();
  if (!apiKey) throw new Error("No Qloo key loaded: run from the Stoop checkout.");
  const areas = process.argv.slice(2).length ? process.argv.slice(2) : AREAS;
  const previous: CityProbe[] = exists(OUT) ? readJson<{ cities: CityProbe[] }>(OUT).cities : [];
  const { client, cache, recording } = recordingClient(apiKey);
  const ctx = createRunContext({ runId: "proof-cities", cap: 3 * areas.length });
  const results = new Map(previous.map((p) => [p.area, p]));
  for (const area of areas) {
    const probe: CityProbe = { area, tried: [], use: null };
    for (const query of [area, `${area}, GA`, `${area}, Georgia`]) {
      const stub: ProofStore = { id: "probe", area, address: area, qlooCity: query, point: { lat: 33.75, lon: -84.39 }, source: "probe", sets: [] };
      const result = await client.request(ctx, { endpoint: ENDPOINTS.insights, params: cityArtistsParams(templateInputs(stub)), schema: insightsEntitiesResponse, slim: slimEntitiesBody, label: `city probe ${query}`, stage: "city" });
      const body = cache.last?.entry.body;
      const resolved = resolvedLocality(body);
      const georgia = !!resolved?.disambiguation && /Georgia, United States/.test(resolved.disambiguation);
      probe.tried.push({ query, resolved, georgia, topArtists: result.data.slice(0, 10).map((e) => e.name) });
      console.log(`${query}: ${resolved ? `${resolved.name} (${resolved.disambiguation})` : "no locality in the answer"}; ${result.evidence.cached ? "cached" : "live"}; top: ${result.data.slice(0, 6).map((e) => e.name).join(", ")}`);
      if (georgia) {
        probe.use = query;
        break;
      }
    }
    results.set(area, probe);
  }
  await mkdir(PROOF_FIXTURES, { recursive: true });
  let name = "proof-cities";
  for (let n = 2; findFixture(name, PROOF_FIXTURES); n++) name = `proof-cities-${n}`;
  const saved = await recording.save(name, "Proof lab: city-name probes for metro Atlanta areas (the plan's own city-artists request).", { secret: apiKey, dir: PROOF_FIXTURES });
  await writeFile(OUT, json({ note: "Which locality Qloo resolved for each area's city name (signal.location.query). Private: holds Qloo artist names.", cities: [...results.values()] }));
  console.log(`${ctx.liveCalls} live Qloo calls; ${saved ? path.basename(saved) : "nothing new recorded"}; wrote ${path.relative(PROOF, OUT)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
