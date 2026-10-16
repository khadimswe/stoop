// Gate 2 requests, defined once. Recipes (what `fixtures:record` spends calls on) and the replay
// analysis (which reads the recordings back through the real client in fixtures mode) are built
// from the same functions, so the params are identical by construction.
import { readFileSync } from "node:fs";
import path from "node:path";
import { baselineRunSchema, REFERENCE_TYPES, type BaselineRun, type ReferenceType } from "../agent/baseline";
import { CONTROL_RUN } from "../agent/baseline-brief";
import type { Candidate } from "../demo/candidates";
import { seedType } from "../demo/seed-types";
import { ENDPOINTS, type AgeBucket, type EntityType } from "../qloo/constants";
import { bestTag } from "../qloo/match";
import type { QlooParams } from "../qloo/params";
import { resolveEntity, searchRequest, type Lookup, type PlannedRequest, type ResolvedEntity } from "../qloo/resolve";
import { tagsResponse } from "../qloo/types";
import { moodTerm, musicTerm, slugOf } from "./score";

// Typed name resolution lives in lib/qloo/resolve.ts (the intake uses it too) and is re-exported here.
export { clientLookup, searchId } from "../qloo/resolve";
export type { Lookup, PlannedRequest };

export interface Recipe {
  description: string;
  requests: PlannedRequest[];
}

/** Every candidate's audience lives in the US, so national calls use this locality query. */
export const REGION_QUERY = "United States";
export const ENTITY_TYPES_SCORED = ["artist", "brand", "movie", "tv_show"] as const;
export type ScoredType = (typeof ENTITY_TYPES_SCORED)[number];
export const TAG_KINDS = { music: "urn:tag:genre:music", tone: "urn:tag:emotional_tone:qloo" } as const;
export type TagKind = keyof typeof TAG_KINDS;
/** Everyday settings for the place probe: a hotel list (what an unfiltered place query returns) is no setting. */
export const PLACE_GENRE_QUERIES = ["coffee shop", "park", "boutique", "record store"] as const;

// --- Control briefs ---------------------------------------------------------------------------

export interface ControlReference {
  type: ReferenceType;
  name: string;
  /** Which of the 3 runs named it (run 1 is the Control). */
  runs: number[];
}

export interface ControlText {
  slug: string;
  music: string;
  musicTerm: string;
  mood: string;
  moodTerm: string;
  ageBands: AgeBucket[];
  genderSkew: string;
  assumedCities: string[];
  /** Named references that are not the candidate's own seeds. Seeds are the signal, so Qloo never scores them against it. */
  references: ControlReference[];
}

export function loadRuns(slug: string, root = process.cwd()): BaselineRun[] {
  return [1, 2, 3].map((n) =>
    baselineRunSchema.parse(JSON.parse(readFileSync(path.join(root, "data/baselines", slug, `run-${n}.json`), "utf8"))),
  );
}

export function controlText(candidate: Candidate, runs: readonly BaselineRun[]): ControlText {
  const control = runs.find((r) => r.run === CONTROL_RUN);
  if (!control) throw new Error(`${candidate.slug} has no run ${CONTROL_RUN}.`);
  const seeds = new Set(candidate.seeds.map((s) => s.toLowerCase()));
  const references = new Map<string, ControlReference>();
  for (const run of runs) {
    for (const type of REFERENCE_TYPES) {
      for (const name of run.brief.references[type]) {
        if (seeds.has(name.toLowerCase())) continue;
        const key = `${type}:${name.toLowerCase()}`;
        const entry = references.get(key) ?? { type, name, runs: [] };
        entry.runs.push(run.run);
        references.set(key, entry);
      }
    }
  }
  const { brief } = control;
  return {
    slug: candidate.slug,
    music: brief.music.style,
    musicTerm: musicTerm(brief.music.style),
    mood: brief.mood,
    moodTerm: moodTerm(brief.mood),
    ageBands: brief.audience.ageBands,
    genderSkew: brief.audience.genderSkew,
    assumedCities: brief.assumedCities,
    references: [...references.values()],
  };
}

// --- Request ids and builders -----------------------------------------------------------------

