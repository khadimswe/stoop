// Proof lab, step 5: the numbers. Deterministic, from the recorded runs (data/proof/runs/), the
// generic-plan extraction (data/proof/extract.json) and one OpenStreetMap check of the generic plan's
// named food businesses (cached in data/proof/osm/generic-picks-near.json; --fetch fills it, at one
// Nominatim request per second with the generic "stoop-proof" agent).
//
// Measures (method and limits in data/proof/README.md):
//   (a) locality: the share of plan lines that name a place within 1.5 km of that store.
//   (b) sameness: the mean pairwise Jaccard overlap of named picks (artists, places) between stores.
//   plus the sameness of Qloo's own inputs (city artists, block places) and of the plans' themes.
//
// Writes data/proof/results.json.
//   npx tsx scripts/proof-measure.ts [--fetch]
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { refsIn } from "../lib/plan/refs";
import type { PlanReport } from "../lib/plan/schema";
import { isChain } from "../lib/plan/taste";
import type { Extracted } from "./proof-extract";
import { exists, json, loadStores, PROOF, PROOF_RUNS, readJson, type ProofStore } from "./proof-lib";

const RADIUS_M = 1500;
const NEAR_FILE = path.join(PROOF, "osm", "generic-picks-near.json");

const haversine = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

/** Names compared across plans: lowercase, no punctuation or accents ("DJ Sample" = "dj sample"). */
const norm = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number | null => {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return null;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / union.size;
};

interface PairStats {
  pairs: number;
  /** Pairs where at least one plan named something of this kind. */
  scored: number;
  meanJaccard: number | null;
  /** Pairs that share at least one pick. */
  sharing: number;
}

function pairwise(ids: readonly string[], sets: ReadonlyMap<string, ReadonlySet<string>>): PairStats {
  const values: number[] = [];
  let sharing = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      const a = sets.get(ids[i] as string) ?? new Set<string>();
      const b = sets.get(ids[j] as string) ?? new Set<string>();
      const v = jaccard(a, b);
      if (v === null) continue;
      values.push(v);
      if (v > 0) sharing++;
    }
  }
  return { pairs, scored: values.length, meanJaccard: values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(3)) : null, sharing };
}

// --- Stoop's plan, as lines and picks --------------------------------------------------------

interface Line {
  where: "concept" | "runOfShow" | "shopping" | "wheel";
  text: string;
  refs: string[];
}

function stoopLines(report: PlanReport): Line[] {
  const plan = report.plan;
  if (!plan) return [];
  const kept = plan.concepts.find((c) => c.kept);
  return [
    ...(kept?.items ?? []).map((i) => ({ where: "concept" as const, text: i.text, refs: i.refs })),
    ...plan.runOfShow.map((s) => ({ where: "runOfShow" as const, text: s.step, refs: refsIn(s.step) })),
    ...plan.shopping.map((s) => ({ where: "shopping" as const, text: s.item, refs: s.from ? [s.from] : [] })),
    ...(plan.wheel?.slices ?? []).map((s) => ({ where: "wheel" as const, text: s.text, refs: s.refs })),
  ];
}

// --- The generic plan's named food businesses, checked against OpenStreetMap -------------------

type Near = Record<string, { nearestM: number | null; hits: number; checkedAt: string }>;
const nearKey = (storeId: string, name: string) => `${storeId}::${norm(name)}`;

