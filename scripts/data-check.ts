// Gate 2 data check. Writes recipes for `fixtures:record` (no calls here), builds the frozen
// reference panels, and analyzes the recordings in replay mode (QLOO_MODE=fixtures semantics: every
// read goes through the real client and a FixtureCache; a missing recording throws, nothing goes live).
//
//   npm run data-check -- plan resolve|audience|segments|scoring|missing|reference
//   npm run data-check -- panels
//   npm run data-check -- analyze
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CANDIDATES } from "../lib/demo/candidates";
import { createQlooClient } from "../lib/qloo/client";
import { createRunContext } from "../lib/qloo/context";
import { FixtureCache, findFixture } from "../lib/qloo/fixtures";
import { cacheKey } from "../lib/qloo/params";
import { seedType } from "../lib/demo/seed-types";
import {
  buildReferenceHeatmap,
  COVERAGE_FLOOR,
  gridCoverage,
  rankCities,
  type RankedCity,
  type ReferenceSets,
  acceptLocality,
  localityName,
  METROS,
  placeAnchor,
  shortMetroName,
  type HeatmapPoint,
  type ReferenceHeatmap,
} from "../lib/geo/metros";
import type { AgeBucket } from "../lib/qloo/constants";
import { demographicsResponse, heatmapResponse, insightsEntitiesResponse, insightsTagsResponse, searchResponse, type QlooEntity, type QlooTag } from "../lib/qloo/types";
import {
  ageBandLabel,
  ageGap,
  bucketsForBand,
  buildPanel,
  choicePosition,
  cityRank,
  guessedMetro,
  meanSkew,
  pickSegmentBuckets,
  rankedBuckets,
  signalLevel,
  topOverlap,
  type PanelCandidate,
  type SignalLevel,
} from "../lib/data-check/score";
import { checkText } from "../lib/guardrails";
import { loadPanels as readPanelsFile, PANELS_FILE, type ReferencePanels } from "../lib/culture/panels";
import {
  placesId,
  scoringId,
  segmentId,
  audienceId,
  audienceRequests,
  localityRequest,
  ENTITY_TYPES_SCORED,
  scoringRequests,
  segmentRequests,
  TAG_KINDS,
  type ScoredType,
  type TagKind,
  clientLookup,
  controlText,
  loadRuns,
  mapTag,
  PLACE_GENRE_QUERIES,
  resolveName,
  resolveRecipe,
  toneTag,
  type ControlText,
  type Lookup,
  type MappedTag,
  type PlannedRequest,
  type Recipe,
  type Resolved,
} from "../lib/data-check/plan";
import type { Candidate } from "../lib/demo/candidates";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function writeRecipe(name: string, recipe: Recipe): Promise<void> {
  const file = path.join("fixtures", "recipes", `${name}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(recipe, null, 2)}\n`);
  console.log(`Wrote ${file}: ${recipe.requests.length} requests. Record with: npm run fixtures:record -- ${name}`);
}

export function replayLookup() {
  const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
  return clientLookup(client, createRunContext({ runId: "data-check", cap: 0 }));
}

const controls = () => CANDIDATES.map((c) => controlText(c, loadRuns(c.slug)));

export interface Resolution {
  candidate: Candidate;
  control: ControlText;
  seeds: Resolved[];
  references: Resolved[];
  music: MappedTag;
  tone: MappedTag;
}

async function resolveAll(lookup: Lookup): Promise<{ resolutions: Resolution[]; placeGenres: MappedTag[] }> {
  const resolutions: Resolution[] = [];
  for (const [index, candidate] of CANDIDATES.entries()) {
    const control = controls()[index];
    resolutions.push({
      candidate,
      control,
      seeds: await Promise.all(candidate.seeds.map((seed) => resolveName(seed, seedType(seed), lookup))),
      references: await Promise.all(control.references.map((ref) => resolveName(ref.name, ref.type, lookup))),
      music: await mapTag("music", control.musicTerm, lookup),
      tone: toneTag(control.moodTerm),
    });
  }
  const placeGenres = await Promise.all(PLACE_GENRE_QUERIES.map((q) => mapTag("place", q, lookup)));
  return { resolutions, placeGenres };
}

const seedIds = (r: Resolution) => r.seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));

