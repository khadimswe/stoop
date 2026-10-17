// The Culture agent: one bounded tool-calling agent per concept world (AI SDK 7 ToolLoopAgent). It
// reads the world's scored Qloo candidates and writes the Culture Brief, citing candidate ids only.
// Its tools are Qloo, through the same client, budget and receipts as every other call:
//   search_tags          find a Qloo tag for a thin field (one /v2/tags call)
//   probe                one more insights call with this world's signal (a single place genre, say)
//   score_against_panel  place probed candidates against the frozen panel (one scoring call)
//   submit_brief         the brief: wording plus cited ids, checked by the grounding guard
// The probes share the run's 4-call "probes" row (at most MAX_PROBES per world), so worlds running side
// by side can never eat the scoring calls; a spent budget comes back to the model as a tool result. The loop stops
// on an accepted brief or after 4 steps (then one fresh submit-only turn if no brief came). A rejected brief comes back
// once with its problems (the self-critique: below-median picks, names in the wording, wrong cites);
// what still fails after that is dropped by the guard.
import { isStepCount, tool, ToolLoopAgent, type LanguageModel, type StopCondition } from "ai";
import { z } from "zod";
import { ENTITY_PANELS } from "../culture/panels";
import { TAG_KINDS } from "../data-check/plan";
import { checkText } from "../guardrails";
import { QlooBudgetError } from "../qloo/errors";
import { panelPosition } from "../qloo/lift";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import { insightsEntitiesResponse, slimEntitiesBody, tagsResponse } from "../qloo/types";
import type { Seed } from "../report/schema";
import type { CultureField } from "../report/world";
import type { CreativeDirection } from "../types";
import { ageBandLabel } from "../types";
import { decide, qloo, type StageEnv } from "../stages/env";
import { entityCandidates, EVERYDAY_PLACE_TAGS, placeCandidates, worldSignal, type CultureCandidate, type PlaceAnchor } from "../stages/culture";
import { entityScoringParams, SCORED_ENTITY_TYPES, type ScoredEntityType } from "../stages/check";
import { strong } from "../stages/craft";
import { cachedInstructions } from "./ask";
import { briefSubmissionSchema, guardBrief, type BriefSubmission, type GuardResult } from "./grounding";
import { CREATIVE_STRATEGIST_ROLE, GUARDRAIL_INSTRUCTIONS, quoted } from "./instructions";
import { STOOP_PROVIDER_OPTIONS } from "./model";

export const CULTURE_AGENT_VERSION = 1;
export const MAX_STEPS = 4;
/** One rejected brief comes back with its problems; after that the guard drops what still fails. */
export const MAX_REPAIRS = 1;
export const CULTURE_TIMEOUT_MS = 150_000;
/** Probes per world: half of the run's 4-call "probes" row, so two worlds side by side can each probe. */
export const MAX_PROBES = 2;
const MAX_OUTPUT_TOKENS = 12_000;
const PROBE_TAKE = 10;

export function cultureInstructions(): string {
  return [
    CREATIVE_STRATEGIST_ROLE,
    "",
    "Your job here: write one concept world's Culture Brief from what Qloo measured for it. Qloo decides every audience fact and every cultural ingredient; you translate them into craft a director or an AI video tool can shoot.",
    "",
    "How to work:",
    "- You get this world's Qloo candidates by field, each with an id, its rank in Qloo's answer, where it lands against Qloo's frozen reference panel (\"beats 23 of 25\"), and Qloo's own descriptors.",
    "- Cite candidates by id. Prefer picks that beat most of the panel. A pick below the panel median is not support: never cite it.",
    "- People and podcasts have no reference panel, so they show as \"no panel\": that is expected. Cite the ones your creators and voice wording draw on, and cite the mood tags your voice draws on.",
    "- Translate, never name. Films and shows become visual language (color grade, lens, grain, framing, pacing, edit rhythm). Artists and music tags become music feel (genre, era, tempo, instrumentation). Brands become styling with no logos. Places become place types in the setting city. Mood tags become one line of feeling. Podcasts and people become voice and the kind of creator to partner with.",
    "- Your wording never contains a real name: no artist, film, show, brand, person, podcast or business name. The setting city is the one place you may name.",
    "- Each field shows how much Qloo signal it has now. When a field you need is thin or empty, probe before you write: search_tags finds a Qloo tag (for example one place genre that fits the product), probe runs one more Qloo query with this world's signal (narrowed by that tag), score_against_panel places what a probe found. Probes are limited and shared with other worlds; if one is refused, write with what you have.",
    "- Tempo, camera and lens are your craft choices: write them plainly. Never add notes about labels, sources or interpretation; the report labels every cue itself.",
    "- If a field has nothing to cite, leave its cites empty: it will show as \"No Qloo signal\" or as a creative suggestion, never as Qloo data.",
    "- Finish by calling submit_brief. If it comes back with problems, fix them and submit again.",
    "",
    GUARDRAIL_INSTRUCTIONS,
  ].join("\n");
}

