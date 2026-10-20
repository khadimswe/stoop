// The check: how Qloo's picks for a world, and the LLM-only Control's choices, land against the
// frozen reference panels, measured with that world's own signal. One scoring call per type per world
// (artist, brand, film, TV, music tags, tone tags) sends Qloo's top picks, the Control's mapped picks
// and the panel together (filter.results.entities or filter.results.tags), because Qloo's affinity
// only compares within one call. A pick is shown as "beats N of M reference artists"; below the panel
// median is a cliche this data does not support; a pick Qloo returns no score for is "no measurable
// affinity", never "unsupported"; with fewer than 5 panel items there is no median at all.
//
// The Control is mapped to Qloo once per run (its music style to a tag through /v2/tags, its mood to
// Qloo's emotional-tone id, its named references through /search, all with the same params Gate 2
// recorded), then scored in every world's calls. Examples carry all 3 recorded Control runs, so each
// fit shows the range across them.
import type { BaselineRun } from "../agent/baseline";
import { REFERENCE_TYPES } from "../agent/baseline";
import { entityPanel, tagPanel } from "../culture/panels";
import { moodTerm, musicTerm } from "../data-check/score";
import { TAG_KINDS, tagQuery, toneTag } from "../data-check/plan";
import { METROS, rankCities, shortMetroName, type ReferenceSets } from "../geo/metros";
import { panelPosition } from "../qloo/lift";
import { bestTag } from "../qloo/match";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import { QlooBudgetError, QlooHttpError } from "../qloo/errors";
import { resolveEntityWithReceipt, type ReceiptLookup } from "../qloo/resolve";
import { insightsEntitiesResponse, insightsTagsResponse, slimEntitiesBody, tagsResponse, type HeatmapCell } from "../qloo/types";
import type { Proof, Seed, Segment } from "../report/schema";
import type { Cliche, ControlChoice, ControlFit, ControlMapping, PanelPosition, ScoredPick, WorldCheck } from "../report/world";
import { ageBandLabel } from "../types";
import type { CultureCandidate } from "./culture";
import { TOP_PICKS, worldSignal } from "./culture";
import { decide, qloo, type StageEnv } from "./env";
import { guessedMetro } from "./measure";

export const SCORED_ENTITY_TYPES = ["artist", "brand", "movie", "tv_show"] as const;
export type ScoredEntityType = (typeof SCORED_ENTITY_TYPES)[number];
export const SCORED_TAG_KINDS = ["music", "tone"] as const;
export type ScoredTagKind = (typeof SCORED_TAG_KINDS)[number];
/** A Control city counts as supported when it ranks in this world's top cities. */
export const CITY_SUPPORT_RANK = 10;

const TYPE_LABELS: Record<ScoredEntityType, string> = { artist: "artists", brand: "brands", movie: "films", tv_show: "TV shows" };
const TAG_LABELS: Record<ScoredTagKind, string> = { music: "music tags", tone: "mood tags" };

// --- The Control, mapped to Qloo once per run --------------------------------------------------

export interface ControlRunMap {
  run: number;
  ageBands: AgeBucket[];
  cities: string[];
  music: { text: string; ref: { id: string; name: string } | null; evidenceIds: string[] };
  mood: { text: string; ref: { id: string; name: string } | null; evidenceIds: string[] };
  references: { type: ScoredEntityType | "place" | "person"; text: string; ref: { id: string; name: string } | null; evidenceIds: string[] }[];
  settings: string[];
  wardrobe: string;
}

/** A lookup that goes through the stage helper: every call is a receipt and a trace step on the "resolve" row. */
export function stageLookup(env: StageEnv): ReceiptLookup {
  return async (request, schema, notFound) =>
    qloo(env, "score", request.label ?? request.note ?? `Looking up ${request.id}`, {
      endpoint: request.endpoint,
      params: request.params,
      schema,
      ...(notFound === undefined ? {} : { onNotFound: notFound }),
      ...(request.endpoint === ENDPOINTS.search ? { slim: slimEntitiesBody } : {}),
      budgetRow: "resolve",
    });
}

/**
 * Maps each Control run's choices to Qloo: music style to a music tag (the best /v2/tags hit at the
 * matcher's threshold), mood to its emotional-tone id (tag search does not index tone tags, so the id
 * is built from the word and counts only if a scoring call returns it), named references to entities
 * by exact or affix name match. A reference that resolves to one of the seeds is left out: the seeds
 * are the signal, so it can never be scored against them. Lookups stop at the run's "resolve" row
 * (run 1 first); a lookup Qloo refuses or fails leaves that choice unverifiable instead of failing the run.
 */