async function planAudience(): Promise<void> {
  const { resolutions, placeGenres } = await resolveAll(replayLookup());
  for (const r of resolutions) {
    const dropped = r.seeds.filter((s) => !s.entity).map((s) => s.query);
    console.log(
      `${r.candidate.slug.padEnd(18)} seeds ${seedIds(r).length}/${r.seeds.length}${dropped.length ? ` (dropped: ${dropped.join(", ")})` : ""}` +
        ` | refs ${r.references.map((x) => `${x.query}:${x.entity ? "ok" : "dropped"}`).join(", ") || "none"}` +
        ` | music "${r.music.term}" -> ${r.music.tag ? `${r.music.tag.name} (${r.music.similarity?.toFixed(2)})` : "unverifiable"} | mood "${r.tone.term}" -> ${r.tone.tag?.id} (built)`,
    );
  }
  console.log(`place genres: ${placeGenres.map((g) => `${g.term} -> ${g.tag ? `${g.tag.name} (${g.tag.id})` : "none"}`).join("; ")}`);
  const requests = resolutions.flatMap((r) => {
    if (seedIds(r).length < 2) fail(`${r.candidate.slug} resolved fewer than 2 seeds; fix its seeds before spending audience calls.`);
    return audienceRequests(r.candidate.slug, seedIds(r));
  });
  await writeRecipe("pool-audience", {
    description: "Gate 2 stage 2: each candidate's whole audience from its resolved seeds: demographics, a US heatmap, top artists, brands, films and TV shows, and top music and emotional-tone tags.",
    requests,
  });
}

// --- Stage 2 readers ---------------------------------------------------------------------------

export interface Audience {
  resolution: Resolution;
  seedIds: string[];
  skew: ReturnType<typeof meanSkew>;
  buckets: AgeBucket[];
  metros: RankedCity[];
  smallSetOnly: ReturnType<typeof rankCities>["smallSetOnly"];
  cells: HeatmapPoint[];
  entities: Record<ScoredType, QlooEntity[]>;
  tags: Record<TagKind, QlooTag[]>;
}

function audienceRequest(resolution: Resolution, what: string) {
  const request = audienceRequests(resolution.candidate.slug, seedIds(resolution)).find((r) => r.id === audienceId(resolution.candidate.slug, what));
  if (!request) throw new Error(`no audience request ${what}`);
  return request;
}

async function readAudience(resolution: Resolution, cells: HeatmapPoint[], sets: ReferenceSets, lookup: Lookup): Promise<Audience> {
  const skew = meanSkew(await lookup(audienceRequest(resolution, "demographics"), demographicsResponse));
  const entities = {} as Record<ScoredType, QlooEntity[]>;
  for (const type of ENTITY_TYPES_SCORED) entities[type] = await lookup(audienceRequest(resolution, type), insightsEntitiesResponse);
  const tags = {} as Record<TagKind, QlooTag[]>;
  for (const kind of Object.keys(TAG_KINDS) as TagKind[]) tags[kind] = await lookup(audienceRequest(resolution, `tags-${kind}`), insightsTagsResponse);
  // This audience is one of the reference audiences, so its own cells are left out (leave-one-out).
  const { cities, smallSetOnly } = rankCities(cells, sets, { own: true });
  return { resolution, seedIds: seedIds(resolution), skew, buckets: pickSegmentBuckets(skew.age), metros: cities, smallSetOnly, cells, entities, tags };
}

/** Every recorded reference-audience request (both batches), rebuilt from code so replay keys match. */
function referenceRequests(panels: ReferencePanels): PlannedRequest[] {
  const heatmap = (signal: Record<string, string[]>) => ({ "filter.type": "urn:heatmap", ...signal, "filter.location.query": "United States" });
  const entities = ENTITY_TYPES_SCORED.flatMap((type) =>
    spread(panels.entity[type], REFERENCE_PICKS[type]).map((entry) => ({
      id: referenceAudienceId(type, entry.id),
      endpoint: "/v2/insights" as const,
      params: heatmap({ "signal.interests.entities": [entry.id] }),
      note: `Reference audience: fans of ${entry.name} (${type}, popularity ${entry.popularity.toFixed(2)}).`,
    })),
  );
  const tags = spread(panels.tag.music, REFERENCE_TAG_PICKS).map((entry) => ({
    id: referenceAudienceId("music-tag", entry.id.replace(/[^a-z0-9]+/gi, "-")),
    endpoint: "/v2/insights" as const,
    params: heatmap({ "signal.interests.tags": [entry.id] }),
    note: `Reference audience: listeners of ${entry.name} (music tag).`,
  }));
  return [...entities, ...tags];
}

/**
 * The two reference sets for city ranking: the 9 candidates on their shared grid, and the full set
 * (the candidates plus every recorded reference audience that covers at least COVERAGE_FLOOR of
 * that grid; sparser ones would mostly add bottom-tied cells, which is noise). Reference audiences
 * are picked from the panels, so the `panels` command itself, on a fresh recording, may run before
 * they exist (`firstPanels`): then the full set is the candidates alone. Every other command needs them.
 */
