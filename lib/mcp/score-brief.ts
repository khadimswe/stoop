// MCP `score_brief`: "does Qloo support these creative choices for this audience?" Qloo only: no LLM,
// no frames. The audience is the taste neighborhood of 2 to 5 seeds (no store data), optionally
// narrowed to one age band and, for artists and brands, re-ranked for a region.
//
// It is the Gate 4 check engine run on someone else's choices, with Gate 2's method:
// 1. Seeds resolve through /search with the name-match rule (lib/qloo/match.ts); a hit that does not
//    match is dropped, never guessed.
// 2. Choices map the way the check maps the LLM-only Control: a music style to a Qloo music tag (the
//    best /v2/tags hit at the matcher's threshold), a mood to Qloo's emotional-tone id (built from the
//    word; it counts only if a scoring call returns it), named brands, films, TV and artists through
//    /search. A choice that resolves to a seed is left out: the seeds are the signal.
// 3. Per scored type: Qloo's own top list for the audience, then ONE filter.results call scoring
//    Qloo's top 10, the choices and the frozen reference panel together (affinity only compares
//    within one call; take covers every id).
// 4. A choice reads "beats N of M reference brands", supported above the panel median and below it
//    under; no score is "no measurable affinity" (missing), never "unsupported"; fewer than 5 panel
//    items means no median, so no claim (unverifiable). Never a percentile.
// Without an age band or region the requests are exactly Gate 2's (lib/data-check/plan.ts), so the
// recorded pool replays them.
import { z } from "zod";
import { SEARCH_TYPES } from "../api/requests";
import { TAG_PANELS, ENTITY_PANELS } from "../culture/panels";
import { moodTerm, musicTerm } from "../data-check/score";
import { TAG_KINDS, tagQuery, toneTag } from "../data-check/plan";
import type { Evidence } from "../evidence";
import { checkText } from "../guardrails";
import type { QlooClient } from "../qloo/client";
import { ENDPOINTS, type AgeBucket, type EntityType } from "../qloo/constants";
import type { RunContext } from "../qloo/context";
import { QlooBudgetError, QlooConfigError, QlooFixtureMissError, QlooHttpError, QlooShapeError } from "../qloo/errors";
import { panelPosition } from "../qloo/lift";
import { bestTag, normalizeName } from "../qloo/match";
import type { QlooParams } from "../qloo/params";
import { resolveEntityWithReceipt, type ReceiptLookup } from "../qloo/resolve";
import { insightsEntitiesResponse, insightsTagsResponse, slimBody, tagsResponse } from "../qloo/types";
import type { Seed } from "../report/schema";
import { CHOICE_STATUSES } from "../report/world";
import { statusFrom, SCORED_ENTITY_TYPES, type ScoredEntityType, type ScoredTagKind } from "../stages/check";
// Qloo's top picks scored next to the choices, the same 10 as Gate 2 and the check.
import { TOP_PICKS } from "../stages/culture";
import { seedSignal } from "../stages/prove";
import { ageBandLabel, ageBucketSchema } from "../types";

// --- Input ----------------------------------------------------------------------------------------

export const SCORE_SEEDS = { min: 2, max: 5 } as const;
/** Choices that need a lookup (music styles and named references) per request, with up to 5 seeds: SCORE_BRIEF_BUDGET.resolve. */
export const MAX_LOOKUP_CHOICES = 8;

const name = z.string().trim().min(1).max(100);
const names = (what: string) => z.array(name).max(3).default([]).describe(`Up to 3 ${what}, by name.`);