export async function mapControl(env: StageEnv, runs: readonly BaselineRun[], seeds: readonly Seed[]): Promise<ControlRunMap[]> {
  const lookup = stageLookup(env);
  const seedIds = new Set(seeds.map((s) => s.ref.id));
  const seedNames = new Set(seeds.map((s) => s.ref.name.toLowerCase()));
  const limit = env.ctx.rowCaps.resolve ?? Infinity;
  let lookups = 0;
  const skipped: string[] = [];
  const asSeed: string[] = [];
  /** One lookup within the row, or null when the row is spent or Qloo refused it. */
  const look = async <T>(what: string, run: () => Promise<T>): Promise<T | null> => {
    if (lookups >= limit) {
      skipped.push(what);
      return null;
    }
    lookups++;
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof QlooBudgetError || error instanceof QlooHttpError)) throw error;
      skipped.push(what);
      return null;
    }
  };
  const musicCache = new Map<string, ControlRunMap["music"]>();
  const refCache = new Map<string, ControlRunMap["references"][number] | null>();
  const maps: ControlRunMap[] = [];
  for (const run of runs) {
    const { brief } = run;
    const term = musicTerm(brief.music.style);
    let music = musicCache.get(term.toLowerCase());
    if (!music) {
      const request = tagQuery("music", term, `Control music: "${brief.music.style.slice(0, 60)}".`);
      const found = await look(`the music "${term}"`, () => lookup({ ...request, label: `Matching the generic brief's music, "${term}", to a Qloo tag` }, tagsResponse));
      const best = found ? bestTag(term, found.data.filter((t) => t.type === TAG_KINDS.music)) : undefined;
      music = { text: brief.music.style, ref: best ? { id: best.tag.id, name: best.tag.name } : null, evidenceIds: found ? [found.evidence.id] : [] };
      musicCache.set(term.toLowerCase(), music);
    }
    const tone = toneTag(moodTerm(brief.mood));
    const mood = { text: brief.mood, ref: tone.tag ? { id: tone.tag.id, name: tone.tag.name } : null, evidenceIds: [] };
    const references: ControlRunMap["references"] = [];
    for (const type of REFERENCE_TYPES) {
      for (const name of brief.references[type]) {
        if (seedNames.has(name.toLowerCase())) continue;
        const key = `${type}:${name.toLowerCase()}`;
        if (!refCache.has(key)) {
          const resolved = await look(name, () => resolveEntityWithReceipt(name, type, lookup));
          if (resolved?.entity && seedIds.has(resolved.entity.id)) {
            asSeed.push(`${name} (${resolved.entity.name})`);
            refCache.set(key, null);
          } else {
            refCache.set(key, { type, text: name, ref: resolved?.entity ? { id: resolved.entity.id, name: resolved.entity.name } : null, evidenceIds: resolved ? [resolved.evidence.id] : [] });
          }
        }
        const ref = refCache.get(key);
        if (ref) references.push(ref);
      }
    }
    maps.push({
      run: run.run,
      ageBands: brief.audience.ageBands,
      cities: brief.assumedCities,
      music,
      mood,
      references,
      settings: brief.setting.types,
      wardrobe: brief.wardrobe.styling,
    });
  }
  if (asSeed.length) decide(env, "score", `Left ${asSeed.length === 1 ? "a generic brief pick" : `${asSeed.length} generic brief picks`} out of the check`, `${[...new Set(asSeed)].join(", ")} ${asSeed.length === 1 ? "is" : "are"} one of the seeds Qloo measured from, so ${asSeed.length === 1 ? "it" : "they"} can't be scored against them.`);
  if (skipped.length) decide(env, "score", `Left ${skipped.length} generic brief ${skipped.length === 1 ? "choice" : "choices"} unchecked`, `No lookup for ${[...new Set(skipped)].join(", ")}: the run's lookup budget was spent or Qloo refused, so ${skipped.length === 1 ? "it shows" : "they show"} as unverifiable.`);
  return maps;
}

