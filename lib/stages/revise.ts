// "Not this vibe": the founder turns down one cue, or a whole concept world, on a finished live run,
// and the agent builds that world again without the Qloo picks they rejected. A revision runs as its
// own child run ("rev-" plus 12 hex) with its own Qloo context capped at REVISE_CAP live calls. It
// re-runs the world through the run's Qloo calls (Segments, the sweep, creators, the check), which
// replay from the Qloo cache for free with the same params, then the Culture agent with the rejected
// ids left out of its candidates and the founder's reason as quoted data, then craft, concepts, the
// pack and the kit. Fresh Qloo calls happen only when the agent probes for new signal.
//
// What lands on the run's event list, in one write: evidence.added for every receipt the run did not
// have yet, the revision's trace steps under "revise", then world.revised with a cue-by-cue diff.
// The setting city stays: it comes from the audience's cities, not the brief.
import type { LanguageModel } from "ai";
import { reviseRequestSchema } from "../api/requests";
import { reviseResponseSchema, type ReviseResponse } from "../api/responses";
import { runWorld, type BriefEnv, type BriefRun, type Creative } from "../agent/orchestrator";
import { createEmitter, type ReportState, type RunEvent, type RunEventInput } from "../events";
import type { ReferenceSets } from "../geo/metros";
import { checkText, childSetting, FAMOUS_PLACES } from "../guardrails";
import { apiError, type RouteAnswer } from "../http";
import { BRIEF_SLOTS, briefCueTexts, type BriefSlots } from "../prompts/brief";
import { REVISE_CAP } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import { createRunContext } from "../qloo/context";
import { QlooBudgetError, QlooHttpError, QlooShapeError } from "../qloo/errors";
import { heatmapResponse, insightsEntitiesResponse, slimEntitiesBody, slimHeatmapBody, type HeatmapCell } from "../qloo/types";
import type { RealityCheck } from "../report/schema";
import { revisionSchema, type CultureField, type CultureFieldResult, type Revision, type World } from "../report/world";
import { keys, TTL } from "../store/keys";
import { appendRunEvents, getRunMeta, refreshReport } from "../store/runs";
import type { Store } from "../store/types";
import { visitorId } from "../store/visitor";
import { ageBandLabel, type Cue } from "../types";
import type { MeasuredAudience } from "./audience";
import { addRunCost, countingModel, emptyDelta, randomHex, reportNames, runState, type CostDelta } from "./after-run";
import type { ControlRunMap } from "./check";
import { chooseSettingCities, sweepCreators, type SettingCityChoice } from "./culture";
import { decide, qloo, type StageEnv } from "./env";
import { proveRequests } from "./prove";
import { segmentRequestsFor, type SegmentRaw } from "./segments";

/** Revisions one run may start (keys.run.revisions). */
export const REVISIONS_PER_RUN = 3;
/** Revisions one visitor may start in an hour, across runs. */
export const REVISIONS_PER_VISITOR_HOUR = 6;

export type RevisedField = CultureField | "world";

// --- What the founder rejected ----------------------------------------------------------------------

/** The world's brief and culture as shown now: its latest revision's, else its own. */
export function currentBrief(world: World): { brief: BriefSlots | null; culture: CultureFieldResult[] } {
  const latest = world.revisions.at(-1);
  return latest ? { brief: latest.brief, culture: latest.culture } : { brief: world.brief, culture: world.culture ?? [] };
}

/** Every Qloo id the world's briefs rest on (its own and its revisions'): the only ids a founder can reject. */
export function worldSourceIds(world: World): Set<string> {
  const ids = new Set<string>();
  for (const culture of [world.culture ?? [], ...world.revisions.map((r) => r.culture)]) for (const field of culture) for (const source of field.sources) ids.add(source.id);
  return ids;
}

/**
 * The ids a revision leaves out: everything the founder rejected in earlier revisions of this world,
 * plus the ones they name now that are this world's sources. Turning down one cue without naming any
 * leaves out that cue's own current sources; turning down the whole world without naming any adds
 * nothing new (the reason and the rejected wording steer the agent).
 */
