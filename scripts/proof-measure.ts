// Proof lab, step 5: the numbers. Deterministic, from the recorded runs (data/proof/runs/ for round 1,
// data/proof/runs-2/ for round 2), the generic-plan extractions (extract.json, extract-2.json) and one
// OpenStreetMap check of the places the generic plans name (cached in data/proof/osm/
// generic-picks-near.json; --fetch fills it, at one Nominatim request per second with the generic
// "stoop-proof" agent).
//
// Measures (method and limits in data/proof/README.md):
//   (a) locality: the share of plan lines that name a place within 1.5 km of that store.
//   (b) sameness: the mean pairwise Jaccard overlap of named picks (artists, places) between stores.
//   plus the sameness of Qloo's own inputs, theme convergence, the chain share of named food picks,
//   the "Qloo decided" lines and the block-music option.
//
// Writes data/proof/results.json: run1 (frozen as first written, Oct 28) and run2 (computed here).
//   npx tsx scripts/proof-measure.ts [--fetch]
import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { refsIn } from "../lib/plan/refs";
import type { PlanReport } from "../lib/plan/schema";
import { isChain } from "../lib/plan/taste";
import type { Extracted } from "./proof-extract";
import { exists, json, loadStores, PROOF, readJson, roundRuns, roundSet, type ProofStore } from "./proof-lib";

const RADIUS_M = 1500;
const NEAR_FILE = path.join(PROOF, "osm", "generic-picks-near.json");
const RESULTS = path.join(PROOF, "results.json");

const haversine = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

/** Names compared across plans: lowercase, no punctuation or accents ("DJ Sample" = "dj sample"). */
const norm = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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
  kind: string;
  text: string;
  refs: string[];
}

function stoopLines(report: PlanReport): Line[] {
  const plan = report.plan;
  if (!plan) return [];
  const kept = plan.concepts.find((c) => c.kept);
  return [
    ...(kept?.items ?? []).map((i) => ({ where: "concept" as const, kind: i.kind, text: i.text, refs: i.refs })),
    ...plan.runOfShow.map((s) => ({ where: "runOfShow" as const, kind: "step", text: s.step, refs: refsIn(s.step) })),
    ...plan.shopping.map((s) => ({ where: "shopping" as const, kind: /gift ?cards?/i.test(s.item) ? "gift_card" : "buy", text: s.item, refs: s.from ? [s.from] : [] })),
    ...(plan.wheel?.slices ?? []).map((s) => ({ where: "wheel" as const, kind: s.kind, text: s.text, refs: s.refs })),
  ];
}

/** What a kept plan uses a block place for: snacks (bought from it), gift cards, partner, theme. */
function rolesOf(report: PlanReport, placeId: string): string[] {
  const roles = new Set<string>();
  const kept = report.plan?.concepts.find((c) => c.kept);
  for (const s of report.plan?.shopping ?? []) if (s.from === placeId) roles.add(/gift ?cards?/i.test(s.item) ? "gift card" : "snacks");
  for (const s of report.plan?.wheel?.slices ?? []) if (s.refs.includes(placeId)) roles.add(s.kind === "gift_card" ? "gift card" : "wheel");
  for (const i of kept?.items ?? []) {
    if (!i.refs.includes(placeId)) continue;
    if (i.kind === "partner") roles.add("partner");
    else if (i.kind === "giveaway" || /gift ?cards?/i.test(i.text)) roles.add("gift card");
    else if (i.kind === "food") roles.add("snacks");
    else roles.add(i.kind);
  }
  return [...roles];
}

// --- The generic plan's named places, checked against OpenStreetMap ----------------------------

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