/** The report's view of run 1's mappings. */
export function controlMappings(map: ControlRunMap): ControlMapping[] {
  const tag = (ref: { id: string; name: string } | null, type: string) => (ref ? { kind: "tag" as const, id: ref.id, name: ref.name, type } : null);
  return [
    { dimension: "music", text: map.music.text, ref: tag(map.music.ref, TAG_KINDS.music), match: null, evidenceIds: map.music.evidenceIds },
    { dimension: "mood", text: map.mood.text, ref: tag(map.mood.ref, TAG_KINDS.tone), match: null, evidenceIds: map.mood.evidenceIds },
    ...map.references.map((r) => ({
      dimension: "reference" as const,
      text: r.text,
      ref: r.ref ? { kind: "entity" as const, id: r.ref.id, name: r.ref.name, type: `urn:entity:${r.type}` } : null,
      match: null,
      evidenceIds: r.evidenceIds,
    })),
  ];
}

// --- Scoring one world -------------------------------------------------------------------------

/** The scoring request for one entity type, exported so recordings can be planned from the same params. */
export function entityScoringParams(seeds: readonly Seed[], bucket: AgeBucket, type: ScoredEntityType, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  return { ...worldSignal(seeds, bucket), "filter.type": `urn:entity:${type}`, "filter.results.entities": unique, take: unique.length };
}

export function tagScoringParams(seeds: readonly Seed[], bucket: AgeBucket, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  return { ...worldSignal(seeds, bucket), "filter.type": "urn:tag", "filter.results.tags": unique, take: unique.length };
}

/** One scoring call's result: a score per returned id, and the panel scores to place picks against. */
interface Scored {
  scores: Map<string, number>;
  panel: number[];
  evidenceId: string;
}

function place(scored: Scored, id: string): PanelPosition | null {
  const score = scored.scores.get(id);
  return score === undefined ? null : panelPosition(score, scored.panel);
}

const typeOfCandidate = (c: CultureCandidate): ScoredEntityType | ScoredTagKind | null => {
  if (c.kind === "tag") return c.field === "music" ? "music" : c.field === "mood" ? "tone" : null;
  const type = c.type.replace("urn:entity:", "");
  return (SCORED_ENTITY_TYPES as readonly string[]).includes(type) ? (type as ScoredEntityType) : null;
};

export interface WorldCheckResult {
  check: WorldCheck;
  fit: ControlFit;
  /** The world's candidates with their panel positions filled in. */
  candidates: CultureCandidate[];
}

/**
 * Scores a world: six calls, then places every Qloo candidate and every Control choice. The panel a
 * pick is placed against leaves out the world's own top picks (a pick is never scored against itself).
 */