export const scoreBriefInputSchema = z.strictObject({
  product: z.string().trim().min(1).max(200).describe("The product in a few words. Shown back with the result; never sent to Qloo."),
  seeds: z
    .array(z.strictObject({ name, type: z.enum(SEARCH_TYPES) }))
    .min(SCORE_SEEDS.min)
    .max(SCORE_SEEDS.max)
    .describe('2 to 5 things the product\'s customers also love, each with its Qloo type, e.g. {"name": "Hot Ones", "type": "tv_show"}. They define the audience.'),
  ageBucket: ageBucketSchema.optional().describe('Narrow the audience to one Qloo age band. "24_and_younger" reads as 18 to 24: Stoop never targets anyone under 18.'),
  region: z.string().trim().min(2).max(80).optional().describe('A region such as "Texas". Qloo applies it to artist and brand scores only.'),
  choices: z
    .strictObject({
      music: z.array(z.string().trim().min(2).max(300)).max(2).default([]).describe('Up to 2 music styles, e.g. "lo-fi hip hop". Styles, never song titles. The genre phrase before any "with ..." is what gets matched.'),
      mood: z.array(z.string().trim().min(2).max(120)).max(2).default([]).describe('Up to 2 moods, e.g. "warm". The first word or phrase before a comma is what gets matched.'),
      brands: names("brands"),
      films: names("films"),
      tv: names("TV shows"),
      artists: names("artists"),
    })
    .refine((c) => c.music.length + c.mood.length + c.brands.length + c.films.length + c.tv.length + c.artists.length > 0, {
      error: "give at least one creative choice",
    })
    .refine((c) => c.music.length + c.brands.length + c.films.length + c.tv.length + c.artists.length <= MAX_LOOKUP_CHOICES, {
      error: `give at most ${MAX_LOOKUP_CHOICES} music styles and named references together`,
    })
    .describe("The creative choices to check against this audience."),
});
export type ScoreBriefInput = z.output<typeof scoreBriefInputSchema>;

// --- Output ---------------------------------------------------------------------------------------

export const CHOICE_DIMENSIONS = ["music", "mood", "brand", "film", "tv_show", "artist"] as const;
export type ChoiceDimension = (typeof CHOICE_DIMENSIONS)[number];
const positionSchema = z.strictObject({ beats: z.number().int(), of: z.number().int(), aboveMedian: z.boolean().nullable() });