async function buildReferenceSets(
  candidateHeatmaps: HeatmapPoint[][],
  lookup: Lookup,
  firstPanels = false,
): Promise<{ sets: ReferenceSets; dense: string[]; sparse: string[] }> {
  const candidates = buildReferenceHeatmap(candidateHeatmaps);
  const grid = new Set(candidates.keys());
  const panels = firstPanels && !existsSync(PANELS_FILE) ? null : await loadPanels();
  const dense: { id: string; cells: HeatmapPoint[] }[] = [];
  const sparse: string[] = [];
  for (const request of panels ? referenceRequests(panels) : []) {
    const cells = await lookup(request, heatmapResponse);
    if (gridCoverage(cells, grid) >= COVERAGE_FLOOR) dense.push({ id: request.id, cells });
    else sparse.push(request.id);
  }
  const full = buildReferenceHeatmap([...candidateHeatmaps, ...dense.map((d) => d.cells)], grid);
  const candidateIds = CANDIDATES.map((c) => `candidate--${c.slug}`);
  return {
    sets: {
      candidates: { audiences: candidateHeatmaps.length, members: candidateIds, cells: candidates },
      full: { audiences: candidateHeatmaps.length + dense.length, members: [...candidateIds, ...dense.map((d) => d.id)], cells: full },
    },
    dense: dense.map((d) => d.id),
    sparse,
  };
}

async function readAllAudiences(firstPanels = false): Promise<{ audiences: Audience[]; placeGenres: MappedTag[]; sets: ReferenceSets; dense: string[]; sparse: string[] }> {
  const lookup = replayLookup();
  const { resolutions, placeGenres } = await resolveAll(lookup);
  const heatmaps: HeatmapPoint[][] = [];
  for (const resolution of resolutions) heatmaps.push(await lookup(audienceRequest(resolution, "heatmap"), heatmapResponse));
  const { sets, dense, sparse } = await buildReferenceSets(heatmaps, lookup, firstPanels);
  const audiences: Audience[] = [];
  for (const [index, resolution] of resolutions.entries()) audiences.push(await readAudience(resolution, heatmaps[index], sets, lookup));
  return { audiences, placeGenres, sets, dense, sparse };
}

/** The metro's principal city as a verified Qloo locality, or null when no result has the right name and state. */
async function topLocality(a: Audience, lookup: Lookup) {
  const metro = a.metros[0].metro;
  const { city, state } = localityName(metro);
  const results = await lookup(localityRequest(city, state), searchResponse, []);
  const hit = acceptLocality(results, metro);
  return hit ? { id: hit.id, name: hit.name, disambiguation: hit.disambiguation ?? "" } : null;
}

/** Place queries go to the verified locality; with none, to the metro's densest cell (point and radius). */
async function placeAnchorFor(a: Audience, lookup: Lookup) {
  const locality = await topLocality(a, lookup);
  return { locality, anchor: locality ? { "filter.location": locality.id } : placeAnchor(a.metros[0]) };
}

async function planSegments(): Promise<void> {
  const { audiences, placeGenres } = await readAllAudiences();
  const lookup = replayLookup();
  const placeTags = placeGenres.flatMap((g) => (g.tag ? [g.tag.id] : []));
  const requests: PlannedRequest[] = [];
  for (const a of audiences) {
    if (!a.metros[0]) fail(`${a.resolution.candidate.slug} has no dense metro in its heatmap.`);
    console.log(`${a.resolution.candidate.slug.padEnd(18)} segments ${a.buckets.join(" + ")} | top metros ${a.metros.slice(0, 5).map((m) => shortMetroName(m.metro)).join(", ")}`);
    const { anchor } = await placeAnchorFor(a, lookup);
    requests.push(...segmentRequests(a.resolution.candidate.slug, a.seedIds, a.buckets, anchor, placeTags));
  }
  await writeRecipe("pool-segments", {
    description: "Gate 2 stage 3: two measured age segments per candidate (artist and brand affinities each) and everyday places in the candidate's top-lift metro, with explainability.",
    requests,
  });
}

// --- Panels ------------------------------------------------------------------------------------

function excludedIds(audiences: readonly Audience[]): Set<string> {
  const ids = new Set<string>();
  for (const a of audiences) {
    for (const id of a.seedIds) ids.add(id.toUpperCase());
    for (const ref of a.resolution.references) if (ref.entity) ids.add(ref.entity.id.toUpperCase());
    if (a.resolution.music.tag) ids.add(a.resolution.music.tag.id.toUpperCase());
    if (a.resolution.tone.tag) ids.add(a.resolution.tone.tag.id.toUpperCase());
  }
  return ids;
}

function entityPool(audiences: readonly Audience[], type: ScoredType): PanelCandidate[] {
  return audiences.flatMap((a) =>
    a.entities[type].map((e) => ({ id: e.id, name: e.name, popularity: e.popularity ?? 0, source: a.resolution.candidate.slug, request: audienceId(a.resolution.candidate.slug, type) })),
  );
}

function tagPool(audiences: readonly Audience[], kind: TagKind): PanelCandidate[] {
  return audiences.flatMap((a) =>
    a.tags[kind]
      .filter((t) => t.type === TAG_KINDS[kind])
      .map((t) => ({ id: t.id, name: t.name.trim(), popularity: t.popularity ?? 0, source: a.resolution.candidate.slug, request: audienceId(a.resolution.candidate.slug, `tags-${kind}`) })),
  );
}

/** JSON for a generated data file: U+2014 inside Qloo's names is written as an escape, so the em dash scan stays clean. */
const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

const REFERENCE_FILE = path.join("data", "geo", "reference-heatmap.json");