export function resolveExclusions(world: World, field: RevisedField, requested: readonly string[]): string[] {
  const known = worldSourceIds(world);
  const earlier = world.revisions.flatMap((r) => r.excluded);
  const named = requested.filter((id) => known.has(id));
  const fresh = named.length > 0 || field === "world" ? named : (currentBrief(world).culture.find((f) => f.field === field)?.sources.map((s) => s.id) ?? []);
  return [...new Set([...earlier, ...fresh])];
}

/** The wording the founder turned down: that field's cues, or every cue of the brief. */
function rejectedWording(world: World, field: RevisedField): string[] {
  const { brief, culture } = currentBrief(world);
  if (field === "world") return brief ? briefCueTexts(brief).map((c) => c.text) : [];
  return culture.find((f) => f.field === field)?.cues.map((c) => c.text) ?? [];
}

// --- The diff -------------------------------------------------------------------------------------------

function slotCues(brief: BriefSlots | null): Map<string, Cue> {
  const cues = new Map<string, Cue>();
  if (!brief) return cues;
  cues.set("productRole", brief.productRole);
  cues.set("mood", brief.mood);
  cues.set("music", brief.music);
  cues.set("visual", brief.visual);
  cues.set("voice.tone", brief.voice.tone);
  brief.setting.forEach((cue, index) => cues.set(`setting.${index}`, cue));
  if (brief.wardrobe) cues.set("wardrobe", brief.wardrobe);
  if (brief.talent) cues.set("talent", brief.talent);
  return cues;
}

/** Cue by cue, in brief order: every slot whose wording or origin changed, added or dropped. */
export function diffBriefs(before: BriefSlots | null, after: BriefSlots): Revision["changes"] {
  const old = slotCues(before);
  const next = slotCues(after);
  return BRIEF_SLOTS.flatMap((slot) => {
    const a = old.get(slot) ?? null;
    const b = next.get(slot) ?? null;
    if (!a && !b) return [];
    if (a && b && a.text === b.text && a.origin === b.origin) return [];
    return [{ slot, before: a, after: b }];
  });
}

// --- Rebuilding the world's inputs from the run's cached calls ---------------------------------------

/**
 * The generic brief as the check scores it, rebuilt from the run's stored Control: the same ids in the
 * same order as the run's scoring calls, so those calls replay from the cache.
 */
export function controlMaps(control: ReportState["control"], bucket: AgeBucket): ControlRunMap[] {
  if (!control || control.run === null || !control.assumed || !control.brief) {
    // No generic brief in this run: a placeholder that scores nothing (its fit is not kept).
    const none = { text: "not stated", ref: null, evidenceIds: [] };
    return [{ run: 1, ageBands: [bucket], cities: [], music: none, mood: none, references: [], settings: [], wardrobe: "not stated" }];
  }
  const tag = (dimension: "music" | "mood"): ControlRunMap["music"] => {
    const mapping = control.mappings.find((m) => m.dimension === dimension);
    return { text: mapping?.text ?? "not stated", ref: mapping?.ref ? { id: mapping.ref.id, name: mapping.ref.name } : null, evidenceIds: mapping?.evidenceIds ?? [] };
  };
  const references: ControlRunMap["references"] = control.mappings
    .filter((m) => m.dimension === "reference")
    .map((m) => ({
      // An unresolved reference is never scored, whatever its type.
      type: (m.ref?.type.replace("urn:entity:", "") ?? "person") as ControlRunMap["references"][number]["type"],
      text: m.text,
      ref: m.ref ? { id: m.ref.id, name: m.ref.name } : null,
      evidenceIds: m.evidenceIds,
    }));
  return [
    {
      run: control.run,
      ageBands: control.assumed.ageBands,
      cities: control.assumed.cities,
      music: tag("music"),
      mood: tag("mood"),
      references,
      settings: control.brief.setting.map((c) => c.text),
      wardrobe: control.brief.wardrobe?.text ?? "not stated",
    },
  ];
}