export async function checkWorld(
  env: StageEnv,
  input: {
    seeds: readonly Seed[];
    segment: Segment;
    candidates: readonly CultureCandidate[];
    control: readonly ControlRunMap[];
    proof: Proof;
    segmentCells: readonly HeatmapCell[];
    /** The receipt behind the segment's heatmap, which city choices are ranked on. */
    heatmapEvidence: string;
    parentCells: readonly HeatmapCell[];
    reference: ReferenceSets;
  },
): Promise<WorldCheckResult> {
  const { seeds, segment } = input;
  const band = ageBandLabel(segment.bucket);
  const seedIds = new Set(seeds.map((s) => s.ref.id));
  const scored = new Map<ScoredEntityType | ScoredTagKind, Scored>();

  for (const type of SCORED_ENTITY_TYPES) {
    const own = input.candidates.filter((c) => typeOfCandidate(c) === type).slice(0, TOP_PICKS).map((c) => c.id);
    const control = input.control.flatMap((m) => m.references.filter((r) => r.type === type && r.ref).map((r) => (r.ref as { id: string }).id));
    const panel = entityPanel(type).map((p) => p.id);
    const ids = [...own, ...control, ...panel].filter((id) => !seedIds.has(id));
    const result = await qloo(env, "score", `Scoring ${band}'s ${TYPE_LABELS[type]} against Qloo's reference ${TYPE_LABELS[type]}`, {
      endpoint: ENDPOINTS.insights,
      params: entityScoringParams(seeds, segment.bucket, type, ids),
      schema: insightsEntitiesResponse,
      slim: slimEntitiesBody,
    });
    const scores = new Map(result.data.flatMap((e) => (e.affinity === null ? [] : [[e.id, e.affinity] as const])));
    const ownSet = new Set(own);
    scored.set(type, { scores, panel: panel.filter((id) => !ownSet.has(id) && scores.has(id)).map((id) => scores.get(id) as number), evidenceId: result.evidence.id });
  }
  for (const kind of SCORED_TAG_KINDS) {
    const own = input.proof.tags.filter((t) => t.kind === kind).map((t) => t.id);
    const control = input.control.flatMap((m) => {
      const ref = kind === "music" ? m.music.ref : m.mood.ref;
      return ref ? [ref.id] : [];
    });
    const panel = tagPanel(kind).map((p) => p.id);
    const result = await qloo(env, "score", `Scoring ${band}'s ${TAG_LABELS[kind]} against Qloo's reference ${TAG_LABELS[kind]}`, {
      endpoint: ENDPOINTS.insights,
      params: tagScoringParams(seeds, segment.bucket, [...own, ...control, ...panel]),
      schema: insightsTagsResponse,
    });
    const scores = new Map(result.data.flatMap((t) => (t.affinity === null ? [] : [[t.id, t.affinity] as const])));
    const ownSet = new Set(own);
    scored.set(kind, { scores, panel: panel.filter((id) => !ownSet.has(id) && scores.has(id)).map((id) => scores.get(id) as number), evidenceId: result.evidence.id });
  }

  // Qloo's own picks, placed.
  const candidates = input.candidates.map((c) => {
    const type = typeOfCandidate(c);
    if (!type) return c;
    const s = scored.get(type) as Scored;
    return { ...c, position: place(s, c.id), evidenceIds: [...new Set([...c.evidenceIds, s.evidenceId])] };
  });
  const picks: ScoredPick[] = candidates
    .filter((c) => typeOfCandidate(c) !== null && c.rank <= TOP_PICKS)
    .map((c) => ({ from: "qloo", kind: c.kind, id: c.id, name: c.name, type: c.type, position: c.position, evidenceIds: c.evidenceIds }));

  // The Control's choices, run by run (run 1 is the Control; runs 2 and 3 give the range).
  const { cities: ranked } = rankCities(input.segmentCells, input.reference, env.inReference ? { exclude: input.parentCells } : {});
  const cityRank = new Map(ranked.map((c) => [c.metro.name, c.rank]));
  const segmentHeatmapEvidence = [input.heatmapEvidence];
  const choicesFor = (map: ControlRunMap): ControlChoice[] => {
    const choices: ControlChoice[] = [];
    // Age: does the generic brief's audience include this world's age band?
    const ages = map.ageBands.map(ageBandLabel).join(", ");
    const covers = map.ageBands.includes(segment.bucket);
    choices.push({
      dimension: "age",
      text: ages,
      status: covers ? "supported" : "below",
      position: null,
      rank: null,
      measured: `this world is ${band} (skews ${signed(input.proof.demographics.age[segment.bucket])})`,
      evidenceIds: input.proof.demographics.evidenceIds,
    });
    for (const city of map.cities) {
      const metro = guessedMetro(city, METROS);
      if (!metro) {
        // Not a Census metro Stoop can place: nothing to check it against.
        choices.push({ dimension: "cities", text: city, status: "unverifiable", position: null, rank: null, measured: null, evidenceIds: [] });
        continue;
      }
      const rank = cityRank.get(metro.name);
      choices.push({
        dimension: "cities",
        text: city,
        status: rank === undefined ? "missing" : rank <= CITY_SUPPORT_RANK ? "supported" : "below",
        position: null,
        rank: rank === undefined ? null : { rank, of: ranked.length },
        measured: rank === undefined ? null : `${metro ? shortMetroName(metro) : city} ranks #${rank} of ${ranked.length} cities for this world`,
        evidenceIds: segmentHeatmapEvidence,
      });
    }
    const tagChoice = (dimension: "music" | "mood", kind: ScoredTagKind, entry: ControlRunMap["music"]): ControlChoice => {
      if (!entry.ref) return { dimension, text: entry.text, status: "unverifiable", position: null, rank: null, measured: null, evidenceIds: entry.evidenceIds };
      const s = scored.get(kind) as Scored;
      const position = place(s, entry.ref.id);
      // A mood id is built from the generic brief's word; unless Qloo returns it, there may be no such tag.
      if (dimension === "mood" && !position) return { dimension, text: entry.text, status: "unverifiable", position: null, rank: null, measured: `Qloo returned no mood tag "${entry.ref.name}"`, evidenceIds: [s.evidenceId] };
      return statusFrom(dimension, entry.text, position, [...entry.evidenceIds, s.evidenceId], `${entry.ref.name} in ${TAG_LABELS[kind]}`);
    };
    choices.push(tagChoice("music", "music", map.music), tagChoice("mood", "tone", map.mood));
    for (const ref of map.references) {
      const type = ref.type as ScoredEntityType;
      if (!ref.ref || !(SCORED_ENTITY_TYPES as readonly string[]).includes(type)) {
        choices.push({ dimension: "reference", text: ref.text, status: "unverifiable", position: null, rank: null, measured: null, evidenceIds: ref.evidenceIds });
        continue;
      }
      const s = scored.get(type) as Scored;
      choices.push(statusFrom("reference", ref.text, place(s, ref.ref.id), [...ref.evidenceIds, s.evidenceId], `${ref.ref.name} among ${TYPE_LABELS[type]}`));
    }
    for (const setting of map.settings) choices.push({ dimension: "setting", text: setting, status: "unverifiable", position: null, rank: null, measured: null, evidenceIds: [] });
    choices.push({ dimension: "wardrobe", text: map.wardrobe, status: "unverifiable", position: null, rank: null, measured: null, evidenceIds: [] });
    return choices;
  };

  const [first, ...rest] = input.control;
  const choices = choicesFor(first);
  const count = (list: readonly ControlChoice[], status: ControlChoice["status"]) => list.filter((c) => c.status === status).length;
  const below = count(choices, "below");
  const missing = count(choices, "missing");
  const unverifiable = count(choices, "unverifiable");
  const checkable = choices.length - unverifiable;
  const others = rest.map((map) => count(choicesFor(map), "below"));
  const range = others.length > 0 ? { runs: input.control.length, belowMin: Math.min(below, ...others), belowMax: Math.max(below, ...others) } : null;
  const fit: ControlFit = { segmentId: segment.id, choices, checkable, below, missing, unverifiable, line: fitLine(below, checkable, missing, unverifiable), range };

  // Control picks the scoring calls placed, for the check's pick list.
  for (const choice of choices) {
    if ((choice.dimension === "music" || choice.dimension === "mood" || choice.dimension === "reference") && choice.status !== "unverifiable") {
      const map = first;
      const entry = choice.dimension === "music" ? map.music : choice.dimension === "mood" ? map.mood : map.references.find((r) => r.text === choice.text);
      if (!entry?.ref) continue;
      const isTag = choice.dimension !== "reference";
      const type = isTag ? (choice.dimension === "music" ? TAG_KINDS.music : TAG_KINDS.tone) : `urn:entity:${(entry as ControlRunMap["references"][number]).type}`;
      picks.push({ from: "control", kind: isTag ? "tag" : "entity", id: entry.ref.id, name: entry.ref.name, type, position: choice.position, evidenceIds: choice.evidenceIds });
    }
  }

  const cliches: Cliche[] = choices
    .filter((c) => c.status === "below" && c.evidenceIds.length > 0)
    .map((c) => ({ dimension: c.dimension, assumed: `A generic AI brief assumed ${c.text}.`, measured: clicheMeasured(c), evidenceIds: c.evidenceIds }));
  return { check: { picks, cliches }, fit, candidates };
}

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