/**
 * The frozen reference sets for city ranking (lib/geo/metros.ts), on the shared grid of cells all 9
 * candidate heatmaps have: per cell, the sum and count of each audience's percentile. "candidates"
 * holds the 9 candidates; "full" adds every dense recorded reference audience. A live run ranks
 * against "full"; the candidates themselves use leave-one-out means. Derived data, frozen.
 */
async function writeReferenceHeatmap(sets: ReferenceSets): Promise<void> {
  const cells = (map: ReferenceHeatmap) =>
    Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([hash, { sum, n }]) => [hash, [Number(sum.toFixed(6)), n]]));
  const file = {
    source:
      "Per geohash cell of the grid all 9 recorded candidate heatmaps share (fixtures/pool-audience.json.gz), the sum and count of each audience's affinity percentile on that grid. 'full' adds the recorded reference audiences (fixtures/reference-audiences*.json.gz) that cover at least 95% of the grid. Generated by npm run data-check -- reference.",
    built: new Date().toISOString().slice(0, 10),
    sets: {
      candidates: { audiences: sets.candidates.audiences, members: sets.candidates.members, cells: cells(sets.candidates.cells) },
      full: { audiences: sets.full.audiences, members: sets.full.members, cells: cells(sets.full.cells) },
    },
  };
  await writeFile(REFERENCE_FILE, `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${REFERENCE_FILE}: ${sets.candidates.cells.size} grid cells, ${sets.candidates.audiences} candidate audiences, ${sets.full.audiences} in the full set.`);
}

async function writeReference(): Promise<void> {
  const { sets, dense, sparse } = await readAllAudiences();
  await writeReferenceHeatmap(sets);
  console.log(`Dense reference audiences (${dense.length}): ${dense.join(", ")}`);
  console.log(`Left out as too sparse for the grid (${sparse.length}): ${sparse.join(", ")}`);
}

async function writePanels(force: boolean): Promise<void> {
  if (existsSync(PANELS_FILE) && !force) fail(`${PANELS_FILE} is frozen. Pass --force only before any scoring call has used it.`);
  const { audiences, sets } = await readAllAudiences(true);
  const exclude = excludedIds(audiences);
  // Panel names appear in receipts, so they pass the same minor and ethnicity guardrails as generated text.
  const guarded = (pool: PanelCandidate[]) => {
    for (const c of pool) if (checkText(c.name).some((i) => i.rule === "minor" || i.rule === "ethnicity")) exclude.add(c.id.toUpperCase());
    return pool;
  };
  const pick = (pool: PanelCandidate[]) => buildPanel(guarded(pool), { exclude }).map(({ id, name, popularity, request }) => ({ id, name, popularity, request }));
  const entity = Object.fromEntries(ENTITY_TYPES_SCORED.map((type) => [type, pick(entityPool(audiences, type))]));
  const tag = Object.fromEntries((Object.keys(TAG_KINDS) as TagKind[]).map((kind) => [kind, pick(tagPool(audiences, kind))]));
  const file = {
    source:
      "Frozen reference panels: 25 real entities or tags per panel from the recorded audience lists of all 9 candidates (fixtures/pool-audience.json.gz), spread evenly across Qloo popularity, at most 3 from any one candidate, never a seed, a Control pick or a name the minor or ethnicity guardrails flag. `request` names the recording each came from. Generated by npm run data-check -- panels.",
    built: new Date().toISOString().slice(0, 10),
    entity,
    tag,
  };
  await mkdir(path.dirname(PANELS_FILE), { recursive: true });
  await writeFile(PANELS_FILE, jsonText(file));
  await writeReferenceHeatmap(sets);
  for (const [type, panel] of Object.entries({ ...entity, ...tag })) {
    const pops = (panel as { popularity: number }[]).map((p) => p.popularity);
    console.log(`${type.padEnd(8)} 25 entries, popularity ${Math.min(...pops).toFixed(3)} to ${Math.max(...pops).toFixed(3)}`);
  }
  console.log(`Wrote ${PANELS_FILE}.`);
}

// --- Stage 4: scoring ---------------------------------------------------------------------------

/** The panels file is generated by this script, so it may not exist yet. */
async function loadPanels(): Promise<ReferencePanels> {
  if (!existsSync(PANELS_FILE)) fail(`${PANELS_FILE} is missing. Run: npm run data-check -- panels`);
  return readPanelsFile();
}

/** Qloo's top picks scored next to the panel: the first 10 of each recorded list. */
export const TOP_PICKS = 10;