const EMPTY_GAP: RealityCheck = { outcome: "not_stated", dimensions: [], lines: [] };

/**
 * The world's measured audience again, through the same calls Prove and Segments made (cached): this
 * world's artists and brands, every world's heatmap (so the setting city comes out as it did), and
 * Prove's heatmap when the audience is one of the reference audiences.
 */
async function remeasure(env: StageEnv, state: ReportState, segmentId: string): Promise<{ measured: MeasuredAudience; city: SettingCityChoice | null }> {
  const { proof, segments } = state.audience;
  if (!proof || !segments || !state.inputs) throw new Error("The run has no measured audience to revise from.");
  const { seeds, region } = state.inputs;
  const parent = env.inReference
    ? (await qloo(env, "prove", `Mapping where this taste neighborhood clusters in ${region}`, { endpoint: ENDPOINTS.insights, params: proveRequests(seeds, region).heatmap, schema: heatmapResponse, slim: slimHeatmapBody })).data
    : [];
  const cells = new Map<string, HeatmapCell[]>();
  let raw: SegmentRaw | null = null;
  for (const segment of segments.items) {
    const band = ageBandLabel(segment.bucket);
    const requests = segmentRequestsFor(seeds, segment.bucket, region);
    const own = segment.id === segmentId;
    const artists = own ? await qloo(env, "segments", `Finding the artists ${band} in this audience love`, { endpoint: ENDPOINTS.insights, params: requests.artist, schema: insightsEntitiesResponse, slim: slimEntitiesBody }) : null;
    const brands = own ? await qloo(env, "segments", `Finding the brands ${band} in this audience love`, { endpoint: ENDPOINTS.insights, params: requests.brand, schema: insightsEntitiesResponse, slim: slimEntitiesBody }) : null;
    const heatmap = await qloo(env, "segments", `Mapping where ${band} in this audience cluster`, { endpoint: ENDPOINTS.insights, params: requests.heatmap, schema: heatmapResponse, slim: slimHeatmapBody });
    cells.set(segment.id, heatmap.data);
    if (artists && brands) raw = { artists: artists.data, brands: brands.data, heatmap: heatmap.data, evidence: { artists: artists.evidence.id, brands: brands.evidence.id, heatmap: heatmap.evidence.id } };
  }
  if (!raw) throw new Error(`The run measured no segment ${segmentId}.`);
  const worlds = segments.items.map((s) => ({ segmentId: s.id, cells: cells.get(s.id) ?? [] }));
  const cities = chooseSettingCities(proof, worlds, env.reference, env.inReference ? { exclude: parent } : {});
  return { measured: { proof, heatmap: parent, gap: state.audience.gap ?? EMPTY_GAP, segments, raw: new Map([[segmentId, raw]]) }, city: cities.get(segmentId) ?? null };
}

// --- The revision ------------------------------------------------------------------------------------

export interface ReviseEnv {
  store: Store;
  /** The app's Qloo client: a revision's calls replay from its cache. */
  client: QlooClient;
  /** Claude for the Culture agent and the concept writer. */
  model: LanguageModel;
  modelId: string;
  creative: Creative;
  reference: ReferenceSets;
  /** True only when the run's audience is one of the reference audiences (the recorded examples). */
  inReference: boolean;
  /**
   * The generic brief as the run's check scored it. Defaults to the stored Control, which is all a
   * live run has (one Control run); the recorded examples scored all 3 recorded runs, so their
   * replays pass those in.
   */
  control?: readonly ControlRunMap[];
  now?: () => Date;
  abortSignal?: AbortSignal;
}

export interface RevisionJob {
  runId: string;
  attempt: number;
  /** "rev-" plus 12 hex: the child run's id. */
  revisionId: string;
  segmentId: string;
  field: RevisedField;
  /** The founder's note, already through the guardrails; null when they gave none. */
  reason: string | null;
  /** Already narrowed to this world's sources (resolveExclusions). */
  exclude: readonly string[];
}