/** A choice's status from its panel position: above the median supports, below is a cliche, no median is unverifiable, no score is missing. Shared with MCP's score_brief. */
export function statusFrom(dimension: ControlChoice["dimension"], text: string, position: PanelPosition | null, evidenceIds: string[], what: string): ControlChoice {
  const ids = [...new Set(evidenceIds)];
  if (!position) return { dimension, text, status: "missing", position: null, rank: null, measured: `no measurable affinity for ${what}`, evidenceIds: ids };
  const status = position.aboveMedian === null ? "unverifiable" : position.aboveMedian ? "supported" : "below";
  return { dimension, text, status, position, rank: null, measured: `${what}: beats ${position.beats} of ${position.of}`, evidenceIds: ids };
}

function clicheMeasured(choice: ControlChoice): string {
  if (choice.measured) return `Qloo measured: ${choice.measured}.`;
  return "Qloo's data for this world does not support it.";
}

/**
 * "4 of 7 checkable LLM-only choices miss what Qloo measured for this world (1 with no measurable
 * affinity, 2 unverifiable)". Missing means below the reference median for tags and references,
 * outside the top 10 cities for a city, and not this world's age band for ages.
 */
export function fitLine(below: number, checkable: number, missing: number, unverifiable: number): string {
  const notes = [missing ? `${missing} with no measurable affinity` : null, unverifiable ? `${unverifiable} unverifiable` : null].filter(Boolean);
  const verb = below === 1 ? "misses" : "miss";
  return `${below} of ${checkable} checkable LLM-only ${checkable === 1 ? "choice" : "choices"} ${verb} what Qloo measured for this world${notes.length ? ` (${notes.join(", ")})` : ""}`;
}
