// GET /api/plan/[id]/ages: "Who loves these spots" on the Community step. One Qloo demographics call
// whose signal is up to 8 of the community's top places by Qloo rank (non-chain food spots and venues
// first), so Qloo, not the manager's guess, shows which adult age bands the people who love those
// places skew toward. Only entity ids go to Qloo, never anything about a person.
//
// Qloo answers one row per signal place. Stoop reads only the age skews (gender is ignored), takes
// each band's mean across the rows, and shows every adult band plus the one or two highest positive.
// The values are relative skew indices from -1 to 1, never shares.
//
// It is an extra: it never touches the plan, and anything short of an answer (live calls off, no key,
// a fixture miss, today's cap, the month's floor, an error, a slow answer, an empty one) is a 204 with
// no body, so the card stays hidden and the page is exactly as before. Answers are kept for a week
// per set of places; the client's own cache keeps the Qloo call itself.
import type { BotCheck } from "../bot-check";
import { dailyCaps } from "../config";
import type { Evidence } from "../evidence";
import { hashOf } from "../hash";
import { MONTHLY_FLOOR } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { ENDPOINTS } from "../qloo/constants";
import { createRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import { demographicsResponse, type DemographicsRow } from "../qloo/types";
import type { ReceiptRow, ReceiptView } from "../report/view/types";
import { guard } from "../routes/guard";
import { json } from "../runtime/respond";
import { DAY_SECONDS, dayOf, keys } from "../store/keys";
import type { Store } from "../store/types";
import { planExampleSlug } from "./example-list";
import type { Place } from "./schema";
import { livePlanIdSchema, loadPlanReport } from "./store";
import { AGE_BANDS, agesLine, topLabel, type AgeBandBucket, type AgeBandView, type AgesView } from "./view/ages";

/** The most places in the signal. */
export const AGES_SIGNAL_MAX = 8;
/** Thirty looks a visitor per hour: each Community step asks once. */
export const AGES_RULE = { name: "plan-ages", limit: 30, windowSeconds: 60 * 60 } as const;
export const AGES_CACHE_TTL = 7 * DAY_SECONDS;
/** The route gives up after this long and answers 204: the card is an extra and never holds a page. */
export const AGES_TIMEOUT_MS = 6_000;
/** Bands shown as "skews": the top one or two with a positive skew. */
const TOP_BANDS = 2;

type SignalPlace = Pick<Place, "id" | "kind" | "rank" | "chain">;

/**
 * Up to 8 places by Qloo rank: non-chain food spots and venues first, then other non-chain places,
 * then chains, so a community of fast-food branches still has a signal but never leads with one.
 */
export function signalPlaces(places: readonly SignalPlace[], max = AGES_SIGNAL_MAX): string[] {
  const tier = (p: SignalPlace) => (p.chain ? 2 : p.kind === "food" || p.kind === "venue" ? 0 : 1);
  const ordered = [...places].sort((a, b) => tier(a) - tier(b) || a.rank - b.rank);
  return [...new Set(ordered.map((p) => p.id))].slice(0, max);
}

/** Each adult band's mean skew across the rows that answered for it, in age order; gender is never read. */
export function bandSkews(rows: readonly DemographicsRow[]): AgeBandView[] {
  return AGE_BANDS.flatMap((band) => {
    const values = rows.map((r) => r.age[band.bucket]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length === 0) return [];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return [{ bucket: band.bucket, label: band.label, skew: Math.round(Math.max(-1, Math.min(1, mean)) * 100) / 100 }];
  });
}

/** The one or two bands with the highest positive skew, in age order; empty when no band skews up. */
export function topBands(bands: readonly AgeBandView[], n = TOP_BANDS): AgeBandBucket[] {
  const up = [...bands].filter((b) => b.skew > 0).sort((a, b) => b.skew - a.skew).slice(0, n);
  return AGE_BANDS.filter((band) => up.some((b) => b.bucket === band.bucket)).map((band) => band.bucket);
}

function receiptOf(evidence: Evidence, top: string, spots: number): ReceiptView {
  const rows: ReceiptRow[] = [
    { label: "Signal", value: `${spots} ${spots === 1 ? "place" : "places"} near the store, by Qloo rank` },
    { label: "Read as", value: "Mean age skew across those places, from -1 to 1. A skew, not a share of anyone." },
    { label: "Endpoint", value: evidence.endpoint, mono: true },
    { label: "Asked for", value: evidence.params["filter.type"] ?? "urn:demographics", mono: true },
    {
      label: "Query",
      value: Object.entries(evidence.params)
        .map(([key, value]) => `${key}=${value}`)
        .join("&"),
      mono: true,
    },
    { label: "Served", value: `${evidence.cached ? "From cache, fetched" : "Fetched from Qloo"} ${evidence.fetchedAt.slice(0, 10)}` },
  ];
  return { cue: "Who loves these spots", title: agesLine(top), rows, calls: 1 };
}

/** The card's answer from Qloo's rows; null when no adult band skews up (nothing worth a line). */
export function agesAnswer(rows: readonly DemographicsRow[], evidence: Evidence, spots: number): AgesView | null {
  const bands = bandSkews(rows);
  const top = topLabel(topBands(bands));
  if (!top) return null;
  return { top, bands, spots, receipt: receiptOf(evidence, top, spots) };
}

/** The one demographics call, through the shared client (validated, cached, paced and counted there). */
export async function askAges(client: QlooClient, ids: readonly string[], options: { runId: string; monthRemaining?: number }): Promise<AgesView | null> {
  if (ids.length === 0) return null;
  const ctx = createRunContext({ runId: options.runId, cap: 1, monthlyFloor: MONTHLY_FLOOR, ...(options.monthRemaining === undefined ? {} : { monthRemaining: options.monthRemaining }) });
  const result = await client.request(ctx, {
    endpoint: ENDPOINTS.insights,
    params: { "filter.type": "urn:demographics", "signal.interests.entities": [...ids] },
    schema: demographicsResponse,
    label: "Measuring which adult age bands the people who love these places skew toward",
    stage: "ages",
  });
  return agesAnswer(result.data, result.evidence, ids.length);
}

export interface AgesDeps {
  live: boolean;
  store: () => Store;
  botCheck: () => BotCheck;
  client: () => QlooClient;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  timeoutMs?: number;
}

export const agesCacheKey = (ids: readonly string[]) => `plan:ages:${hashOf({ ids: [...ids].sort() })}`;

const nothing = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** Resolves to null after `ms`, so a slow Qloo answer never holds the route. */
const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.());