export interface RevisionOutcome {
  status: "done" | "failed";
  revision: Revision | null;
  message: string | null;
  cost: CostDelta;
}

const FIELD_WORDS: Record<RevisedField, string> = { music: "music", visual: "visual language", wardrobe: "wardrobe", setting: "setting", mood: "mood", voice: "voice", creators: "creators", world: "world" };
const SLOT_WORDS: Record<string, string> = { productRole: "product role", "voice.tone": "voice", "setting.0": "first setting", "setting.1": "second setting", "setting.2": "third setting" };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text);

/** Why a revision could not finish, in plain words. */
function failureReason(error: unknown): string {
  if (error instanceof QlooBudgetError) return `It needs fresh Qloo data beyond the ${REVISE_CAP} new calls a revision may make (the run's cached answers may have expired).`;
  return error instanceof Error ? error.message : String(error);
}

/** Builds one revision and writes it to the run's event list. A revision that fails (or runs out of time) says so in the trace instead of throwing. */
export async function runRevision(env: ReviseEnv, job: RevisionJob): Promise<RevisionOutcome> {
  const now = env.now ?? (() => new Date());
  const { store } = env;
  const cost = emptyDelta();
  const write = (inputs: RunEventInput[]) => appendRunEvents(store, job.runId, job.attempt, inputs, now);
  const step = (label: string, reason?: string): RunEventInput => ({
    type: "trace.step",
    step: { stage: "revise", kind: "decision", label: clip(label, 200), ...(reason ? { reason: clip(reason, 600) } : {}), segmentId: job.segmentId },
  });

  const state = await runState(store, job.runId, job.attempt);
  const world = state.worlds.find((w) => w.segmentId === job.segmentId);
  const segment = state.audience.segments?.items.find((s) => s.id === job.segmentId);
  const close = async (status: RevisionOutcome["status"], revision: Revision | null, message: string | null): Promise<RevisionOutcome> => {
    // The run's duration is how long the run took; a revision adds its spend, not its time.
    await addRunCost(store, job.runId, job.attempt, cost, now);
    await refreshReport(store, job.runId);
    return { status, revision, message, cost };
  };
  if (!world || !segment || !state.inputs || !world.pack || !world.brief) {
    await write([step("Could not revise this world", "The run has no finished world with that id.")]);
    return close("failed", null, "The run has no finished world with that id.");
  }

  const band = ageBandLabel(segment.bucket);
  const sourceNames = new Map([world.culture ?? [], ...world.revisions.map((r) => r.culture)].flat().flatMap((f) => f.sources.map((s) => [s.id, s.name] as const)));
  const excludedNames = job.exclude.map((id) => sourceNames.get(id) ?? id);
  await write([
    step(
      `Revising ${band}: not this ${FIELD_WORDS[job.field]}`,
      job.exclude.length
        ? `Leaving out ${job.exclude.length} of Qloo's picks the founder turned down (${clip(excludedNames.join(", "), 300)}), then writing the brief again from the rest.`
        : "Writing a different take from the same Qloo candidates.",
    ),
  ]);

  const ctx = createRunContext({ runId: job.revisionId, cap: REVISE_CAP });
  const capture = createEmitter(now);
  const stageEnv: StageEnv = { client: env.client, ctx, emit: capture.emit, reference: env.reference, inReference: env.inReference, segmentId: job.segmentId };
  const counted = countingModel(env.model, cost.claude);
  let thrown: unknown = null;
  try {
    const { measured, city } = await remeasure(stageEnv, state, job.segmentId);
    const creators = await sweepCreators(stageEnv, state.inputs.seeds).catch((error: unknown) => {
      if (!(error instanceof QlooBudgetError || error instanceof QlooHttpError || error instanceof QlooShapeError)) throw error;
      decide(stageEnv, "culture", "No creators for this revision", `Qloo's people and podcasts could not be read (${error.message}).`);
      return [];
    });
    const run: BriefRun = { runId: job.runId, kind: "live", inputs: state.inputs, stated: null, site: null, generic: null, seedEvidence: [], control: [], settings: world.pack.settings };
    const briefEnv: BriefEnv = {
      client: env.client,
      ctx,
      emitter: capture,
      reference: env.reference,
      inReference: env.inReference,
      now: () => now().getTime(),
      model: counted.model,
      modelId: env.modelId,
      creative: env.creative,
      ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}),
    };
    await runWorld(briefEnv, run, measured, job.segmentId, city, creators, env.control ?? controlMaps(state.control, segment.bucket), {
      exclude: new Set(job.exclude),
      revision: { field: job.field, reason: job.reason, rejected: rejectedWording(world, job.field) },
    });
  } catch (error) {
    // The job's deadline (the route's time limit) ends it as a failure the viewer can see.
    thrown = env.abortSignal?.aborted ? new Error("The revision ran out of time.") : error;
  }
  cost.qloo = { live: ctx.liveCalls, cached: ctx.cachedCalls };

  // Receipts the run lacks come first, so every cite in the trace and the revision lands on the ledger.
  const known = new Set(state.ledger.map((e) => e.id));
  const evidence: RunEventInput[] = ctx.ledger.entries.filter((e) => !known.has(e.id)).map((e) => ({ type: "evidence.added", evidence: e }));
  const events = capture.events;
  const traced = events.flatMap((e) => (e.type === "trace.step" ? [e.step] : []));
  const replayed = traced.filter((s) => s.kind === "tool" && s.cached).length;
  // Decisions and fresh calls show; replayed calls fold into one line.
  const steps: RunEventInput[] = traced.filter((s) => s.kind === "decision" || !s.cached).map((s) => ({ type: "trace.step", step: { ...s, stage: "revise" } }));
  steps.push(step(`Replayed ${replayed} Qloo ${replayed === 1 ? "answer" : "answers"} from the cache`, `${ctx.liveCalls} new Qloo ${ctx.liveCalls === 1 ? "call" : "calls"}, of the ${REVISE_CAP} a revision may make.`));

  const of = <T extends RunEvent["type"]>(type: T) => events.find((e): e is Extract<RunEvent, { type: T }> => e.type === type && (e as { segmentId?: string }).segmentId === job.segmentId);
  const partial = of("world.partial");
  const culture = of("world.culture");
  if (thrown || partial || !culture) {
    const reason = thrown ? failureReason(thrown) : partial ? `It stopped at ${partial.stage}: ${partial.reason}` : "The Culture agent wrote no brief.";
    await write([...evidence, ...steps, step(`Could not revise ${band}`, reason)]);
    return close("failed", null, reason);
  }

  const concepts = of("world.concepts")?.concepts ?? null;
  const packed = of("world.pack");
  const before = currentBrief(world).brief;
  const revision = revisionSchema.parse({
    id: job.revisionId,
    field: job.field,
    reason: job.reason,
    excluded: [...job.exclude],
    changes: diffBriefs(before, culture.brief),
    brief: culture.brief,
    culture: culture.culture,
    richSlots: culture.richSlots,
    concepts,
    pack: packed?.pack ?? null,
    kit: packed?.kit ?? null,
    evidenceIds: [...new Set(ctx.ledger.entries.map((e) => e.id))],
  });
  // The guard only accepts cites from the candidates, which never hold a rejected id; checked anyway.
  const leaked = revision.culture.flatMap((f) => f.sources).filter((s) => job.exclude.includes(s.id));
  if (leaked.length > 0) {
    const reason = `The new brief cites ${leaked.map((s) => s.name).join(", ")}, which the founder turned down.`;
    await write([...evidence, ...steps, step(`Could not revise ${band}`, reason)]);
    return close("failed", null, reason);
  }
  const changed = revision.changes.map((c) => `${SLOT_WORDS[c.slot] ?? c.slot}: "${clip(c.before?.text ?? "none", 80)}" to "${clip(c.after?.text ?? "none", 80)}"`);
  steps.push(
    step(
      revision.changes.length ? `Changed ${revision.changes.length} brief ${revision.changes.length === 1 ? "cue" : "cues"} for ${band}` : `The new brief for ${band} keeps every cue`,
      changed.length ? changed.slice(0, 4).join("; ") : "Qloo's remaining picks led the agent back to the same wording.",
    ),
  );
  await write([...evidence, ...steps, { type: "world.revised", segmentId: job.segmentId, revision }]);
  return close("done", revision, null);
}