/** The parts of a store's own address and area: naming them is not naming a place on the block. */
function isOwn(s: ProofStore, name: string): boolean {
  const n = norm(name);
  const own = new Set([norm(s.address), ...s.address.split(",").map(norm), norm(s.qlooCity), norm(s.qlooCity.replace(/, GA$/, "")), "georgia", "ga", "atlanta", "gwinnett", "cobb", "dekalb", "clayton", "fulton", "texas", "tx", "dallas", "fort worth", "dfw", "metroplex", "north texas", "tarrant", "collin"]);
  if (own.has(n)) return true;
  // A county, or a part of town ("Downtown Atlanta", "East Atlanta"): an area, not a place to go.
  if (/\bcounty\b/.test(n) || /^(downtown|midtown|uptown|east|west|north|south)\s/.test(n)) return true;
  // A street of the store's own address, written another way ("Elm Rd" for "12 Elm Road").
  const street = norm(s.address.split(",")[0] ?? "").replace(/^\d+\s+/, "");
  const stem = (x: string) => x.replace(/\b(boulevard|blvd|road|rd|street|st|drive|dr|highway|hwy|lane|ln|avenue|ave|sw|se|ne|nw|north|south|east|west|suite|ste|[a-z])\b/g, "").replace(/\s+/g, " ").trim();
  return stem(n).length > 0 && stem(street).includes(stem(n));
}