function scoringInputs(a: Audience, panels: ReferencePanels) {
  const entityIds = {} as Record<ScoredType, string[]>;
  for (const type of ENTITY_TYPES_SCORED) {
    const control = a.resolution.references.filter((r) => r.type === type && r.entity).map((r) => (r.entity as { id: string }).id);
    entityIds[type] = [...a.entities[type].slice(0, TOP_PICKS).map((e) => e.id), ...control, ...panels.entity[type].map((p) => p.id)];
  }
  const tagIds = {} as Record<TagKind, string[]>;
  for (const kind of Object.keys(TAG_KINDS) as TagKind[]) {
    const mapped = (kind === "music" ? a.resolution.music : a.resolution.tone).tag;
    const top = a.tags[kind].filter((t) => t.type === TAG_KINDS[kind]).slice(0, TOP_PICKS).map((t) => t.id);
    tagIds[kind] = [...top, ...(mapped ? [mapped.id] : []), ...panels.tag[kind].map((p) => p.id)];
  }
  return { entityIds, tagIds };
}

async function planScoring(): Promise<void> {
  const panels = await loadPanels();
  const { audiences } = await readAllAudiences();
  const requests = audiences.flatMap((a) => {
    const { entityIds, tagIds } = scoringInputs(a, panels);
    return scoringRequests(a.resolution.candidate.slug, a.seedIds, entityIds, tagIds);
  });
  await writeRecipe("pool-scoring", {
    description: "Gate 2 stage 4: per candidate, one call per type that scores Qloo's top 10 picks, any Control picks and the frozen 25-entry panel together (filter.results.entities or filter.results.tags).",
    requests,
  });
}

// --- Analysis ----------------------------------------------------------------------------------

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