// --- POST /api/revise --------------------------------------------------------------------------------

export interface ReviseRouteDeps {
  live: boolean;
  store: () => Store;
  headers: Headers;
  /** Runs the job after the response (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
  job: (job: RevisionJob) => Promise<RevisionOutcome>;
  now?: () => number;
  revisionsPerRun?: number;
  perVisitorHour?: number;
}

const reviseAnswer = (status: number, body: ReviseResponse): RouteAnswer<ReviseResponse> => ({ status, body: reviseResponseSchema.parse(body) });

/**
 * Starts a revision of one world of a finished live run. Checks the input, the founder's note
 * (the same guardrails as generated text), the per-visitor rate and the per-run limit, narrows the
 * exclusions to the world's own sources, and runs the revision after the response.
 */
export async function requestRevision(deps: ReviseRouteDeps, body: unknown): Promise<RouteAnswer<ReviseResponse>> {
  if (!deps.live) return apiError("off", "Live runs are off, so revisions do not run. The examples show what a run makes.");
  const parsed = reviseRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid", "Send a live run id, a world's segmentId, the field you turned down, and optional ids and reason.");
  const input = parsed.data;
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return apiError("failed", "No shared store is configured on this server.", 503);
  }
  const meta = await getRunMeta(store, input.runId);
  if (!meta) return apiError("not_found", "No live run with that id (runs are kept for 7 days).");
  if (meta.status !== "done") return apiError("busy", "Only a finished run can be revised.");
  const state = await runState(store, input.runId, meta.attempt);
  const world = state.worlds.find((w) => w.segmentId === input.segmentId);
  if (!world || !state.inputs) return apiError("not_found", "This run has no world with that id.");
  const { brief } = currentBrief(world);
  if (!brief || !world.pack) return apiError("invalid", "This world has no finished brief to revise.", 409);