const PAYDAY = /\bpay ?day\b/i;
const VETERANS = /\bveterans?\b/i;
const STOP = new Set(["the", "a", "an", "and", "of", "for", "on", "at", "to", "with", "in", "your", "our", "this", "friday", "table", "stop", "s"]);
const words = (text: string) => new Set(norm(text.split(":")[0] ?? text).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

interface GenericAnswer {
  items?: unknown[];
  picks?: { artists?: string[]; foods?: string[]; places?: string[] };
}

// --- One round --------------------------------------------------------------------------------

async function compute(round: number, near: Near, fetchMissing: boolean) {
  const RUNS = roundRuns(round);
  const stores = loadStores().filter((s) => exists(path.join(RUNS, s.id, "plan.report.json")));
  const reports = new Map(stores.map((s) => [s.id, readJson<PlanReport>(path.join(RUNS, s.id, "plan.report.json"))]));
  const extract = readJson<{ plans: Record<string, { lines: string[]; extracted: Extracted | null }> }>(path.join(PROOF, round === 1 ? "extract.json" : `extract-${round}.json`)).plans;
  const lastGeneric = (dir: string) => [...readJson<{ answers: GenericAnswer[] }>(path.join(dir, "generic.json")).answers].reverse().find((g) => (g.items?.length ?? 0) >= 4) ?? null;

  const perStore: Record<string, Record<string, unknown>> = {};
  const stoopArtists = new Map<string, Set<string>>();
  const stoopPlaces = new Map<string, Set<string>>();
  const genericArtists = new Map<string, Set<string>>();
  const genericPlaces = new Map<string, Set<string>>();
  const cityArtists = new Map<string, Set<string>>();
  const blockPlaces = new Map<string, Set<string>>();
  const counters = {
    stoopConceptLines: 0, stoopConceptNaming: 0, stoopAllLines: 0, stoopAllNaming: 0, genericLines: 0, genericNaming: 0,
    stoopFoodPicks: 0, stoopFoodChains: 0, genericFoodPicks: 0, genericFoodChains: 0, genericNamedPlaces: 0, genericNamedPlacesNear: 0,
    storesWhereStoopNamesNearby: 0, storesWhereGenericNamesNearby: 0,
  };
  const decidedParts = new Map<string, number>();

  for (const s of stores) {
    const report = reports.get(s.id) as PlanReport;
    const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));
    const artistNames = new Map<string, string>([...(report.local.city?.artists ?? []), ...(report.local.blockMusic?.artists ?? [])].map((a) => [a.id, a.name] as const));
    const chain = (id: string) => {
      const p = places.get(id);
      return !!p && (p.chain ?? isChain(p.name));
    };
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
    const usedArtists = [...new Set(lines.flatMap((l) => l.refs).filter((id) => artistNames.has(id)))];
    const foodPlaces = usedPlaces.filter((id) => places.get(id)?.kind === "food" || places.get(id)?.kind === "shop");
    // By name, so two branches of the same chain (different Qloo ids) count as the same pick.
    stoopPlaces.set(s.id, new Set(usedPlaces.map((id) => norm(places.get(id)?.name ?? id))));
    stoopArtists.set(s.id, new Set(usedArtists.map((id) => norm(artistNames.get(id) ?? id))));

    // Generic: lines (as shown), the places it says it names, and the named things the extraction found.
    const ex = (extract[s.id]?.extracted?.entities ?? []).filter((e) => e.type !== "other");
    const gLines = report.baseline?.items ?? [];
    const gAnswer = lastGeneric(path.join(RUNS, s.id));
    const placeTypes = new Set(["food_business", "place", "other_business"]);
    const listed = (gAnswer?.picks?.places ?? []).map((name) => ({ name, type: "listed_place", line: null as number | null }));
    const gNamedPlaces = [...ex.filter((e) => placeTypes.has(e.type)), ...listed].filter((e, i, all) => !isOwn(s, e.name) && all.findIndex((x) => norm(x.name) === norm(e.name)) === i);
    for (const e of gNamedPlaces) {
      const key = nearKey(s.id, e.name);
      if (!near[key] && fetchMissing) near[key] = await fetchNear(s, e.name);
    }
    const within = (name: string) => {
      const hit = near[nearKey(s.id, name)];
      return hit ? hit.nearestM !== null && hit.nearestM <= RADIUS_M : null;
    };
    const lineNames = (i: number) => gNamedPlaces.filter((e) => e.line === i + 1 || (e.line === null && String((gLines[i] as { text: string }).text).toLowerCase().includes(e.name.toLowerCase())));
    const gLineNearby = gLines.map((_, i) => lineNames(i).some((e) => within(e.name) === true));
    const gFood = [...ex.filter((e) => e.type === "food_business"), ...listed].filter((e, i, all) => !isOwn(s, e.name) && all.findIndex((x) => norm(x.name) === norm(e.name)) === i);
    genericArtists.set(s.id, new Set(ex.filter((e) => e.type === "artist").map((e) => norm(e.name))));
    genericPlaces.set(s.id, new Set(gNamedPlaces.map((e) => norm(e.name))));

    counters.stoopConceptLines += concept.length;
    counters.stoopConceptNaming += concept.filter(nearbyRef).length;
    counters.stoopAllLines += lines.length;
    counters.stoopAllNaming += lines.filter(nearbyRef).length;
    counters.genericLines += gLines.length;
    counters.genericNaming += gLineNearby.filter(Boolean).length;
    counters.stoopFoodPicks += foodPlaces.length;
    counters.stoopFoodChains += foodPlaces.filter(chain).length;
    counters.genericFoodPicks += gFood.length;
    counters.genericFoodChains += gFood.filter((e) => isChain(e.name)).length;
    counters.genericNamedPlaces += gNamedPlaces.length;
    counters.genericNamedPlacesNear += gNamedPlaces.filter((e) => within(e.name) === true).length;
    if (lines.some(nearbyRef)) counters.storesWhereStoopNamesNearby++;
    if (gLineNearby.some(Boolean)) counters.storesWhereGenericNamesNearby++;

    const decided = (report.comparison?.lines ?? []).filter((l) => l.startsWith("Qloo decided:") || l.startsWith("Without Qloo"));
    const parts = (decided.find((l) => l.startsWith("Qloo decided:")) ?? "").replace(/^Qloo decided: /, "").replace(/\.$/, "").split(/, | and /).filter(Boolean);
    for (const part of new Set(parts.map((p) => p.replace(/^the (two|three|four) /, "the ").replace(/s$/, "")))) decidedParts.set(part, (decidedParts.get(part) ?? 0) + 1);
    const kept = report.plan?.concepts.find((c) => c.kept);
    const bm = report.local.blockMusic;
    perStore[s.id] = {
      area: s.area,
      sets: s.sets,
      qloo: {
        cityLocality: report.local.city?.city ?? null,
        cityArtists: report.local.city?.artists.length ?? 0,
        styles: report.local.city?.styles.map((x) => x.name) ?? [],
        blockPlaces: places.size,
        blockChains: [...places.keys()].filter(chain).length,
        gaps: report.local.gaps,
        blockMusic: bm ? { used: bm.used, reason: bm.reason, signal: bm.placeIds.map((id) => places.get(id)?.name ?? id), artists: bm.artists.map((a) => ({ name: a.name, genres: a.genres.slice(0, 3), via: a.via.map((id) => places.get(id)?.name ?? id) })) } : null,
      },
      stoop: {
        keptTitle: kept?.title ?? null,
        keptHook: kept?.hook ?? null,
        conceptLines: concept.length,
        conceptLinesNamingNearbyPlace: concept.filter(nearbyRef).length,
        allLines: lines.length,
        allLinesNamingNearbyPlace: lines.filter(nearbyRef).length,
        conceptLinesWithReceipt: report.comparison?.qlooBacked.items ?? null,
        placesUsed: usedPlaces.map((id) => ({ name: places.get(id)?.name, kind: places.get(id)?.kind, distanceM: places.get(id)?.distanceM, chain: chain(id), roles: rolesOf(report, id) })),
        artistsUsed: usedArtists.map((id) => artistNames.get(id)),
        paydayLines: lines.filter((l) => PAYDAY.test(l.text)).length,
        qlooDecided: decided,
      },
      generic: {
        lines: gLines.length,
        linesNamingNearbyPlace: gLineNearby.filter(Boolean).length,
        theme: gLines.find((i) => i.kind === "theme")?.text ?? null,
        namedInLines: ex.filter((e) => e.line !== null).map((e) => `${e.name} [${e.type}${isOwn(s, e.name) ? ", the store's own address or area" : ""}]`),
        listedPlaces: gAnswer?.picks?.places ?? null,
        artists: ex.filter((e) => e.type === "artist").map((e) => e.name),
        namedPlaces: gNamedPlaces.map((e) => ({ name: e.name, type: e.type, chain: isChain(e.name), nearestOsmM: near[nearKey(s.id, e.name)]?.nearestM ?? null })),
        foodPicks: ex.filter((e) => e.type === "food_business" || e.type === "product_brand").map((e) => ({ name: e.name, type: e.type, nearestOsmM: e.type === "food_business" ? (near[nearKey(s.id, e.name)]?.nearestM ?? null) : null })),
        cliches: report.baseline?.cliches.map((c) => c.text) ?? [],
        qlooCheck: report.baseline?.check ? { checkable: report.baseline.check.checkable, belowMedian: report.baseline.check.belowMedian, unverifiable: report.baseline.check.unverifiable } : null,
      },
    };
  }

  const task2 = stores.filter((s) => s.sets.includes(roundSet(round))).map((s) => s.id);
  // Task 2 counters only: recount over the Task 2 stores.
  const t2 = { ...counters };
  for (const k of Object.keys(t2) as (keyof typeof t2)[]) t2[k] = 0;
  for (const id of task2) {
    const row = perStore[id] as { stoop: Record<string, unknown>; generic: Record<string, unknown> };
    const st = row.stoop as { conceptLines: number; conceptLinesNamingNearbyPlace: number; allLines: number; allLinesNamingNearbyPlace: number; placesUsed: { kind: string; chain: boolean }[] };
    const ge = row.generic as { lines: number; linesNamingNearbyPlace: number; namedPlaces: { type: string; chain: boolean; nearestOsmM: number | null }[] };
    t2.stoopConceptLines += st.conceptLines;
    t2.stoopConceptNaming += st.conceptLinesNamingNearbyPlace;
    t2.stoopAllLines += st.allLines;
    t2.stoopAllNaming += st.allLinesNamingNearbyPlace;
    t2.genericLines += ge.lines;
    t2.genericNaming += ge.linesNamingNearbyPlace;
    const food = st.placesUsed.filter((p) => p.kind === "food" || p.kind === "shop");
    t2.stoopFoodPicks += food.length;
    t2.stoopFoodChains += food.filter((p) => p.chain).length;
    const gFood = ge.namedPlaces.filter((p) => p.type === "food_business" || p.type === "listed_place");
    t2.genericFoodPicks += gFood.length;
    t2.genericFoodChains += gFood.filter((p) => p.chain).length;
    t2.genericNamedPlaces += ge.namedPlaces.length;
    t2.genericNamedPlacesNear += ge.namedPlaces.filter((p) => p.nearestOsmM !== null && p.nearestOsmM <= RADIUS_M).length;
    if (st.allLinesNamingNearbyPlace > 0) t2.storesWhereStoopNamesNearby++;
    if (ge.linesNamingNearbyPlace > 0) t2.storesWhereGenericNamesNearby++;
  }

  const sameness = {
    pairs: (task2.length * (task2.length - 1)) / 2,
    stoopArtists: pairwise(task2, stoopArtists),
    stoopPlaces: pairwise(task2, stoopPlaces),
    stoopAll: pairwise(task2, new Map(task2.map((id) => [id, new Set([...(stoopArtists.get(id) ?? []), ...(stoopPlaces.get(id) ?? [])])]))),
    genericArtists: pairwise(task2, genericArtists),
    genericPlaces: pairwise(task2, genericPlaces),
    genericArtistsAndPlaces: pairwise(task2, new Map(task2.map((id) => [id, new Set([...(genericArtists.get(id) ?? []), ...(genericPlaces.get(id) ?? [])])]))),
    qlooCityArtists: pairwise(task2, cityArtists),
    qlooBlockPlaces: pairwise(task2, blockPlaces),
    stoopTitleWords: pairwise(task2, new Map(task2.map((id) => [id, words(reports.get(id)?.plan?.concepts.find((c) => c.kept)?.title ?? "")]))),
    genericThemeWords: pairwise(task2, new Map(task2.map((id) => [id, words(reports.get(id)?.baseline?.items.find((i) => i.kind === "theme")?.text ?? "")]))),
  };
  const keptOf = (id: string) => reports.get(id)?.plan?.concepts.find((c) => c.kept);
  const genericTheme = (id: string) => reports.get(id)?.baseline?.items.find((i) => i.kind === "theme")?.text ?? "";
  const themes = {
    stores: task2.length,
    stoopKeptTitlesWithPayday: task2.filter((id) => PAYDAY.test(keptOf(id)?.title ?? "")).length,
    stoopKeptTitleOrHookWithPayday: task2.filter((id) => PAYDAY.test(`${keptOf(id)?.title ?? ""} ${keptOf(id)?.hook ?? ""}`)).length,
    stoopPlansWithPaydayInAnyLine: task2.filter((id) => stoopLines(reports.get(id) as PlanReport).some((l) => PAYDAY.test(l.text))).length,
    genericThemesWithPayday: task2.filter((id) => PAYDAY.test(genericTheme(id))).length,
    stoopKeptTitlesWithVeterans: task2.filter((id) => VETERANS.test(keptOf(id)?.title ?? "")).length,
    genericThemesWithVeterans: task2.filter((id) => VETERANS.test(genericTheme(id))).length,
    stoopKeptTitlesWithWheel: task2.filter((id) => /wheel|spin/i.test(keptOf(id)?.title ?? "")).length,
    stoopPlansWithWheel: task2.filter((id) => !!reports.get(id)?.plan?.wheel).length,
  };

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
  // random from its own city list.
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
    const stats = pairwise(task2, new Map(task2.map((id) => [id, draw([...(cityArtists.get(id) ?? [])], stoopArtists.get(id)?.size ?? 0)])));
    if (stats.meanJaccard !== null) nullValues.push(stats.meanJaccard);
  }
  nullValues.sort((a, b) => a - b);
  const artistNull = { draws: nullValues.length, mean: Number((nullValues.reduce((x, y) => x + y, 0) / nullValues.length).toFixed(3)), p05: nullValues[Math.floor(0.05 * nullValues.length)], p95: nullValues[Math.floor(0.95 * nullValues.length)] };

  // Task 1: the food spots on each block whose Qloo tags (or plain name) say Mexican, and what each
  // run's plan used them for. Measured, never typed into the inputs.
  const MEXICAN = /mexic|taquer|\btacos?\b|torta|tex[- ]?mex|burrito/i;
  const isMexican = (p: { name: string; tags: string[] }) => /mexic|taquer|torta/i.test(p.name) || p.tags.some((t) => MEXICAN.test(t));
  const task1Runs = Object.fromEntries(
    ["tara-6451", "kennesaw-townpark", "tara-8053", "tara-8564"].filter((id) => exists(path.join(RUNS, id))).map((id) => {
      const keys = [id, ...readdirSync(RUNS).filter((k) => k.startsWith(`${id}-r`)).sort()];
      return [
        id,
        keys.map((k) => {
          const r = readJson<PlanReport>(path.join(RUNS, k, "plan.report.json"));
          const names = new Map<string, string>([...(r.local.city?.artists ?? []), ...(r.local.blockMusic?.artists ?? [])].map((a) => [a.id, a.name] as const));
          for (const p of r.local.block?.places ?? []) names.set(p.id, p.name);
          const mex = (r.local.block?.places ?? []).filter((p) => p.kind === "food" && isMexican(p));
          const keptRefs = new Set(stoopLines(r).flatMap((l) => l.refs));
          const anyRefs = new Set((r.plan?.concepts ?? []).flatMap((c) => c.items.flatMap((i) => i.refs)));
          const g = lastGeneric(path.join(RUNS, k));
          const kept = r.plan?.concepts.find((c) => c.kept);
          return {
            run: k,
            keptTitle: kept?.title ?? null,
            keptHook: kept?.hook ?? null,
            keptMusic: kept?.items.filter((i) => i.kind === "music").map((i) => i.text) ?? [],
            keptPlaces: [...keptRefs].filter((x) => (r.local.block?.places ?? []).some((p) => p.id === x)).map((x) => ({ name: names.get(x), roles: rolesOf(r, x) })),
            mexicanSpots: mex.map((p) => ({ name: p.name, distanceM: p.distanceM, chain: p.chain ?? isChain(p.name), keptRoles: keptRefs.has(p.id) ? rolesOf(r, p.id) : [], inAnyConcept: anyRefs.has(p.id) })),
            conceptsUsingMexican: (r.plan?.concepts ?? []).filter((c) => c.items.some((i) => i.refs.some((x) => mex.some((m) => m.id === x)))).length,
            concepts: r.plan?.concepts.length ?? 0,
            blockMusic: r.local.blockMusic ? { used: r.local.blockMusic.used, reason: r.local.blockMusic.reason, artists: r.local.blockMusic.artists.map((a) => `${a.name} (${a.genres.slice(0, 2).join(", ")})`) } : null,
            qlooDecided: (r.comparison?.lines ?? []).filter((l) => l.startsWith("Qloo decided:")),
            genericMusic: r.baseline?.items.find((i) => i.kind === "music")?.text ?? null,
            genericFood: r.baseline?.items.find((i) => i.kind === "food")?.text ?? null,
            genericPicks: g?.picks ?? null,
          };
        }),
      ];
    }),
  );
  const shared = (a: string, b: string) => [...(cityArtists.get(a) ?? [])].filter((x) => cityArtists.get(b)?.has(x)).length;
  const task1 = { runs: task1Runs, cityArtistsJonesboroVsKennesaw: { jaccard: jaccard(cityArtists.get("tara-6451") ?? new Set(), cityArtists.get("kennesaw-townpark") ?? new Set()), shared: shared("tara-6451", "kennesaw-townpark"), of: cityArtists.get("tara-6451")?.size ?? 0 } };

  // The block-music option: tested, offered to the planner ("used" in the report), and whether any
  // concept or the kept plan actually plays one of its artists. Plus how alike the offered lists are.
  const bmIds = (id: string) => new Set(reports.get(id)?.local.blockMusic?.artists.map((a) => a.id) ?? []);
  const offered = task2.filter((id) => !!reports.get(id)?.local.blockMusic?.used);
  const blockMusic = {
    tested: task2.filter((id) => !!reports.get(id)?.local.blockMusic).length,
    offered: offered.length,
    keptPlansPlayingIt: task2.filter((id) => stoopLines(reports.get(id) as PlanReport).some((l) => l.refs.some((x) => bmIds(id).has(x)))).length,
    conceptsPlayingIt: task2.reduce((n, id) => n + (reports.get(id)?.plan?.concepts ?? []).filter((c) => c.items.some((i) => i.refs.some((x) => bmIds(id).has(x)))).length, 0),
    overlapAmongOffered: pairwise(offered, new Map(offered.map((id) => [id, new Set(reports.get(id)?.local.blockMusic?.artists.map((a) => norm(a.name)) ?? [])]))),
    reasons: Object.fromEntries(task2.map((id) => [id, reports.get(id)?.local.blockMusic?.reason ?? null])),
  };
  // Kept titles that are the pipeline's safe template (Claude's title broke a rule twice).
  const SAFE_HOOK = "A free spin, something to eat and the store's own deals, right outside the door.";
  const safeTitles = task2.filter((id) => keptOf(id)?.hook === SAFE_HOOK).length;

  return {
    round,
    radiusM: RADIUS_M,
    locality: {
      stores: task2.length,
      stoopConcept: { lines: t2.stoopConceptLines, naming: t2.stoopConceptNaming },
      stoopAll: { lines: t2.stoopAllLines, naming: t2.stoopAllNaming },
      generic: { lines: t2.genericLines, naming: t2.genericNaming },
      storesWhereStoopNamesANearbyPlace: t2.storesWhereStoopNamesNearby,
      storesWhereGenericNamesANearbyPlace: t2.storesWhereGenericNamesNearby,
      genericNamedPlaces: t2.genericNamedPlaces,
      genericNamedPlacesWithin1500m: t2.genericNamedPlacesNear,
      /** Businesses only (food spots, other businesses, places it listed), not landmarks, streets or history. */
      genericNamedBusinesses: task2.reduce((n, id) => n + ((perStore[id] as { generic: { namedPlaces: { type: string }[] } }).generic.namedPlaces.filter((p) => p.type !== "place").length), 0),
    },
    chainShare: { stoop: { foodPicks: t2.stoopFoodPicks, chains: t2.stoopFoodChains }, generic: { foodPicks: t2.genericFoodPicks, chains: t2.genericFoodChains } },
    sameness,
    themes: { ...themes, keptTitlesFromTheSafeTemplate: safeTitles },
    qlooDecided: Object.fromEntries([...decidedParts.entries()].sort((a, b) => b[1] - a[1])),
    blockMusic,
    recurring,
    artistNull,
    task1,
    perStore,
  };
}