async function answer(request: Request, id: string, deps: AgesDeps): Promise<Response> {
  if (!deps.live) return nothing();
  const example = planExampleSlug(id);
  const live = example ? null : livePlanIdSchema.safeParse(id);
  if (!example && !live?.success) return nothing();
  const now = deps.now ?? Date.now;
  const admitted = await guard(request, { store: deps.store, botCheck: deps.botCheck, now }, AGES_RULE);
  // A refused request keeps its honest 4xx (another site, a bot, too many); a store that is down is just nothing.
  if (!admitted.ok) return admitted.response.status >= 500 ? nothing() : admitted.response;
  const { store } = admitted;

  const report = await loadPlanReport(store, example ? id : live!.data!);
  const ids = signalPlaces(report?.local.block?.places ?? []);
  if (ids.length === 0) return nothing();

  const cacheKey = agesCacheKey(ids);
  const cached = await store.get<AgesView>(cacheKey).catch(() => null);
  if (cached) return json(cached);

  const used = (await store.get<number>(keys.daily("qloo", dayOf(now())))) ?? 0;
  if (used + 1 > dailyCaps(deps.env).qloo) return nothing();
  const monthRemaining = await lastMonthRemaining(store, now());

  const view = await Promise.race([
    askAges(deps.client(), ids, { runId: `ages_${cacheKey.slice(-12)}`, ...(monthRemaining === undefined ? {} : { monthRemaining }) }),
    timeout(deps.timeoutMs ?? AGES_TIMEOUT_MS),
  ]);
  if (!view) return nothing();
  await store.set(cacheKey, view, { ttlSeconds: AGES_CACHE_TTL }).catch(() => undefined);
  return json(view);
}

/** The route's handler: an answer, an honest 4xx for a refused request, or a 204. Never a 500. */
export async function getPlanAges(request: Request, id: string, deps: AgesDeps): Promise<Response> {
  try {
    return await answer(request, id, deps);
  } catch (error) {
    // Qloo off, no key, a fixture miss, the cap: the card stays hidden. Logged by kind only.
    console.warn(`plan ages: no answer (${error instanceof Error ? error.name : "error"})`);
    return nothing();
  }
}