  const reason = input.reason.trim() || null;
  if (reason) {
    const issues = checkText(reason, { names: [...reportNames({ ...state, inputs: state.inputs }), ...FAMOUS_PLACES], allowedNames: brief.allowedPlaces });
    if (issues.length > 0) return apiError("invalid", `The note breaks a guardrail: ${issues[0].message}`);
    const kids = childSetting(reason);
    if (kids) return apiError("invalid", `The note says "${kids}", which invites children into frame. Every person on screen is an adult.`);
  }

  const now = deps.now?.() ?? Date.now();
  const visitor = await visitorId(store, deps.headers);
  const hour = new Date(now).toISOString().slice(0, 13);
  const count = await store.incr(keys.rate("revise", visitor, hour), { ttlSeconds: 60 * 60 + 60 });
  if (count > (deps.perVisitorHour ?? REVISIONS_PER_VISITOR_HOUR)) return apiError("rate_limited", "That is a lot of revisions in an hour. Try again later.");

  const eventsUrl = `/api/run/${input.runId}/events`;
  const limit = deps.revisionsPerRun ?? REVISIONS_PER_RUN;
  const started = await store.incr(keys.run.revisions(input.runId), { ttlSeconds: TTL.runEvents });
  if (started > limit) return reviseAnswer(200, { status: "capped", revisionId: null, eventsUrl, message: `This run has used its ${limit} revisions.` });

  const job: RevisionJob = {
    runId: input.runId,
    attempt: meta.attempt,
    revisionId: `rev-${randomHex(6)}`,
    segmentId: world.segmentId,
    field: input.field,
    reason,
    exclude: resolveExclusions(world, input.field, input.exclude),
  };
  deps.schedule(() => deps.job(job));
  return reviseAnswer(202, { status: "revising", revisionId: job.revisionId, eventsUrl, message: null });
}