export const scoreBriefResultSchema = z.strictObject({
  status: z.enum(["scored", "not_enough_seeds", "unavailable"]),
  product: z.string(),
  /** Always said: without store data this is the taste neighborhood, not anyone's buyers. */
  audience: z.strictObject({
    basis: z.string(),
    seeds: z.array(
      z.strictObject({
        name: z.string(),
        type: z.string(),
        matched: z.strictObject({ id: z.string(), name: z.string(), match: z.enum(["exact", "affix"]) }).nullable(),
        evidenceIds: z.array(z.string()),
      }),
    ),
    ageBand: z.string().nullable(),
    region: z.string().nullable(),
  }),
  choices: z.array(
    z.strictObject({
      dimension: z.enum(CHOICE_DIMENSIONS),
      text: z.string(),
      matched: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
      status: z.enum(CHOICE_STATUSES),
      position: positionSchema.nullable(),
      measured: z.string().nullable(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  /** Qloo's own top 3 per scored type, placed against the same panel: what this audience does love. */
  qlooPicks: z.array(z.strictObject({ dimension: z.enum(CHOICE_DIMENSIONS), id: z.string(), name: z.string(), position: positionSchema.nullable(), evidenceIds: z.array(z.string()) })),
  fit: z.strictObject({ checkable: z.number().int(), below: z.number().int(), missing: z.number().int(), unverifiable: z.number().int(), line: z.string() }),
  notes: z.array(z.string()),
  calls: z.strictObject({ live: z.number().int(), cached: z.number().int(), cap: z.number().int() }),
  receipts: z.array(z.strictObject({ id: z.string(), endpoint: z.string(), label: z.string().nullable(), cached: z.boolean(), fetchedAt: z.string() })),
});
export type ScoreBriefResult = z.infer<typeof scoreBriefResultSchema>;
type ChoiceResult = ScoreBriefResult["choices"][number];

/** "2 of 5 checkable choices below this audience's reference median (1 with no measurable affinity, 1 unverifiable)". */
export function scoreLine(below: number, checkable: number, missing: number, unverifiable: number): string {
  const notes = [missing ? `${missing} with no measurable affinity` : null, unverifiable ? `${unverifiable} unverifiable` : null].filter(Boolean);
  return `${below} of ${checkable} checkable ${checkable === 1 ? "choice" : "choices"} below this audience's reference median${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

export const AUDIENCE_BASIS = "Without store data, Stoop measures your product's taste neighborhood: the audience around these seeds, from Qloo's aggregate taste data.";

// --- Scoring --------------------------------------------------------------------------------------

type ScoredType = ScoredEntityType | ScoredTagKind;
const DIMENSION_OF: Record<ScoredType, ChoiceDimension> = { artist: "artist", brand: "brand", movie: "film", tv_show: "tv_show", music: "music", tone: "mood" };
const LABEL: Record<ScoredType, string> = { artist: "artists", brand: "brands", movie: "films", tv_show: "TV shows", music: "music tags", tone: "mood tags" };
/** Qloo's picks shown back per type. */
export const SHOWN_PICKS = 3;
/** The top-list sizes Gate 2 recorded (lib/data-check/plan.ts audienceRequests). */
const ENTITY_LIST_TAKE = 50;
const TAG_LIST_TAKE = 30;

export interface ScoreBriefDeps {
  client: QlooClient;
  /** Its own context, capped by SCORE_BRIEF_BUDGET and SCORE_BRIEF_CAP. */
  ctx: RunContext;
}

/** Qloo said no, could not answer, or answered in a shape Stoop can't read: the choice shows as unverifiable instead of failing the tool. */
const unavailable = (error: unknown) =>
  error instanceof QlooBudgetError || error instanceof QlooHttpError || error instanceof QlooFixtureMissError || error instanceof QlooConfigError || error instanceof QlooShapeError;

/** Identity words never come back as names (the same rule Prove applies to tags). */
const guarded = (text: string) => checkText(text).some((issue) => issue.rule === "minor" || issue.rule === "ethnicity");

interface Mapped {
  dimension: ChoiceDimension;
  type: ScoredType | null;
  text: string;
  ref: { id: string; name: string } | null;
  evidenceIds: string[];
  /** Why there is nothing to score, when ref is null or the choice is left out. */
  note: string | null;
  excluded?: boolean;
}

export async function scoreBrief(input: ScoreBriefInput, deps: ScoreBriefDeps): Promise<ScoreBriefResult> {
  const { client, ctx } = deps;
  const notes: string[] = [];
  const bucket = input.ageBucket ?? null;
  const region = input.region ?? null;

  const request = async <T>(row: "resolve" | "prove" | "scoring", label: string, endpoint: (typeof ENDPOINTS)[keyof typeof ENDPOINTS], params: QlooParams, schema: z.ZodType<T>, notFound?: T) =>
    client.request(ctx, {
      endpoint,
      params,
      schema,
      label,
      stage: "score",
      budgetRow: row,
      ...(notFound === undefined ? {} : { onNotFound: notFound }),
      slim: (body: unknown) => slimBody(endpoint, params["filter.type"], body),
    });
  const lookup: ReceiptLookup = async (req, schema, notFound) => {
    const result = await request("resolve", req.label, req.endpoint, req.params, schema, notFound);
    return { data: result.data, evidence: result.evidence };
  };

  // 1. Seeds.
  let failedLookups = 0;
  const seedResults = await Promise.all(
    input.seeds.map(async (seed) => {
      try {
        return { seed, resolved: await resolveEntityWithReceipt(seed.name, seed.type as EntityType, lookup) };
      } catch (error) {
        if (!unavailable(error)) throw error;
        failedLookups++;
        return { seed, resolved: null };
      }
    }),
  );
  const seeds: Seed[] = [];
  for (const { resolved } of seedResults) {
    const entity = resolved?.entity;
    if (entity && !seeds.some((s) => s.ref.id === entity.id)) {
      seeds.push({ ref: { kind: "entity", id: entity.id, name: entity.name, type: `urn:entity:${resolved.type}` }, origin: "you", match: entity.match, evidenceIds: [resolved.evidence.id] });
    }
  }
  const dropped = seedResults.filter((r) => r.resolved && !r.resolved.entity).map((r) => r.seed.name);
  if (dropped.length) notes.push(`Qloo found no match for ${dropped.join(", ")}, so ${dropped.length === 1 ? "it is" : "they are"} not part of the audience.`);
  const unanswered = seedResults.filter((r) => !r.resolved).map((r) => r.seed.name);
  if (unanswered.length) notes.push(`Qloo did not answer the lookup for ${unanswered.join(", ")}, so ${unanswered.length === 1 ? "it is" : "they are"} not part of the audience.`);

  const audience: ScoreBriefResult["audience"] = {
    basis: AUDIENCE_BASIS,
    seeds: seedResults.map(({ seed, resolved }) => ({
      name: seed.name,
      type: seed.type,
      matched: resolved?.entity ? { id: resolved.entity.id, name: resolved.entity.name, match: resolved.entity.match } : null,
      evidenceIds: resolved ? [resolved.evidence.id] : [],
    })),
    ageBand: bucket ? ageBandLabel(bucket) : null,
    region,
  };
  const finish = (status: ScoreBriefResult["status"], choices: ChoiceResult[], qlooPicks: ScoreBriefResult["qlooPicks"]): ScoreBriefResult => {
    const count = (s: ChoiceResult["status"]) => choices.filter((c) => c.status === s).length;
    const unverifiable = count("unverifiable");
    const checkable = choices.length - unverifiable;
    return {
      status,
      product: input.product,
      audience,
      choices,
      qlooPicks,
      fit: { checkable, below: count("below"), missing: count("missing"), unverifiable, line: scoreLine(count("below"), checkable, count("missing"), unverifiable) },
      notes,
      calls: { live: ctx.liveCalls, cached: ctx.cachedCalls, cap: ctx.cap },
      receipts: ctx.ledger.entries.map((e: Evidence) => ({ id: e.id, endpoint: e.endpoint, label: e.label ?? null, cached: e.cached, fetchedAt: e.fetchedAt })),
    };
  };
  if (seeds.length < SCORE_SEEDS.min) {
    notes.push(
      failedLookups > 0
        ? "Qloo did not answer every seed lookup, so there is no audience to score against. Try again later."
        : `Qloo matched ${seeds.length} of ${input.seeds.length} seeds; it needs at least ${SCORE_SEEDS.min} to measure an audience.`,
    );
    return finish(failedLookups > 0 ? "unavailable" : "not_enough_seeds", [], []);
  }
  const seedIds = new Set(seeds.map((s) => s.ref.id));

  // 2. Choices, mapped to Qloo.
  const safe = async <T>(what: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      if (!unavailable(error)) throw error;
      notes.push(`Qloo did not answer the lookup for ${what}, so it shows as unverifiable.`);
      return null;
    }
  };
  const music = input.choices.music.map(async (style): Promise<Mapped> => {
    const term = musicTerm(style);
    if (!normalizeName(term)) return { dimension: "music", type: "music", text: style, ref: null, evidenceIds: [], note: "no genre words to match" };
    const req = tagQuery("music", term, `score_brief music: "${style.slice(0, 60)}".`);
    const found = await safe(`the music "${term}"`, () => lookup({ ...req, label: `Matching the music "${term}" to a Qloo tag` }, tagsResponse));
    const best = found ? bestTag(term, found.data.filter((t) => t.type === TAG_KINDS.music)) : undefined;
    return { dimension: "music", type: "music", text: style, ref: best ? { id: best.tag.id, name: best.tag.name } : null, evidenceIds: found ? [found.evidence.id] : [], note: best ? null : "no Qloo music tag matches it" };
  });
  const moods = input.choices.mood.map(async (mood): Promise<Mapped> => {
    const term = moodTerm(mood);
    if (!normalizeName(term)) return { dimension: "mood", type: "tone", text: mood, ref: null, evidenceIds: [], note: "no mood word to match" };
    const tone = toneTag(term);
    return { dimension: "mood", type: "tone", text: mood, ref: tone.tag ? { id: tone.tag.id, name: tone.tag.name } : null, evidenceIds: [], note: null };
  });
  const named: [ScoredEntityType, string[]][] = [
    ["brand", input.choices.brands],
    ["movie", input.choices.films],
    ["tv_show", input.choices.tv],
    ["artist", input.choices.artists],
  ];
  const references = named.flatMap(([type, list]) =>
    list.map(async (text): Promise<Mapped> => {
      const resolved = await safe(text, () => resolveEntityWithReceipt(text, type, lookup));
      const entity = resolved?.entity;
      const base = { dimension: DIMENSION_OF[type], type, text, evidenceIds: resolved ? [resolved.evidence.id] : [] };
      if (entity && seedIds.has(entity.id)) return { ...base, ref: null, note: `it is one of the seeds (${entity.name}), so it can't be scored against them`, excluded: true };
      return { ...base, ref: entity ? { id: entity.id, name: entity.name } : null, note: entity ? null : resolved ? "Qloo found no match for this name" : "Qloo did not answer the lookup" };
    }),
  );
  const mapped = await Promise.all([...music, ...moods, ...references]);

  // 3. One top list and one scoring call per type the mapped choices touch.
  const touched = [...SCORED_ENTITY_TYPES, "music", "tone"].filter((type) => mapped.some((m) => m.type === type && m.ref)) as ScoredType[];
  const signal = (type: ScoredType): QlooParams => ({
    ...seedSignal(seeds),
    ...(bucket ? { "signal.demographics.age": [bucket] as AgeBucket[] } : {}),
    // Region reaches brand and artist results only through signal.location.query; Qloo ignores it elsewhere (lib/qloo/schemas.ts).
    ...(region && (type === "artist" || type === "brand") ? { "signal.location.query": region } : {}),
  });
  const band = bucket ? `${ageBandLabel(bucket)}'s ` : "the audience's ";
  const scored = new Map<ScoredType, { top: { id: string; name: string }[]; scores: Map<string, number>; names: Map<string, string>; evidenceIds: string[] }>();
  await Promise.all(
    touched.map(async (type) => {
      const isTag = type === "music" || type === "tone";
      const panel = isTag ? TAG_PANELS[type].map((p) => p.id) : ENTITY_PANELS[type].map((p) => p.id);
      const result = await safe(`Qloo's ${LABEL[type]}`, async () => {
        const list = isTag
          ? await request("prove", `Reading ${band}top ${LABEL[type]}`, ENDPOINTS.insights, { ...signal(type), "filter.type": "urn:tag", "filter.tag.types": [TAG_KINDS[type]], take: TAG_LIST_TAKE }, insightsTagsResponse)
          : await request("prove", `Reading ${band}top ${LABEL[type]}`, ENDPOINTS.insights, { ...signal(type), "filter.type": `urn:entity:${type}`, take: ENTITY_LIST_TAKE }, insightsEntitiesResponse);
        const top = list.data
          .filter((item) => !isTag || ("type" in item && item.type === TAG_KINDS[type as ScoredTagKind]))
          .slice(0, TOP_PICKS)
          // Qloo's tag names can carry stray spaces (" rock"); Prove trims them the same way.
          .map((item) => ({ id: item.id, name: item.name.trim() }));
        const choiceIds = mapped.filter((m) => m.type === type && m.ref).map((m) => (m.ref as { id: string }).id);
        const ids = [...new Set([...top.map((t) => t.id), ...choiceIds, ...panel])].filter((id) => !seedIds.has(id));
        const params: QlooParams = isTag
          ? { ...signal(type), "filter.type": "urn:tag", "filter.results.tags": ids, take: ids.length }
          : { ...signal(type), "filter.type": `urn:entity:${type}`, "filter.results.entities": ids, take: ids.length };
        const label = `Scoring the choices against Qloo's reference ${LABEL[type]}`;
        const scoring = isTag
          ? await request("scoring", label, ENDPOINTS.insights, params, insightsTagsResponse)
          : await request("scoring", label, ENDPOINTS.insights, params, insightsEntitiesResponse);
        const scores = new Map<string, number>(scoring.data.flatMap((item) => (item.affinity === null ? [] : [[item.id, item.affinity] as [string, number]])));
        const names = new Map<string, string>(scoring.data.map((item) => [item.id, item.name.trim()]));
        return { top, scores, names, evidenceIds: [list.evidence.id, scoring.evidence.id] };
      });
      if (result) scored.set(type, result);
    }),
  );

  // 4. Place every choice and Qloo's own picks. A panel never holds Qloo's top picks or the item being placed.
  const place = (type: ScoredType, id: string) => {
    const s = scored.get(type);
    if (!s) return { s: null, position: null };
    const own = new Set(s.top.map((t) => t.id));
    const panel = (type === "music" || type === "tone" ? TAG_PANELS[type] : ENTITY_PANELS[type]).map((p) => p.id);
    const panelScores = panel.filter((pid) => pid !== id && !own.has(pid) && s.scores.has(pid)).map((pid) => s.scores.get(pid) as number);
    const score = s.scores.get(id);
    return { s, position: score === undefined ? null : panelPosition(score, panelScores) };
  };
  const choices: ChoiceResult[] = mapped.map((m) => {
    const unverifiable = (measured: string | null, evidenceIds = m.evidenceIds): ChoiceResult => ({ dimension: m.dimension, text: m.text, matched: m.ref, status: "unverifiable", position: null, measured, evidenceIds });
    if (!m.ref || !m.type) return unverifiable(m.note);
    const { s, position } = place(m.type, m.ref.id);
    if (!s) return unverifiable("Qloo did not answer the scoring call");
    const evidenceIds = [...new Set([...m.evidenceIds, ...s.evidenceIds])];
    // A mood id is built from the word; unless Qloo returns it, there may be no such tag, so nothing is matched.
    if (m.type === "tone" && !position) return { ...unverifiable(`Qloo returned no mood tag "${m.ref.name}"`, evidenceIds), matched: null };
    const matched = { id: m.ref.id, name: s.names.get(m.ref.id) ?? m.ref.name };
    const what = `${matched.name} among ${LABEL[m.type]}`;
    const choice = statusFrom(m.type === "music" ? "music" : m.type === "tone" ? "mood" : "reference", m.text, position, evidenceIds, what);
    return { dimension: m.dimension, text: m.text, matched, status: choice.status, position: choice.position, measured: choice.measured, evidenceIds: choice.evidenceIds };
  });
  const qlooPicks: ScoreBriefResult["qlooPicks"] = touched.flatMap((type) => {
    const s = scored.get(type);
    if (!s) return [];
    return s.top
      .filter((pick) => !guarded(pick.name))
      .slice(0, SHOWN_PICKS)
      .map((pick) => ({ dimension: DIMENSION_OF[type], id: pick.id, name: pick.name, position: place(type, pick.id).position, evidenceIds: s.evidenceIds }));
  });
  return finish("scored", choices, qlooPicks);
}

// --- The answer an agent reads --------------------------------------------------------------------

const DIMENSION_LABEL: Record<ChoiceDimension, string> = { music: "Music", mood: "Mood", brand: "Brand", film: "Film", tv_show: "TV", artist: "Artist" };
const REFERENCE_NOUN: Record<ChoiceDimension, string> = { music: "reference music tags", mood: "reference mood tags", brand: "reference brands", film: "reference films", tv_show: "reference TV shows", artist: "reference artists" };
const STATUS_TEXT: Record<ChoiceResult["status"], string> = { supported: "supported", below: "below the reference median", missing: "no measurable affinity", unverifiable: "unverifiable" };

/** A short plain-text summary next to the structured result. */
export function scoreBriefText(result: ScoreBriefResult): string {
  const seeds = result.audience.seeds.filter((s) => s.matched).map((s) => s.matched?.name);
  const scope = [result.audience.ageBand ? `ages ${result.audience.ageBand}` : null, result.audience.region ? `${result.audience.region} (artists and brands)` : null].filter(Boolean).join(", ");
  const lines = [`${result.product}: scored against the taste neighborhood of ${seeds.join(", ") || "no matched seeds"}${scope ? `, ${scope}` : ""}. ${result.audience.basis}`];
  if (result.status !== "scored") return [...lines, ...result.notes].join("\n");
  lines.push(`${result.fit.line}.`);
  for (const c of result.choices) {
    const where = c.position ? `, beats ${c.position.beats} of ${c.position.of} ${REFERENCE_NOUN[c.dimension]}` : "";
    const matched = c.matched && c.matched.name.toLowerCase() !== c.text.toLowerCase() ? ` (Qloo: ${c.matched.name})` : "";
    lines.push(`- ${DIMENSION_LABEL[c.dimension]} "${c.text}"${matched}: ${STATUS_TEXT[c.status]}${where}${c.status === "unverifiable" && c.measured ? ` (${c.measured})` : ""}`);
  }
  if (result.qlooPicks.length) {
    lines.push("Qloo's own top picks for this audience:");
    for (const p of result.qlooPicks) lines.push(`- ${DIMENSION_LABEL[p.dimension]}: ${p.name}${p.position ? `, beats ${p.position.beats} of ${p.position.of} ${REFERENCE_NOUN[p.dimension]}` : ""}`);
  }
  lines.push(...result.notes, `Qloo calls: ${result.calls.live} live, ${result.calls.cached} cached.`);
  return lines.join("\n");
}