async function analyzeOne(a: Audience, placeTags: string[], panels: ReferencePanels, lookup: Lookup) {
  const slug = a.resolution.candidate.slug;
  const { entityIds, tagIds } = scoringInputs(a, panels);
  const scoring = new Map(scoringRequests(slug, a.seedIds, entityIds, tagIds).map((r) => [r.id, r]));
  const { locality, anchor } = await placeAnchorFor(a, lookup);
  const segments = new Map(segmentRequests(slug, a.seedIds, a.buckets, anchor, placeTags).map((r) => [r.id, r]));
  const get = <T>(map: Map<string, import("../lib/data-check/plan").PlannedRequest>, id: string, schema: import("zod").ZodType<T>) => {
    const request = map.get(id);
    if (!request) throw new Error(`no request ${id}`);
    return lookup(request, schema);
  };

  // Fields: Qloo's top picks against the panel, all scored in one call per type.
  // A panel entry that is also one of this audience's own top picks is left out of its comparison,
  // so "beats N of M" never counts a pick against itself (M can then be under 25).
  const fieldLevel = async (id: string, topIds: string[], allPanelIds: string[], schema: "entities" | "tags") => {
    const rows = schema === "entities" ? await get(scoring, id, insightsEntitiesResponse) : await get(scoring, id, insightsTagsResponse);
    const score = new Map(rows.flatMap((r) => (r.affinity === null ? [] : [[r.id, r.affinity] as const])));
    const own = new Set(topIds);
    const panelIds = allPanelIds.filter((pid) => !own.has(pid));
    const panelScores = panelIds.flatMap((pid) => (score.has(pid) ? [score.get(pid) as number] : []));
    const pickScores = topIds.flatMap((pid) => (score.has(pid) ? [score.get(pid) as number] : []));
    const beats = pickScores.map((p) => panelScores.filter((q) => p > q).length);
    return { ...signalLevel(pickScores, panelScores), beats, panelReturned: panelScores.length, picksReturned: pickScores.length, score, panelScores };
  };
  const entityField: Record<string, Awaited<ReturnType<typeof fieldLevel>>> = {};
  for (const type of ENTITY_TYPES_SCORED) {
    entityField[type] = await fieldLevel(scoringId(slug, type), a.entities[type].slice(0, TOP_PICKS).map((e) => e.id), panels.entity[type].map((p) => p.id), "entities");
  }
  const tagField: Record<string, Awaited<ReturnType<typeof fieldLevel>>> = {};
  for (const kind of Object.keys(TAG_KINDS) as TagKind[]) {
    const top = a.tags[kind].filter((t) => t.type === TAG_KINDS[kind]).slice(0, TOP_PICKS).map((t) => t.id);
    tagField[kind] = await fieldLevel(scoringId(slug, `tags-${kind}`), top, panels.tag[kind].map((p) => p.id), "tags");
  }

  // Settings: everyday places in the top-lift metro.
  const places = await get(segments, placesId(slug), insightsEntitiesResponse);
  const explained = places.filter((p) => Object.values(p.explainability ?? {}).some((items) => items.length > 0));
  const nameCounts = new Map<string, number>();
  for (const p of places) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  // Distinct names: a chain listed four times counts once. It is not a chain check (one Starbucks still counts).
  const distinctNames = nameCounts.size;
  const settingLevel: SignalLevel = explained.length >= 3 && distinctNames >= 3 ? "rich" : explained.length >= 1 ? "thin" : "none";
  // Places go to the top metro's principal city as a verified Qloo locality (name and state checked).
  const asked = shortMetroName(a.metros[0].metro);

  const levels = {
    music: entityField.artist.level,
    visual: [entityField.movie.level, entityField.tv_show.level].includes("rich") ? "rich" : [entityField.movie.level, entityField.tv_show.level].includes("thin") ? "thin" : "none",
    wardrobe: entityField.brand.level,
    setting: settingLevel,
    voice: tagField.tone.level,
  } as Record<string, SignalLevel>;

  // Segments: how different the measured worlds are (only buckets that over-index are segments).
  const seg = async (bucket: AgeBucket, type: "artist" | "brand") => get(segments, segmentId(slug, bucket, type), insightsEntitiesResponse);
  const worlds = await Promise.all(a.buckets.map(async (bucket) => ({ bucket, artists: await seg(bucket, "artist"), brands: await seg(bucket, "brand") })));
  const overlap =
    worlds.length === 2
      ? (topOverlap(worlds[0].artists.map((e) => e.id), worlds[1].artists.map((e) => e.id)) +
          topOverlap(worlds[0].brands.map((e) => e.id), worlds[1].brands.map((e) => e.id))) /
        2
      : null;
  const segmentSummaries = worlds.map((w) => ({
    bucket: w.bucket,
    label: ageBandLabel(w.bucket),
    skew: round(a.skew.age[w.bucket], 2),
    artists: w.artists.slice(0, 5).map((e) => e.name),
    brands: w.brands.slice(0, 5).map((e) => e.name),
  }));
  const descriptorFlags = segmentSummaries.flatMap((sg) =>
    checkText(`${sg.label}: ${sg.artists.join(", ")}; ${sg.brands.join(", ")}`).filter((i) => i.rule === "minor" || i.rule === "ethnicity").map((i) => `${sg.label}: ${i.match}`),
  );

  // Reality Gap lines.
  const { candidate, control } = { candidate: a.resolution.candidate, control: a.resolution.control };
  const topBucket = rankedBuckets(a.skew.age)[0];
  const stated = bucketsForBand(candidate.statedCustomer);
  const ranked = a.metros.map((m) => m.metro);
  const controlCities = control.assumedCities.map((city) => ({ city, metro: guessedMetro(city, METROS)?.name ?? null, rank: cityRank(city, ranked, METROS) }));
  const musicTag = a.resolution.music.tag;
  const musicPosition = musicTag ? choicePosition(tagField.music.score.get(musicTag.id), tagField.music.panelScores) : null;
  const toneTag = a.resolution.tone.tag;
  const tonePosition = toneTag ? choicePosition(tagField.tone.score.get(toneTag.id), tagField.tone.panelScores) : null;
  const qlooTopMusic = a.tags.music.filter((t) => t.type === TAG_KINDS.music)[0];
  const qlooTopMusicPosition = qlooTopMusic ? choicePosition(tagField.music.score.get(qlooTopMusic.id), tagField.music.panelScores) : null;
  const gap = {
    age: ageGap(a.skew.age, stated),
    cities: controlCities.every((c) => c.rank === null || c.rank > 10),
    music: musicPosition === null ? null : musicPosition.belowMedian || (qlooTopMusicPosition !== null && qlooTopMusicPosition.beats - musicPosition.beats >= 5),
  };

  const references = a.resolution.references.map((ref) => {
    const field = ref.entity && (ENTITY_TYPES_SCORED as readonly string[]).includes(ref.type) ? entityField[ref.type] : undefined;
    return { name: ref.query, type: ref.type, resolved: !!ref.entity, position: ref.entity && field ? choicePosition(field.score.get(ref.entity.id), field.panelScores) : null };
  });

  return {
    slug,
    lane: candidate.lane,
    workingName: candidate.workingName,
    seeds: {
      resolved: a.resolution.seeds.filter((x) => x.entity).map((x) => ({ query: x.query, name: x.entity?.name, type: x.type, match: x.entity?.match })),
      dropped: a.resolution.seeds.filter((x) => !x.entity).map((x) => x.query),
    },
    age: {
      stated: candidate.statedCustomer,
      statedBuckets: stated,
      controlGuess: control.ageBands,
      measuredTop: topBucket,
      measuredTopLabel: ageBandLabel(topBucket),
      skew: Object.fromEntries(Object.entries(a.skew.age).map(([k, v]) => [k, round(v, 2)])),
      gender: { male: round(a.skew.gender.male, 2), female: round(a.skew.gender.female, 2) },
      controlGender: control.genderSkew,
    },
    cities: {
      qloo: a.metros.slice(0, 5).map((m) => ({
        name: shortMetroName(m.metro),
        lift: round(m.lift),
        cells: m.cells,
        topCell: m.topCell.geohash,
        comparedWith: m.comparedWith,
        candidateSetRank: m.candidateSetRank,
      })),
      rankedMetros: a.metros.length,
      control: controlCities,
      /** Cities in the top 5 against the 9 candidates alone that fall outside the top 10 against the full set. */
      smallSetOnly: a.smallSetOnly.map((m) => ({ name: shortMetroName(m.metro), candidateSetRank: m.candidateSetRank, fullRank: m.fullRank })),
    },
    segments: segmentSummaries,
    distinctness: overlap === null ? null : round(1 - overlap, 2),
    descriptorFlags,
    fields: Object.fromEntries(
      Object.entries(levels).map(([field, level]) => [field, level]),
    ),
    strongPicks: {
      artist: entityField.artist.strong,
      movie: entityField.movie.strong,
      tv_show: entityField.tv_show.strong,
      brand: entityField.brand.strong,
      music: tagField.music.strong,
      tone: tagField.tone.strong,
    },
    panelReturned: Object.fromEntries([...Object.entries(entityField), ...Object.entries(tagField)].map(([k, v]) => [k, v.panelReturned])),
    topPickBeats: Object.fromEntries([...Object.entries(entityField), ...Object.entries(tagField)].map(([k, v]) => [k, v.beats])),
    places: { metro: asked, locality: locality ? `${locality.name} (${locality.disambiguation})` : `no verified locality; ${anchor["filter.location"]}`, returned: places.length, explained: explained.length, distinctNames, top: places.slice(0, 5).map((p) => p.name) },
    control: {
      music: { style: control.music, term: control.musicTerm, tag: musicTag?.name ?? null, similarity: a.resolution.music.similarity ?? null, position: musicPosition },
      qlooTopMusic: qlooTopMusic ? { tag: qlooTopMusic.name.trim(), position: qlooTopMusicPosition } : null,
      mood: { term: control.moodTerm, tagId: toneTag?.id ?? null, position: tonePosition },
      references,
    },
    gap,
    gapLines: [gap.age, gap.cities, gap.music].filter((x) => x === true).length,
    richFields: Object.values(levels).filter((l) => l === "rich").length,
  };
}