async function fetchNear(store: ProofStore, name: string): Promise<Near[string]> {
  await new Promise((r) => setTimeout(r, 1_100));
  const dLat = 0.02;
  const dLon = 0.025;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const { lat, lon } = store.point;
  for (const [k, v] of Object.entries({ q: name, format: "jsonv2", limit: "20", bounded: "1", viewbox: `${lon - dLon},${lat + dLat},${lon + dLon},${lat - dLat}` })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": "stoop-proof" }, signal: AbortSignal.timeout(30_000) });
  const hits = (await res.json()) as { lat: string; lon: string }[];
  const distances = hits.map((h) => haversine(store.point, { lat: Number(h.lat), lon: Number(h.lon) }));
  return { nearestM: distances.length ? Math.round(Math.min(...distances)) : null, hits: hits.length, checkedAt: new Date().toISOString() };
}

// --- Main ------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const fetchMissing = process.argv.includes("--fetch");
  const stores = loadStores().filter((s) => exists(path.join(PROOF_RUNS, s.id, "plan.report.json")));
  const reports = new Map(stores.map((s) => [s.id, readJson<PlanReport>(path.join(PROOF_RUNS, s.id, "plan.report.json"))]));
  const extract = readJson<{ plans: Record<string, { lines: string[]; extracted: Extracted | null }> }>(path.join(PROOF, "extract.json")).plans;
  const near: Near = exists(NEAR_FILE) ? readJson<Near>(NEAR_FILE) : {};

  /** The parts of a store's own address and area: naming them is not naming a place on the block. */
  const ownWords = (s: ProofStore) => new Set([norm(s.address), ...s.address.split(",").map(norm), norm(s.qlooCity), norm(s.qlooCity.replace(/, GA$/, "")), "georgia", "ga", "atlanta", "gwinnett", "cobb", "dekalb", "clayton", "fulton"]);
  const isOwn = (s: ProofStore, name: string) => {
    const n = norm(name);
    const own = ownWords(s);
    if (own.has(n)) return true;
    // A street of the store's own address, written another way ("Elm Rd" for "12 Elm Road").
    const street = norm(s.address.split(",")[0] ?? "").replace(/^\d+\s+/, "");
    const stem = (x: string) => x.replace(/\b(boulevard|blvd|road|rd|street|st|drive|dr|highway|hwy|lane|ln|avenue|ave|sw|se|ne|nw|north|south|east|west|suite|ste|[a-z])\b/g, "").replace(/\s+/g, " ").trim();
    return stem(n).length > 0 && stem(street).includes(stem(n));
  };

  const perStore: Record<string, unknown> = {};
  const stoopArtists = new Map<string, Set<string>>();
  const stoopPlaces = new Map<string, Set<string>>();
  const genericArtists = new Map<string, Set<string>>();
  const genericPlaces = new Map<string, Set<string>>();
  const genericAll = new Map<string, Set<string>>();
  const cityArtists = new Map<string, Set<string>>();
  const blockPlaces = new Map<string, Set<string>>();

  for (const s of stores) {
    const report = reports.get(s.id) as PlanReport;
    const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));
    const artists = new Set((report.local.city?.artists ?? []).map((a) => a.id));
    cityArtists.set(s.id, new Set((report.local.city?.artists ?? []).map((a) => norm(a.name))));
    blockPlaces.set(s.id, new Set(places.keys()));

    // Stoop: lines and picks, from refs.
    const lines = stoopLines(report);
    const nearbyRef = (l: Line) => l.refs.some((id) => {
      const p = places.get(id);
      return !!p && (p.distanceM === null || p.distanceM <= RADIUS_M);
    });
    const concept = lines.filter((l) => l.where === "concept");
    const usedPlaces = [...new Set(lines.flatMap((l) => l.refs).filter((id) => places.has(id)))];
    const usedArtists = [...new Set(lines.flatMap((l) => l.refs).filter((id) => artists.has(id)))];
    stoopPlaces.set(s.id, new Set(usedPlaces));
    stoopArtists.set(s.id, new Set(usedArtists.map((id) => norm(report.local.city?.artists.find((a) => a.id === id)?.name ?? id))));

    // Generic: lines (as shown) and the named things the extraction found.
    const ex = extract[s.id]?.extracted?.entities ?? [];
    const gLines = report.baseline?.items ?? [];
    const placeTypes = new Set(["food_business", "place", "other_business"]);
    const gNamedPlaces = ex.filter((e) => placeTypes.has(e.type) && !isOwn(s, e.name));
    for (const e of gNamedPlaces) {
      const key = nearKey(s.id, e.name);
      if (!near[key] && fetchMissing) near[key] = await fetchNear(s, e.name);
    }
    const within = (name: string) => {
      const hit = near[nearKey(s.id, name)];
      return hit ? hit.nearestM !== null && hit.nearestM <= RADIUS_M : null;
    };
    const gLineNearby = gLines.map((_, i) => gNamedPlaces.some((e) => e.line === i + 1 && within(e.name) === true));
    genericArtists.set(s.id, new Set(ex.filter((e) => e.type === "artist").map((e) => norm(e.name))));
    genericPlaces.set(s.id, new Set(gNamedPlaces.map((e) => norm(e.name))));
    genericAll.set(s.id, new Set(ex.filter((e) => !isOwn(s, e.name)).map((e) => norm(e.name))));

    perStore[s.id] = {
      area: s.area,
      sets: s.sets,
      qloo: {
        cityArtists: report.local.city?.artists.length ?? 0,
        styles: report.local.city?.styles.map((x) => x.name) ?? [],
        blockPlaces: places.size,
        blockChains: [...places.values()].filter((p) => isChain(p.name)).length,
        gaps: report.local.gaps,
      },
      stoop: {
        keptTitle: report.plan?.concepts.find((c) => c.kept)?.title ?? null,
        conceptLines: concept.length,
        conceptLinesNamingNearbyPlace: concept.filter(nearbyRef).length,
        allLines: lines.length,
        allLinesNamingNearbyPlace: lines.filter(nearbyRef).length,
        conceptLinesWithReceipt: report.comparison?.qlooBacked.items ?? null,
        placesUsed: usedPlaces.map((id) => ({ name: places.get(id)?.name, kind: places.get(id)?.kind, distanceM: places.get(id)?.distanceM, chain: isChain(places.get(id)?.name ?? "") })),
        artistsUsed: usedArtists.map((id) => report.local.city?.artists.find((a) => a.id === id)?.name),
      },
      generic: {
        lines: gLines.length,
        linesNamingNearbyPlace: gLineNearby.filter(Boolean).length,
        namedInLines: ex.filter((e) => e.line !== null).map((e) => `${e.name} [${e.type}${isOwn(s, e.name) ? ", the store's own address or area" : ""}]`),
        artists: ex.filter((e) => e.type === "artist").map((e) => e.name),
        foodPicks: ex.filter((e) => e.type === "food_business" || e.type === "product_brand").map((e) => ({ name: e.name, type: e.type, nearestOsmM: e.type === "food_business" ? (near[nearKey(s.id, e.name)]?.nearestM ?? null) : null })),
        cliches: report.baseline?.cliches.map((c) => c.text) ?? [],
        qlooCheck: report.baseline?.check ? { checkable: report.baseline.check.checkable, belowMedian: report.baseline.check.belowMedian, unverifiable: report.baseline.check.unverifiable } : null,
      },
    };
  }
  if (fetchMissing) await writeFile(NEAR_FILE, json(near));

  const task2 = stores.filter((s) => s.sets.includes("task2")).map((s) => s.id);
  const sum = (ids: readonly string[], pick: (row: Record<string, Record<string, number>>) => number) => ids.reduce((acc, id) => acc + pick(perStore[id] as Record<string, Record<string, number>>), 0);
  const locality = {
    stores: task2.length,
    stoopConcept: { lines: sum(task2, (r) => r.stoop?.conceptLines ?? 0), naming: sum(task2, (r) => r.stoop?.conceptLinesNamingNearbyPlace ?? 0) },
    stoopAll: { lines: sum(task2, (r) => r.stoop?.allLines ?? 0), naming: sum(task2, (r) => r.stoop?.allLinesNamingNearbyPlace ?? 0) },
    generic: { lines: sum(task2, (r) => r.generic?.lines ?? 0), naming: sum(task2, (r) => r.generic?.linesNamingNearbyPlace ?? 0) },
    storesWhereStoopNamesANearbyPlace: task2.filter((id) => ((perStore[id] as { stoop: { allLinesNamingNearbyPlace: number } }).stoop.allLinesNamingNearbyPlace ?? 0) > 0).length,
    genericFoodBusinessPicks: task2.flatMap((id) => (perStore[id] as { generic: { foodPicks: { type: string; nearestOsmM: number | null }[] } }).generic.foodPicks.filter((f) => f.type === "food_business")),
  };
  const genericFoodNear = locality.genericFoodBusinessPicks.filter((f) => f.nearestOsmM !== null && f.nearestOsmM <= RADIUS_M).length;

  const sameness = {
    pairs: (task2.length * (task2.length - 1)) / 2,
    stoopArtists: pairwise(task2, stoopArtists),
    stoopPlaces: pairwise(task2, stoopPlaces),
    stoopAll: pairwise(task2, new Map(task2.map((id) => [id, new Set([...(stoopArtists.get(id) ?? []), ...(stoopPlaces.get(id) ?? [])])]))),
    genericArtists: pairwise(task2, genericArtists),
    genericPlaces: pairwise(task2, genericPlaces),
    genericArtistsAndPlaces: pairwise(task2, new Map(task2.map((id) => [id, new Set([...(genericArtists.get(id) ?? []), ...(genericPlaces.get(id) ?? [])])]))),
    genericAllNamed: pairwise(task2, genericAll),
    qlooCityArtists: pairwise(task2, cityArtists),
    qlooBlockPlaces: pairwise(task2, blockPlaces),
  };
  const titles = task2.map((id) => (perStore[id] as { stoop: { keptTitle: string | null } }).stoop.keptTitle ?? "");
  const genericThemes = task2.map((id) => reports.get(id)?.baseline?.items.find((i) => i.kind === "theme")?.text ?? "");
  const themes = {
    stoopKeptTitlesWithPaydayFriday: titles.filter((t) => /payday/i.test(t) && /friday/i.test(t)).length,
    genericThemesWithPayday: genericThemes.filter((t) => /payday/i.test(t)).length,
    stoopKeptTitlesWithWheel: titles.filter((t) => /wheel|spin/i.test(t)).length,
    stoopPlansWithWheel: task2.filter((id) => !!reports.get(id)?.plan?.wheel).length,
    stoopMusicTrapOrSouthernHipHop: task2.filter((id) => (reports.get(id)?.plan?.concepts.find((c) => c.kept)?.items ?? []).some((i) => i.kind === "music" && /trap|southern hip hop|southern rap/i.test(i.text))).length,
    genericMusicTrapOrSouthernHipHop: task2.filter((id) => (reports.get(id)?.baseline?.items ?? []).some((i) => i.kind === "music" && /trap|southern hip[- ]hop|atlanta/i.test(i.text))).length,
    stores: task2.length,
  };

  // How often each named pick recurs across the Task 2 stores.
  const freq = (sets: ReadonlyMap<string, ReadonlySet<string>>) => {
    const counts = new Map<string, number>();
    for (const id of task2) for (const x of sets.get(id) ?? []) counts.set(x, (counts.get(x) ?? 0) + 1);
    return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
  };
  const placeName = new Map<string, string>([...reports.values()].flatMap((r) => (r.local.block?.places ?? []).map((p) => [p.id, p.name] as const)));
  const recurring = {
    genericArtists: freq(genericArtists),
    genericPlaces: freq(genericPlaces),
    stoopArtists: freq(stoopArtists),
    stoopPlaces: Object.fromEntries(Object.entries(freq(stoopPlaces)).map(([id, n]) => [placeName.get(id) ?? id, n])),
  };

  // A null model for Stoop's artist overlap: each plan names the same number of artists, drawn at
  // random from its own city list. If the observed overlap sits near this, the lower overlap is just
  // naming a few artists from near-identical city lists, not a more local music signal.
  let seed = 20261106;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const draw = (list: readonly string[], k: number) => {
    const pool = [...list];
    const out = new Set<string>();
    while (out.size < Math.min(k, list.length)) out.add(pool.splice(Math.floor(random() * pool.length), 1)[0] as string);
    return out;
  };
  const nullValues: number[] = [];
  for (let t = 0; t < 2000; t++) {
    const sample = new Map(task2.map((id) => [id, draw([...(cityArtists.get(id) ?? [])], stoopArtists.get(id)?.size ?? 0)]));
    const stats = pairwise(task2, sample);
    if (stats.meanJaccard !== null) nullValues.push(stats.meanJaccard);
  }
  nullValues.sort((a, b) => a - b);
  const artistNull = {
    draws: nullValues.length,
    mean: Number((nullValues.reduce((x, y) => x + y, 0) / nullValues.length).toFixed(3)),
    p05: nullValues[Math.floor(0.05 * nullValues.length)],
    p95: nullValues[Math.floor(0.95 * nullValues.length)],
  };

  // Task 1 detail: the food spots on each block whose Qloo name or tags say Mexican, and which plan
  // lines (kept or not) used them. Measured, never typed into the inputs.
  const MEXICAN = /mexic|taquer|\btacos?\b|torta|tex[- ]?mex|burrito/i;
  const task1Ids = stores.filter((s) => s.sets.some((x) => x.startsWith("task1"))).map((s) => s.id);
  const task1Blocks = Object.fromEntries(
    task1Ids.map((id) => {
      const r = reports.get(id) as PlanReport;
      const food = (r.local.block?.places ?? []).filter((p) => p.kind === "food");
      // Tags decide; a name counts only when it says so outright (a wings bar with "taco" in its name is not one).
      const mex = food.filter((p) => /mexic|taquer|torta/i.test(p.name) || p.tags.some((t) => MEXICAN.test(t)));
      const usedAnywhere = new Set((r.plan?.concepts ?? []).flatMap((c) => c.items.flatMap((i) => i.refs)));
      const usedKept = new Set(stoopLines(r).flatMap((l) => l.refs));
      return [
        id,
        {
          foodSpots: food.length,
          foodSpotsNotOnChainList: food.filter((p) => !isChain(p.name)).length,
          mexicanSpots: mex.map((p) => ({ name: p.name, distanceM: p.distanceM, chain: isChain(p.name), usedInKeptPlan: usedKept.has(p.id), usedInAnyConcept: usedAnywhere.has(p.id) })),
        },
      ];
    }),
  );
  const cityOverlap = (a: string, b: string) => jaccard(cityArtists.get(a) ?? new Set(), cityArtists.get(b) ?? new Set());
  const shared = (a: string, b: string) => [...(cityArtists.get(a) ?? [])].filter((x) => cityArtists.get(b)?.has(x)).length;
  // Model variance on the Task 1 stores: the same inputs run again with fresh Claude answers.
  const repeats = Object.fromEntries(
    ["tara-6451", "kennesaw-townpark"].map((id) => {
      const keys = [id, ...readdirSync(PROOF_RUNS).filter((k) => k.startsWith(`${id}-r`)).sort()];
      return [
        id,
        keys.map((k) => {
          const r = readJson<PlanReport>(path.join(PROOF_RUNS, k, "plan.report.json"));
          const names = new Map<string, string>([...(r.local.city?.artists ?? []).map((a) => [a.id, a.name] as const), ...(r.local.block?.places ?? []).map((p) => [p.id, p.name] as const)]);
          const used = [...new Set(stoopLines(r).flatMap((l) => l.refs))].map((x) => names.get(x) ?? x);
          const allConcepts = [...new Set((r.plan?.concepts ?? []).flatMap((c) => c.items.flatMap((i) => i.refs)))].map((x) => names.get(x) ?? x);
          const generic = readJson<{ answers: { items?: unknown[]; picks?: { artists?: string[]; foods?: string[] } }[] }>(path.join(PROOF_RUNS, k, "generic.json")).answers;
          const last = [...generic].reverse().find((g) => (g.items?.length ?? 0) >= 4);
          return {
            run: k,
            keptTitle: r.plan?.concepts.find((c) => c.kept)?.title ?? null,
            keptPlanNames: used,
            anyConceptNames: allConcepts,
            genericMusic: r.baseline?.items.find((i) => i.kind === "music")?.text ?? null,
            genericPicks: last?.picks ?? null,
          };
        }),
      ];
    }),
  );
  const task1 = { blocks: task1Blocks, repeats,cityArtistsJonesboroVsKennesaw: { jaccard: cityOverlap("tara-6451", "kennesaw-townpark"), shared: shared("tara-6451", "kennesaw-townpark"), of: cityArtists.get("tara-6451")?.size ?? 0 } };

  const results = {
    note: "Proof lab results. Raw counts; method and limits in data/proof/README.md. Private (Qloo names); publish areas and counts only.",
    radiusM: RADIUS_M,
    locality: { ...locality, genericFoodBusinessPicksWithinRadius: genericFoodNear },
    sameness,
    themes,
    recurring,
    artistNull,
    task1,
    perStore,
  };
  await writeFile(path.join(PROOF, "results.json"), json(results));

  const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "n/a");
  console.log(`Task 2: ${task2.length} stores, ${sameness.pairs} pairs`);
  console.log(`(a) lines naming a place within 1.5 km: Stoop concept ${pct(locality.stoopConcept.naming, locality.stoopConcept.lines)}, Stoop full plan ${pct(locality.stoopAll.naming, locality.stoopAll.lines)}, generic ${pct(locality.generic.naming, locality.generic.lines)}; stores where Stoop names one: ${locality.storesWhereStoopNamesANearbyPlace}/${task2.length}`);
  console.log(`    generic food-business picks with an OSM branch within 1.5 km: ${pct(genericFoodNear, locality.genericFoodBusinessPicks.length)}`);
  const row = (label: string, p: PairStats) => console.log(`    ${label.padEnd(28)} mean Jaccard ${p.meanJaccard ?? "n/a"} over ${p.scored}/${p.pairs} pairs; ${p.sharing} pairs share a pick`);
  console.log("(b) pairwise overlap of named picks:");
  row("Stoop artists", sameness.stoopArtists);
  row("Stoop places", sameness.stoopPlaces);
  row("Stoop artists + places", sameness.stoopAll);
  row("generic artists", sameness.genericArtists);
  row("generic places (food biz)", sameness.genericPlaces);
  row("generic artists + places", sameness.genericArtistsAndPlaces);
  row("generic all named", sameness.genericAllNamed);
  row("Qloo city artists (input)", sameness.qlooCityArtists);
  row("Qloo block places (input)", sameness.qlooBlockPlaces);
  console.log(`    null model for Stoop artists (same counts drawn from each city list): mean ${artistNull.mean}, 90% range ${artistNull.p05} to ${artistNull.p95}`);
  console.log(`themes: ${JSON.stringify(themes)}`);
  console.log(`recurring: ${JSON.stringify(recurring)}`);
  console.log(`task1: ${JSON.stringify(task1, null, 1)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