async function main(): Promise<void> {
  const fetchMissing = process.argv.includes("--fetch");
  const near: Near = exists(NEAR_FILE) ? readJson<Near>(NEAR_FILE) : {};
  // Round 1 stays as first written (Oct 28, pipeline 0a7c3fb): its numbers are the comparison point.
  const previous = exists(RESULTS) ? readJson<Record<string, unknown>>(RESULTS) : null;
  const run1 = previous ? ((previous.run1 as Record<string, unknown> | undefined) ?? previous) : null;
  const run2 = await compute(2, near, fetchMissing);
  const run3 = exists(roundRuns(3)) ? await compute(3, near, fetchMissing) : null;
  // Round 1 recomputed with today's counters and chain list, for the measures run 1 did not have.
  const run1Now = await compute(1, near, false);
  const comparison = {
    note: "Both rounds computed with the same code and the current chain list (round 1's frozen numbers used the chain list of Oct 28).",
    chainShare: { run1: run1Now.chainShare, run2: run2.chainShare, run3: run3?.chainShare ?? null },
    themes: { run1: run1Now.themes, run2: run2.themes, run3: run3?.themes ?? null },
    titleWords: { run1: { stoop: run1Now.sameness.stoopTitleWords, generic: run1Now.sameness.genericThemeWords }, run2: { stoop: run2.sameness.stoopTitleWords, generic: run2.sameness.genericThemeWords }, run3: run3 ? { stoop: run3.sameness.stoopTitleWords, generic: run3.sameness.genericThemeWords } : null },
    locality: { run1: run1Now.locality, run2: run2.locality, run3: run3?.locality ?? null },
  };
  if (fetchMissing) await writeFile(NEAR_FILE, json(near));
  await writeFile(
    RESULTS,
    json({
      note: "Proof lab results. Raw counts; method and limits in data/proof/README.md. Private (Qloo names); publish areas and counts only. run1: Oct 28 on pipeline 0a7c3fb, frozen as first written. run2: the same stores and inputs on the fixed pipeline (pivot-store-events 6d0f5cb).",
      run1,
      run2,
      run3,
      comparison,
    }),
  );

  const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "n/a");
  const { locality: l, sameness: sm, chainShare: cs } = run2;
  console.log(`Round 2, Task 2: ${l.stores} stores, ${sm.pairs} pairs`);
  console.log(`(a) lines naming a place within 1.5 km: Stoop concept ${pct(l.stoopConcept.naming, l.stoopConcept.lines)}, full plan ${pct(l.stoopAll.naming, l.stoopAll.lines)}, generic ${pct(l.generic.naming, l.generic.lines)}; stores: Stoop ${l.storesWhereStoopNamesANearbyPlace}, generic ${l.storesWhereGenericNamesANearbyPlace}; generic named places ${l.genericNamedPlaces}, within 1.5 km ${l.genericNamedPlacesWithin1500m}`);
  console.log(`chain share of named food picks: Stoop ${pct(cs.stoop.chains, cs.stoop.foodPicks)}, generic ${pct(cs.generic.chains, cs.generic.foodPicks)}`);
  const row = (label: string, p: PairStats) => console.log(`    ${label.padEnd(26)} mean Jaccard ${p.meanJaccard ?? "n/a"} over ${p.scored}/${p.pairs} pairs; ${p.sharing} pairs share`);
  console.log("(b) pairwise overlap:");
  for (const [k, v] of Object.entries(sm)) if (typeof v === "object") row(k, v);
  console.log(`    null model for Stoop artists: mean ${run2.artistNull.mean}, 90% range ${run2.artistNull.p05} to ${run2.artistNull.p95}`);
  console.log(`themes: ${JSON.stringify(run2.themes)}`);
  console.log(`qloo decided: ${JSON.stringify(run2.qlooDecided)}`);
  console.log(`block music: ${JSON.stringify({ ...run2.blockMusic, reasons: undefined })}`);
  console.log(`comparison: ${JSON.stringify({ chainShare: comparison.chainShare, titleWords: comparison.titleWords, themes: comparison.themes })}`);
  console.log(`recurring: ${JSON.stringify(run2.recurring)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