const FIELD_LABELS: Record<CultureField, string> = {
  music: "Music (artists and music tags)",
  visual: "Visual (films and TV shows)",
  wardrobe: "Wardrobe (brands)",
  setting: "Setting (places in the setting city)",
  mood: "Mood (Qloo mood tags)",
  voice: "Voice",
  creators: "Creators (people and podcasts this whole audience follows)",
};

function candidateLine(c: CultureCandidate): string {
  const position = c.position ? `beats ${c.position.beats} of ${c.position.of}${c.position.aboveMedian === false ? " (below median: do not cite)" : ""}` : "no panel";
  const parts = [`${c.id} | ${c.name} | ${c.type.replace("urn:", "")} | #${c.rank} | ${position}`];
  if (c.details.length) parts.push(`descriptors: ${c.details.join("; ")}`);
  if (c.why.length) parts.push(`why: ${c.why.join("; ")}`);
  return `- ${parts.join(" | ")}`;
}

export interface CultureAgentInput {
  segmentId: string;
  label: string;
  bucket: AgeBucket;
  seeds: readonly Seed[];
  candidates: readonly CultureCandidate[];
  settingCity: string | null;
  anchor: PlaceAnchor | null;
  product: { name: string; oneLine: string };
  direction: CreativeDirection;
  /** Every real name the run knows, kept out of the wording. */
  names: readonly string[];
  /** False for product-only and pet ads. */
  talent: boolean;
  /** Chains the sweep left out of this world's places; probes leave them out too. */
  chains: readonly string[];
  /** The seller's own words about the product (lib/prompts/brief.ts sellerText). */
  sellerText: string;
}

/** What a field's candidates add up to right now, in the code's own terms (the agent never decides a signal level). */
function signalNote(list: readonly CultureCandidate[]): string {
  const strongCount = list.filter(strong).length;
  if (list.length === 0) return "no signal yet";
  if (list.every((x) => x.field === "creators")) return `${list.length} people and podcasts (no panel; cite the ones you draw on)`;
  return strongCount >= 3 ? `rich (${strongCount} strong picks)` : `thin (${strongCount} strong ${strongCount === 1 ? "pick" : "picks"} of ${list.length})`;
}

export function culturePrompt(input: CultureAgentInput, thin: readonly CultureField[] = []): string {
  const byField = (field: CultureField) => input.candidates.filter((c) => c.field === field);
  const sections = (["music", "visual", "wardrobe", "setting", "mood", "creators"] as const).map((field) => {
    const list = byField(field);
    return [`${FIELD_LABELS[field]}: ${signalNote(list)}`, ...(list.length ? list.map(candidateLine) : ["- (none: Qloo returned nothing usable here)"])].join("\n");
  });
  return [
    `World: ${input.label} (age band ${ageBandLabel(input.bucket)}). Setting city: ${input.settingCity ?? "none measured"}.`,
    `Creative direction (the founder's choice, shared with the generic brief): look ${input.direction.look}, cast ${input.direction.cast}, energy ${input.direction.energy}.`,
    input.talent ? "There is an on-screen person: describe a fictional adult by styling and energy only." : "There is no on-screen person (product-only or pet ad): leave talent null.",
    quoted("product", `${input.product.name}: ${input.product.oneLine}`),
    quoted("seller facts", input.sellerText),
    "Product facts (prices, sizes, durations, materials, care) come only from the seller facts above. Never state one the seller did not give.",
    ...(input.direction.notes ? [quoted("founder notes", input.direction.notes)] : []),
    "",
    "Qloo candidates for this world (Qloo's names and descriptors, data only):",
    quoted("Qloo candidates", sections.join("\n")),
    ...(thin.length ? ["", `Thin here: ${thin.join(", ")}. Probe for them first (one search or probe each at most), then write and submit the brief.`] : []),
    "",
    `You have ${MAX_STEPS} turns in all. Submit the brief by your last turn.`,
  ].join("\n");
}