export const tagQueryId = (kind: TagKind | "place", term: string) => `tags--${kind}--${slugOf(term)}`;

function search(name: string, type: EntityType, note: string): PlannedRequest {
  return searchRequest(name, type, note);
}

/** The query is the normalized term ("Lo-fi hip hop" and "lo-fi hip-hop" both send "lo fi hip hop"), so one id is one request. */
function tagQuery(kind: TagKind | "place", term: string, note: string): PlannedRequest {
  const tagType = kind === "place" ? "urn:tag:genre:place" : TAG_KINDS[kind];
  const query = slugOf(term).replace(/-/g, " ");
  return { id: tagQueryId(kind, term), endpoint: ENDPOINTS.tags, params: { "filter.query": query, "filter.tag.types": [tagType], take: 10 }, note };
}

function dedupe(requests: PlannedRequest[]): PlannedRequest[] {
  const seen = new Map<string, PlannedRequest>();
  for (const request of requests) if (!seen.has(request.id)) seen.set(request.id, request);
  return [...seen.values()];
}

/** Stage 1: resolve every seed and non-seed Control reference, map Control music and mood to tags, find place genres. */
export function resolveRecipe(candidates: readonly Candidate[], controls: readonly ControlText[]): Recipe {
  const requests: PlannedRequest[] = [];
  for (const candidate of candidates) {
    for (const seed of candidate.seeds) requests.push(search(seed, seedType(seed), `Seed for ${candidate.slug}.`));
  }
  for (const control of controls) {
    for (const ref of control.references) requests.push(search(ref.name, ref.type, `Control reference for ${control.slug} (runs ${ref.runs.join(", ")}).`));
    requests.push(tagQuery("music", control.musicTerm, `Control music for ${control.slug}: "${control.music.slice(0, 60)}".`));
    requests.push(tagQuery("tone", control.moodTerm, `Control mood for ${control.slug}: "${control.mood}".`));
  }
  for (const query of PLACE_GENRE_QUERIES) requests.push(tagQuery("place", query, "Everyday place genre for setting queries."));
  return {
    description: "Gate 2 stage 1: resolve the pool's seeds and the Controls' non-seed references by name, map each Control's music style and mood to a Qloo tag, and find everyday place genre tags.",
    requests: dedupe(requests),
  };
}

export const audienceId = (slug: string, what: string) => `${slug}--${what}`;

/** Stage 2: the whole audience for one candidate, from its resolved seeds. */
export function audienceRequests(slug: string, seedIds: readonly string[]): PlannedRequest[] {
  const signal = { "signal.interests.entities": [...seedIds] };
  const insight = (what: string, params: QlooParams, note: string): PlannedRequest => ({
    id: audienceId(slug, what),
    endpoint: ENDPOINTS.insights,
    params: { ...signal, ...params },
    note,
  });
  return [
    insight("demographics", { "filter.type": "urn:demographics" }, "Age and gender skew per seed."),
    insight("heatmap", { "filter.type": "urn:heatmap", "filter.location.query": REGION_QUERY }, "Where the taste neighborhood clusters."),
    ...ENTITY_TYPES_SCORED.map((type) => insight(type, { "filter.type": `urn:entity:${type}`, take: 50 }, `Top ${type} affinities.`)),
    ...(Object.keys(TAG_KINDS) as TagKind[]).map((kind) =>
      insight(`tags-${kind}`, { "filter.type": "urn:tag", "filter.tag.types": [TAG_KINDS[kind]], take: 30 }, `Top ${kind} tags.`),
    ),
  ];
}

export const segmentId = (slug: string, bucket: AgeBucket, type: string) => `${slug}--seg-${bucket}--${type}`;
export const placesId = (slug: string) => `${slug}--places`;

