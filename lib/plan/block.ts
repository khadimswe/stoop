// POST /api/plan/block: a new store's community before any plan exists, for the Community step. It runs
// only the pipeline's city and block stages (lib/plan/local.ts, never a copy of them) under STOOP_LIVE,
// with a body cap, an hourly limit per visitor, a daily limit per network for fresh lookups, today's
// Qloo cap, the month's floor and a small budget (PLAN_BUDGET's city and block rows), and caches the
// answer for a week per store point (to about 100 m) and age bands. With live runs off it points to the
// example nearest in spirit (lib/plan/runtime.ts exampleFor). Bad input answers 400 with the field it
// is about (lib/plan/input-errors.ts), never a 500.
//
// Today's Qloo cap is counted once, by the shared client, per fresh call (lib/qloo/shared.ts admit).
// Before a lookup starts, the route only checks that a whole lookup still fits under the cap; it
// reserves nothing on that counter, so a lookup costs exactly the calls it made.
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { BotCheck } from "../bot-check";
import { dailyCaps } from "../config";
import type { Evidence } from "../evidence";
import { hashOf } from "../hash";
import { BodyError, readJson } from "../http";
import { MONTHLY_FLOOR, PLAN_BUDGET } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { AGE_BUCKETS } from "../qloo/constants";
import { createRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import { guard } from "../routes/guard";
import { json } from "../runtime/respond";
import { DAY_SECONDS, dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { networkVisitorId } from "../store/visitor";
import { createPlanEmitter, type PlanEvent } from "./events";
import { InputProblem, inputErrorResponse, inputProblemOf } from "./input-errors";
import { readBlock, readCity } from "./local";
import { exampleFor } from "./runtime";
import { storeSchema, type Local, type PlanInputs } from "./schema";

const requestSchema = z.strictObject({
  store: storeSchema,
  ageBands: z.array(z.enum(AGE_BUCKETS)).min(1).max(3).default(["25_to_29", "30_to_34"]),
});

/** Ten blocks a visitor per hour; cached answers count too, so the limit stays simple. */
export const BLOCK_RULE = { name: "plan-block", limit: 10, windowSeconds: 60 * 60 } as const;
/** Fresh lookups (the ones that call Qloo) one network may make in a UTC day: an IPv4 address or an IPv6 /48. */
export const BLOCKS_PER_NETWORK_DAILY = 20;
export const BLOCK_BODY_MAX_BYTES = 4_096;
export const BLOCK_CACHE_TTL = 7 * DAY_SECONDS;
/** The most Qloo calls one lookup may make. */
export const BLOCK_CALLS = PLAN_BUDGET.planCity + PLAN_BUDGET.planLocate + PLAN_BUDGET.planBlock;

export type BlockAnswer = { mode: "live"; local: Local; ledger: Evidence[] } | { mode: "example"; slug: string; message: string };

export interface BlockDeps {
  live: boolean;
  store: () => Store;
  botCheck: () => BotCheck;
  client: () => QlooClient;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
}

/** The cache key: the store's point to 3 decimals (about 110 m by 80 m), so a pin nudged a few meters still hits. */
export function blockCacheKey(store: PlanInputs["store"], ageBands: readonly string[]): string {
  return `plan:block:${hashOf({ city: store.city, region: store.region, lat: store.point.lat.toFixed(3), lon: store.point.lon.toFixed(3), ageBands })}`;
}

export async function postBlock(request: Request, deps: BlockDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const admitted = await guard(request, { store: deps.store, botCheck: deps.botCheck, now }, BLOCK_RULE);
  if (!admitted.ok) return admitted.response;
  let body: unknown;
  try {
    body = await readJson(request, BLOCK_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyError) return inputErrorResponse(new InputProblem(error.message, null, error.status))!;
    throw error;
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return inputErrorResponse(inputProblemOf(parsed.error))!;
  const { store: shop, ageBands } = parsed.data;
  const inputs: PlanInputs = {
    store: shop,
    date: new Date(now()).toISOString().slice(0, 10),
    startTime: "12:00",
    durationMinutes: 240,
    setting: "sidewalk_table",
    budgetUsd: 50,
    offers: [],
    ageBands,
  };
  const example = (message: string): Response => json({ mode: "example", slug: exampleFor(inputs), message } satisfies BlockAnswer);
  if (!deps.live) return example("Live maps are off right now. Here's an example community to look around.");

  const { store } = admitted;
  const cacheKey = blockCacheKey(shop, ageBands);
  const cached = await store.get<BlockAnswer>(cacheKey);
  if (cached) return json(cached);

  // Only fresh lookups spend Qloo calls, so only they count against the network's day.
  const network = await networkVisitorId(store, request.headers);
  if ((await store.incr(keys.rate("plan-block-daily", network, dayOf(now())), { ttlSeconds: TTL.daily })) > BLOCKS_PER_NETWORK_DAILY) {
    return example("That is a lot of new stores from here today. Here's an example community; yours works again tomorrow.");
  }
  // A lookup starts only when all of it still fits under today's cap (read only: the client counts each call).
  const used = (await store.get<number>(keys.daily("qloo", dayOf(now())))) ?? 0;
  if (used + BLOCK_CALLS > dailyCaps(deps.env).qloo) return example("Stoop has used today's Qloo calls. Here's an example community; your own works tomorrow.");

  const events: PlanEvent[] = [];
  const emit = createPlanEmitter();
  const monthRemaining = await lastMonthRemaining(store, now());
  const ctx = createRunContext({
    runId: `block_${cacheKey.slice(-12)}`,
    cap: BLOCK_CALLS,
    monthlyFloor: MONTHLY_FLOOR,
    rowCaps: { planCity: PLAN_BUDGET.planCity, planLocate: PLAN_BUDGET.planLocate, planBlock: PLAN_BUDGET.planBlock },
    ...(monthRemaining === undefined ? {} : { monthRemaining }),
  });
  // City and block never call Claude; the model is required by the type only.
  const env = { client: deps.client(), ctx, sink: { emit: (input: Parameters<typeof emit>[0]) => (events.push(emit(input)), events.at(-1)!) }, model: null as unknown as LanguageModel, abortSignal: request.signal };
  const city = await readCity(env, inputs);
  const block = await readBlock(env, inputs);
  const answer: BlockAnswer = {
    mode: "live",
    local: { city: city.taste, block, gaps: events.flatMap((e) => (e.type === "local.gap" ? [e.text] : [])) },
    ledger: events.flatMap((e) => (e.type === "evidence.added" ? [e.evidence] : [])),
  };
  // A lookup missing its city or its block (a Qloo error, today's cap) is not kept, so the next one tries again.
  if (city.taste && block) await store.set(cacheKey, answer, { ttlSeconds: BLOCK_CACHE_TTL }).catch(() => undefined);
  return json(answer);
}