async function analyze(): Promise<void> {
  const panels = await loadPanels();
  const { audiences, placeGenres } = await readAllAudiences();
  const lookup = replayLookup();
  const placeTags = placeGenres.flatMap((g) => (g.tag ? [g.tag.id] : []));
  const summaries = [];
  for (const a of audiences) summaries.push(await analyzeOne(a, placeTags, panels, lookup));
  const out = path.join("data", "data-check", "summary.json");
  await mkdir(path.dirname(out), { recursive: true });
  // Qloo names may hold U+2014; written as an escape so the em dash scan stays clean.
  await writeFile(out, `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), candidates: summaries }, null, 2).replace(/\u2014/g, "\\u2014")}\n`);
  for (const c of summaries) {
    console.log(`\n## ${c.slug} (${c.lane})`);
    console.log(`seeds ${c.seeds.resolved.length}/${c.seeds.resolved.length + c.seeds.dropped.length}${c.seeds.dropped.length ? ` dropped ${c.seeds.dropped.join(", ")}` : ""}`);
    console.log(`age: stated "${c.age.statedBuckets.join(",")}" | Control ${c.age.controlGuess.join(",")} | Qloo top ${c.age.measuredTopLabel} | skew ${JSON.stringify(c.age.skew)} | gender ${JSON.stringify(c.age.gender)} vs Control ${c.age.controlGender}`);
    console.log(`cities (vs ${c.cities.qloo[0]?.comparedWith} audiences): Qloo ${c.cities.qloo.map((m) => `${m.name} (+${m.lift}, ${m.cells}, small-set #${m.candidateSetRank ?? "-"})`).join("; ")} | Control ${c.cities.control.map((x) => `${x.city} #${x.rank ?? "-"}`).join(", ")} of ${c.cities.rankedMetros}`);
    if (c.cities.smallSetOnly.length) console.log(`  held only against the 9 candidates: ${c.cities.smallSetOnly.map((m) => `${m.name} (small #${m.candidateSetRank}, full #${m.fullRank ?? "-"})`).join("; ")}`);
    for (const sg of c.segments) console.log(`segment ${sg.label} (${sg.skew}): ${sg.artists.join(", ")} | ${sg.brands.join(", ")}`);
    console.log(`distinctness ${c.distinctness} | flags ${c.descriptorFlags.join("; ") || "none"}`);
    console.log(`fields ${JSON.stringify(c.fields)} | strong ${JSON.stringify(c.strongPicks)} | panel returned ${JSON.stringify(c.panelReturned)}`);
    console.log(`places in ${c.places.metro} (${c.places.locality}): ${c.places.returned} returned, ${c.places.explained} explained, ${c.places.distinctNames} distinct names: ${c.places.top.join("; ")}`);
    const pos = (p: { beats: number; of: number } | null) => (p ? `beats ${p.beats} of ${p.of}` : "not returned");
    console.log(`Control music "${c.control.music.term}" -> ${c.control.music.tag ?? "unverifiable"} ${c.control.music.tag ? pos(c.control.music.position) : ""} | Qloo top music ${c.control.qlooTopMusic?.tag} ${pos(c.control.qlooTopMusic?.position ?? null)} | Control mood ${c.control.mood.term} ${pos(c.control.mood.position)}`);
    if (c.control.references.length) console.log(`Control refs: ${c.control.references.map((r) => `${r.name} ${pos(r.position)}`).join("; ")}`);
    console.log(`gap ${JSON.stringify(c.gap)} -> ${c.gapLines} lines | rich fields ${c.richFields}/5`);
  }
  console.log(`\nWrote ${out}.`);
}

/**
 * Rebuilds the stage 3 and 4 requests from the current code and writes only the ones no fixture
 * holds yet, so a method change never re-spends recorded calls.
 */
async function planMissing(): Promise<void> {
  const cache = FixtureCache.fromDir("fixtures");
  const missingFrom = async (requests: readonly PlannedRequest[]) => {
    const missing: PlannedRequest[] = [];
    for (const request of requests) if (!(await cache.get(cacheKey(request.endpoint, request.params)))) missing.push(request);
    return missing;
  };
  // Stage 1 first: later stages read its results, so they can only be planned once it is recorded.
  const stage1 = await missingFrom(resolveRecipe(CANDIDATES, controls()).requests);
  if (stage1.length > 0) {
    await writeTopUp(stage1, "stage 1 (resolve) requests the current code needs; record them, then run plan missing again");
    return;
  }
  const panels = await loadPanels();
  const { audiences, placeGenres } = await readAllAudiences();
  // Localities next: place queries need the verified locality id.
  const localities = await missingFrom(audiences.map((a) => {
    const { city, state } = localityName(a.metros[0].metro);
    return localityRequest(city, state);
  }));
  if (localities.length > 0) {
    await writeTopUp(localities, "locality searches for each candidate's top metro; record them, then run plan missing again");
    return;
  }
  const lookup = replayLookup();
  const placeTags = placeGenres.flatMap((g) => (g.tag ? [g.tag.id] : []));
  const wanted: PlannedRequest[] = [];
  for (const a of audiences) {
    const { entityIds, tagIds } = scoringInputs(a, panels);
    const { anchor } = await placeAnchorFor(a, lookup);
    wanted.push(
      ...segmentRequests(a.resolution.candidate.slug, a.seedIds, a.buckets, anchor, placeTags),
      ...scoringRequests(a.resolution.candidate.slug, a.seedIds, entityIds, tagIds),
    );
  }
  const missing = await missingFrom(wanted);
  if (missing.length === 0) {
    console.log("Every request the code needs is recorded.");
    return;
  }
  await writeTopUp(missing, "stage 3 and 4 requests the current code needs that no fixture holds yet");
}

/** Writes a top-up recipe under the next free name, never an existing fixture or recipe. */
async function writeTopUp(all: PlannedRequest[], why: string): Promise<void> {
  const requests = [...new Map(all.map((r) => [r.id, r])).values()];
  let name = "pool-refresh";
  for (let n = 2; findFixture(name) || existsSync(path.join("fixtures", "recipes", `${name}.json`)); n++) name = `pool-refresh-${n}`;
  await writeRecipe(name, { description: `Top-up: ${why}.`, requests });
}

// --- Reference audiences for city ranking ------------------------------------------------------

/** How many single-entity reference audiences come from each panel (21; only the dense ones join the full set). */
export const REFERENCE_PICKS: Readonly<Record<ScoredType, number>> = { artist: 6, brand: 5, movie: 5, tv_show: 5 };
export const REFERENCE_TAG_PICKS = 14;

/** Evenly spaced picks across a panel (panels are sorted by popularity, lowest first). */
function spread<T>(items: readonly T[], count: number): T[] {
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / Math.max(count - 1, 1))]);
}

export const referenceAudienceId = (type: string, id: string) => `reference--${type}--${id.toLowerCase()}`;

async function planReference(): Promise<void> {
  const requests = referenceRequests(await loadPanels());
  const tags = process.argv.includes("--tags");
  await writeRecipe(tags ? "reference-audiences-2" : "reference-audiences", {
    description: tags
      ? "Gate 3: 14 more reference audiences for city ranking, from broad music-genre tags in the frozen music tag panel (evenly spread), because most single-entity heatmaps were too sparse for the shared grid."
      : "Gate 3: 21 single-entity reference audiences for city ranking, picked evenly across popularity from the frozen artist, brand, movie and TV panels (never a candidate's seed). Each is a US heatmap.",
    requests: requests.filter((r) => r.id.startsWith("reference--music-tag--") === tags),
  });
}

async function main(): Promise<void> {
  const [command, stage] = process.argv.slice(2);
  if (command === "plan" && stage === "resolve") return writeRecipe("pool-resolve", resolveRecipe(CANDIDATES, controls()));
  if (command === "plan" && stage === "audience") return planAudience();
  if (command === "plan" && stage === "segments") return planSegments();
  if (command === "panels") return writePanels(process.argv.includes("--force"));
  if (command === "plan" && stage === "scoring") return planScoring();
  if (command === "analyze") return analyze();
  if (command === "plan" && stage === "missing") return planMissing();
  if (command === "plan" && stage === "reference") return planReference();
  if (command === "reference") return writeReference();
  fail("Usage: npm run data-check -- plan resolve|audience|segments|scoring|missing|reference | panels [--force] | analyze");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