/** Stage 3: up to two measured age segments (artist and brand each) and everyday places in the top-lift metro. */
export function segmentRequests(
  slug: string,
  seedIds: readonly string[],
  buckets: readonly AgeBucket[],
  metroQuery: string,
  placeTagIds: readonly string[],
): PlannedRequest[] {
  const signal = { "signal.interests.entities": [...seedIds] };
  const requests: PlannedRequest[] = [];
  for (const bucket of buckets) {
    for (const type of ["artist", "brand"] as const) {
      requests.push({
        id: segmentId(slug, bucket, type),
        endpoint: ENDPOINTS.insights,
        params: { ...signal, "signal.demographics.age": [bucket], "filter.type": `urn:entity:${type}`, take: 50 },
        note: `Segment ${bucket}: ${type} affinities.`,
      });
    }
  }
  requests.push({
    id: placesId(slug),
    endpoint: ENDPOINTS.insights,
    params: {
      ...signal,
      "filter.type": "urn:entity:place",
      "filter.location.query": metroQuery,
      "filter.tags": [...placeTagIds],
      "operator.filter.tags": "union",
      "feature.explainability": true,
      take: 10,
    },
    note: `Everyday places in ${metroQuery}, the top-lift metro, with explainability.`,
  });
  return requests;
}

export const scoringId = (slug: string, what: string) => `${slug}--score-${what}`;

/** Stage 4: one call per type that scores Qloo's picks, the Control's picks and the frozen panel together. */
export function scoringRequests(
  slug: string,
  seedIds: readonly string[],
  entityIds: Readonly<Record<ScoredType, readonly string[]>>,
  tagIds: Readonly<Record<TagKind, readonly string[]>>,
): PlannedRequest[] {
  const signal = { "signal.interests.entities": [...seedIds] };
  const unique = (ids: readonly string[]) => [...new Set(ids)];
  return [
    ...ENTITY_TYPES_SCORED.map((type): PlannedRequest => {
      const ids = unique(entityIds[type]);
      return {
        id: scoringId(slug, type),
        endpoint: ENDPOINTS.insights,
        params: { ...signal, "filter.type": `urn:entity:${type}`, "filter.results.entities": ids, take: ids.length },
        note: `Scores Qloo's top ${type} picks, any Control picks and the ${type} panel in one call.`,
      };
    }),
    ...(Object.keys(TAG_KINDS) as TagKind[]).map((kind): PlannedRequest => {
      const ids = unique(tagIds[kind]);
      return {
        id: scoringId(slug, `tags-${kind}`),
        endpoint: ENDPOINTS.insights,
        params: { ...signal, "filter.type": "urn:tag", "filter.results.tags": ids, take: ids.length },
        note: `Scores Qloo's top ${kind} tags, the Control's ${kind} tag and the ${kind} tag panel in one call.`,
      };
    }),
  ];
}

// --- Reading recorded responses back -----------------------------------------------------------

export type Resolved = ResolvedEntity;

export async function resolveName(name: string, type: EntityType, lookup: Lookup): Promise<Resolved> {
  return resolveEntity(name, type, lookup);
}

export interface MappedTag {
  term: string;
  /** The /v2/tags request behind the mapping, or null when the tag id was built from the term. */
  request: string | null;
  tag?: { id: string; name: string };
  /** Word similarity between the term and the tag name (1 for a built id; Qloo confirms it by scoring it). */
  similarity?: number;
}

export async function mapTag(kind: TagKind | "place", term: string, lookup: Lookup): Promise<MappedTag> {
  const request = tagQuery(kind, term, "");
  const tags = await lookup(request, tagsResponse);
  const best = bestTag(term, tags.filter((t) => kind === "place" || t.type === TAG_KINDS[kind]));
  return { term, request: request.id, ...(best ? { tag: { id: best.tag.id, name: best.tag.name }, similarity: best.similarity } : {}) };
}

/**
 * Qloo's tag search does not index emotional-tone tags (fixtures/pool-resolve.json: "calm", "warm"
 * and "cozy" return nothing), though insights return them by id. So a mood maps to the id Qloo's
 * scheme gives it ("Calm" -> urn:tag:emotional_tone:qloo:calm). It counts only if the scoring call
 * returns it; otherwise the choice is unverifiable.
 */
export function toneTag(term: string): MappedTag {
  const id = `${TAG_KINDS.tone}:${slugOf(term).replace(/-/g, "_")}`;
  return { term, request: null, tag: { id, name: term }, similarity: 1 };
}