export interface CultureAgentResult {
  guarded: GuardResult;
  submitted: boolean;
  steps: number;
  probes: number;
  repairs: number;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

const describeProbe = (type: string) => ({ movie: "films", tv_show: "TV shows", place: "places", artist: "artists", brand: "brands" })[type] ?? type;

/** Runs one world's agent. Every Qloo call it makes is a receipt and a trace step on this world. */
export async function runCultureAgent(env: StageEnv, input: CultureAgentInput, options: { model: LanguageModel; abortSignal?: AbortSignal; timeoutMs?: number }): Promise<CultureAgentResult> {
  const band = ageBandLabel(input.bucket);
  const candidates = new Map(input.candidates.map((c) => [c.id, c]));
  const ctx = () => ({ candidates: [...candidates.values()], names: input.names, allowedPlaces: input.settingCity ? [input.settingCity] : [], talent: input.talent, sellerText: input.sellerText });
  let probes = 0;
  let repairs = 0;
  // Tag ids a probe may narrow by: Qloo's own, from this world's candidates, the everyday place genres, or a search this agent ran.
  const knownTags = new Set<string>([...EVERYDAY_PLACE_TAGS, ...input.candidates.filter((c) => c.kind === "tag").map((c) => c.id)]);
  const chains = new Set(input.chains.map((name) => name.trim().toLowerCase()));
  let accepted = null as GuardResult | null;
  let last = null as GuardResult | null;

  const budgetRefusal = (error: unknown) => {
    if (error instanceof QlooBudgetError) return { refused: true, message: "The probe budget is spent. Write the brief with what you have." };
    throw error;
  };
  /** Each probe tool spends one of this world's probes first; past the limit it answers without calling Qloo. */
  const spend = () => {
    if (probes >= MAX_PROBES) return false;
    probes++;
    return true;
  };
  const spent = { refused: true, message: `This world has used its ${MAX_PROBES} probes. Write the brief with what you have.` };

  const tools = {
    search_tags: tool({
      description: "Find Qloo tags by name, for one kind: a music genre or a place genre. One Qloo call.",
      inputSchema: z.object({ query: z.string().min(1).max(60), kind: z.enum(["music", "place"]) }),
      execute: async ({ query, kind }) => {
        if (!spend()) return spent;
        try {
          const result = await qloo(env, "culture", `Searching Qloo's ${kind} tags for "${query}"`, {
            endpoint: ENDPOINTS.tags,
            params: { "filter.query": query, "filter.tag.types": [kind === "music" ? TAG_KINDS.music : "urn:tag:genre:place"], take: 10 },
            schema: tagsResponse,
            budgetRow: "probes",
          });
          const tags = result.data.filter((t) => checkText(t.name).every((i) => i.rule !== "minor" && i.rule !== "ethnicity")).map((t) => ({ id: t.id, name: t.name }));
          for (const tag of tags) knownTags.add(tag.id);
          return { tags };
        } catch (error) {
          return budgetRefusal(error);
        }
      },
    }),
    probe: tool({
      description: "One more Qloo query with this world's signal: films, TV shows, artists, brands, or places in the setting city, optionally narrowed by up to 3 Qloo tag ids. One Qloo call.",
      inputSchema: z.object({
        type: z.enum(["movie", "tv_show", "artist", "brand", "place"]),
        tagIds: z.array(z.string()).max(3).default([]),
        reason: z.string().max(200),
      }),
      execute: async ({ type, tagIds, reason }) => {
        if (type === "place" && !input.anchor) return { refused: true, message: "This world has no setting city to search places in." };
        const unknown = tagIds.filter((id) => !knownTags.has(id));
        if (unknown.length) return { refused: true, message: `Only tag ids Qloo returned can narrow a probe (from search_tags or your candidates); unknown: ${unknown.join(", ")}.` };
        const tags = tagIds.length ? tagIds : type === "place" ? [...EVERYDAY_PLACE_TAGS] : [];
        const params = {
          ...worldSignal(input.seeds, input.bucket),
          "filter.type": `urn:entity:${type}`,
          ...(type === "place" ? { ...input.anchor, "feature.explainability": true } : {}),
          ...(tags.length ? { "filter.tags": tags, ...(tags.length > 1 ? { "operator.filter.tags": "union" } : {}) } : {}),
          take: PROBE_TAKE,
        };
        if (!spend()) return spent;
        try {
          const result = await qloo(env, "culture", `Probing more ${describeProbe(type)} for ${band}: ${reason}`, {
            endpoint: ENDPOINTS.insights,
            params,
            schema: insightsEntitiesResponse,
            slim: slimEntitiesBody,
            budgetRow: "probes",
          });
          const field: CultureField = type === "place" ? "setting" : type === "artist" ? "music" : type === "brand" ? "wardrobe" : "visual";
          const found =
            type === "place"
              ? placeCandidates(result.data, result.evidence.id, new Map(input.seeds.map((s) => [s.ref.id, s.ref.name]))).kept.filter((p) => !chains.has(p.name.trim().toLowerCase()))
              : entityCandidates(result.data, field, result.evidence.id);
          const added = found.filter((c) => !candidates.has(c.id));
          for (const c of added) candidates.set(c.id, c);
          return { candidates: added.map(candidateLine) };
        } catch (error) {
          return budgetRefusal(error);
        }
      },
    }),
    score_against_panel: tool({
      description: "Place probed candidates (artists, brands, films or TV shows) against Qloo's frozen reference panel for this world. One Qloo call.",
      inputSchema: z.object({ type: z.enum(SCORED_ENTITY_TYPES), ids: z.array(z.string()).min(1).max(15) }),
      execute: async ({ type, ids }) => {
        const known = ids.filter((id) => candidates.get(id)?.type === `urn:entity:${type}`);
        if (known.length === 0) return { refused: true, message: `None of those ids is a ${type} candidate.` };
        const own = new Set(input.candidates.filter((c) => c.type === `urn:entity:${type}`).map((c) => c.id));
        const panel = ENTITY_PANELS[type as ScoredEntityType].map((p) => p.id);
        if (!spend()) return spent;
        try {
          const result = await qloo(env, "culture", `Scoring probed ${describeProbe(type)} for ${band} against the reference panel`, {
            endpoint: ENDPOINTS.insights,
            params: entityScoringParams(input.seeds, input.bucket, type, [...known, ...panel]),
            schema: insightsEntitiesResponse,
            slim: slimEntitiesBody,
            budgetRow: "probes",
          });
          const scores = new Map(result.data.flatMap((e) => (e.affinity === null ? [] : [[e.id, e.affinity] as const])));
          const panelScores = panel.filter((id) => !own.has(id) && scores.has(id)).map((id) => scores.get(id) as number);
          const placed = known.map((id) => {
            const c = candidates.get(id) as CultureCandidate;
            const score = scores.get(id);
            const position = score === undefined ? null : panelPosition(score, panelScores);
            const next = { ...c, position, evidenceIds: [...new Set([...c.evidenceIds, result.evidence.id])] };
            candidates.set(id, next);
            return candidateLine(next);
          });
          return { placed };
        } catch (error) {
          return budgetRefusal(error);
        }
      },
    }),
    submit_brief: tool({
      description: "Submit the Culture Brief: wording plus the ids each cue rests on. It is checked against Qloo's data and the guardrails.",
      inputSchema: briefSubmissionSchema,
      execute: async (submission: BriefSubmission) => {
        const result = guardBrief(submission, ctx());
        last = result;
        if (result.problems.length === 0 || repairs >= MAX_REPAIRS) {
          accepted = result;
          return { accepted: true, ...(result.problems.length ? { dropped: result.problems } : {}) };
        }
        repairs++;
        if (result.belowMedian.length) {
          const names = result.belowMedian.map((c) => c.name);
          decide(env, "culture", `Dropped ${names.length} of my picks (below panel median), re-choosing`, `${names.join(", ")} rank below the reference median for ${band}.`);
        }
        decide(env, "culture", `Sent my brief back with ${result.problems.length} ${result.problems.length === 1 ? "problem" : "problems"}`, result.problems.slice(0, 4).join(" "));
        return { accepted: false, problems: result.problems, message: "Fix these and call submit_brief again." };
      },
    }),
  };

  const done: StopCondition<typeof tools> = () => accepted !== null;
  // Thin fields the brief needs are named in the prompt, so the agent looks for more signal before it
  // writes. The tool list never changes inside a conversation: with thinking on, Anthropic binds each
  // thinking block to the tools it was created with, so steps can't narrow or force tools.
  const thin = thinFields(input);
  if (thin.length > 0) decide(env, "culture", `Asked for more signal on ${thin.join(" and ")} for ${band}`, "Qloo's answer for these fields is thin, so the agent may probe before it writes.");
  const settings = { model: options.model, instructions: cachedInstructions(cultureInstructions()), maxOutputTokens: MAX_OUTPUT_TOKENS, maxRetries: 1, providerOptions: STOOP_PROVIDER_OPTIONS };
  const agent = new ToolLoopAgent({ ...settings, tools, stopWhen: [done, isStepCount(MAX_STEPS)] });

  const timeout = AbortSignal.timeout(options.timeoutMs ?? CULTURE_TIMEOUT_MS);
  const abortSignal = options.abortSignal ? AbortSignal.any([timeout, options.abortSignal]) : timeout;
  const first = await agent.generate({ prompt: culturePrompt(input, thin), abortSignal });
  let steps = first.steps.length;
  let totalIn = first.totalUsage?.inputTokens ?? 0;
  let totalOut = first.totalUsage?.outputTokens ?? 0;
  // No brief after the loop: one fresh conversation, rebuilt from every candidate found so far (probes
  // included), where submit_brief is the only tool.
  if (!accepted && !last) {
    decide(env, "culture", `Asked again for the ${band} brief`, "The agent used its steps without submitting a brief, so it gets one more turn with only the submit tool.");
    const finish = new ToolLoopAgent({ ...settings, tools: { submit_brief: tools.submit_brief }, stopWhen: [isStepCount(1)] });
    const again = await finish.generate({ prompt: `${culturePrompt({ ...input, candidates: [...candidates.values()] })}\n\nWrite the brief now and submit it with submit_brief.`, abortSignal });
    steps += again.steps.length;
    totalIn += again.totalUsage?.inputTokens ?? 0;
    totalOut += again.totalUsage?.outputTokens ?? 0;
  }
  const final = accepted ?? last;
  const usage = { inputTokens: totalIn || null, outputTokens: totalOut || null };
  if (!final) {
    decide(env, "culture", `No brief came back for ${band}`, "The agent stopped without submitting, so every field shows what Qloo measured with no wording.");
    return { guarded: guardBrief(emptySubmission(), ctx()), submitted: false, steps, probes, repairs, usage };
  }
  return { guarded: final, submitted: true, steps, probes, repairs, usage };
}

/** Fields the brief needs whose candidates are thin or empty, and that a probe could reach. */
export function thinFields(input: Pick<CultureAgentInput, "candidates" | "anchor">): CultureField[] {
  const reachable: CultureField[] = ["setting", "wardrobe", "visual", "music"];
  return reachable.filter((field) => {
    if (field === "setting" && !input.anchor) return false;
    return !signalNote(input.candidates.filter((c) => c.field === field)).startsWith("rich");
  });
}

/** What the guard sees when the agent never submitted: nothing cited, nothing written. */
function emptySubmission(): BriefSubmission {
  const empty = { text: "", cites: [] };
  return { music: empty, visual: empty, wardrobe: null, setting: [], mood: empty, voice: { tone: empty, use: [], avoid: [] }, talent: null, productRole: "", hooks: [], creators: null };
}
