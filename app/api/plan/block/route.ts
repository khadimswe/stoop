// POST /api/plan/block: a new store's block before any plan exists, for the Block step. It runs only
// the pipeline's city and block stages (lib/plan/local.ts, never a copy of them) under STOOP_LIVE,
// the daily Qloo cap, a per-visitor limit and a small budget (PLAN_BUDGET's city and block rows), and
// caches the answer for a week per store point and age bands. With live runs off it points to the
// example block nearest in spirit (lib/plan/runtime.ts exampleFor).
import type { LanguageModel } from "ai";
import { z } from "zod";
import { getBotCheck } from "@/lib/bot-check";
import { dailyCaps, isLive } from "@/lib/config";
import type { Evidence } from "@/lib/evidence";
import { hashOf } from "@/lib/hash";
import { MONTHLY_FLOOR, PLAN_BUDGET } from "@/lib/qloo/budget";
import { createRunContext } from "@/lib/qloo/context";
import { getQlooClient } from "@/lib/qloo/server";
import { AGE_BUCKETS } from "@/lib/qloo/constants";
import { createPlanEmitter, type PlanEvent } from "@/lib/plan/events";
import { readBlock, readCity } from "@/lib/plan/local";
import { exampleFor } from "@/lib/plan/runtime";
import { storeSchema, type Local, type PlanInputs } from "@/lib/plan/schema";
import { failSafe, guard } from "@/lib/routes/guard";
import { json } from "@/lib/runtime/respond";
import { getStore } from "@/lib/store";
import { keys } from "@/lib/store/keys";

export const maxDuration = 60;

const requestSchema = z.strictObject({
  store: storeSchema,
  ageBands: z.array(z.enum(AGE_BUCKETS)).min(1).max(3).default(["25_to_29", "30_to_34"]),
});

/** Ten fresh blocks a visitor per hour; cached answers count too, so the limit stays simple. */
const BLOCK_RULE = { name: "plan-block", limit: 10, windowSeconds: 60 * 60 } as const;
const CACHE_TTL = 7 * 24 * 60 * 60;
const BLOCK_CALLS = PLAN_BUDGET.planCity + PLAN_BUDGET.planLocate + PLAN_BUDGET.planBlock;

export type BlockAnswer =
  | { mode: "live"; local: Local; ledger: Evidence[] }
  | { mode: "example"; slug: string; message: string };

export function POST(request: Request) {
  return failSafe("plan block", async () => {
    const admitted = await guard(request, { store: getStore, botCheck: getBotCheck }, BLOCK_RULE);
    if (!admitted.ok) return admitted.response;
    const { store: shop, ageBands } = requestSchema.parse(await request.json());
    const inputs: PlanInputs = {
      store: shop,
      date: new Date().toISOString().slice(0, 10),
      startTime: "12:00",
      durationMinutes: 240,
      setting: "sidewalk_table",
      budgetUsd: 50,
      offers: [],
      ageBands,
    };
    const example = (message: string): Response => json({ mode: "example", slug: exampleFor(inputs), message } satisfies BlockAnswer);
    if (!isLive()) return example("Live maps are off right now. Here's an example community to look around.");

    const { store } = admitted;
    const cacheKey = `plan:block:${hashOf({ city: shop.city, region: shop.region, lat: shop.point.lat.toFixed(4), lon: shop.point.lon.toFixed(4), ageBands })}`;
    const cached = await store.get<BlockAnswer>(cacheKey);
    if (cached) return json(cached);

    const daily = keys.daily("qloo");
    if ((await store.incr(daily, { by: BLOCK_CALLS, ttlSeconds: 36 * 60 * 60 })) > dailyCaps().qloo) {
      await store.incr(daily, { by: -BLOCK_CALLS }).catch(() => undefined);
      return example("Stoop has used today's Qloo calls. Here's an example community; your own works tomorrow.");
    }

    const events: PlanEvent[] = [];
    const emit = createPlanEmitter();
    const ctx = createRunContext({
      runId: `block_${cacheKey.slice(-12)}`,
      cap: BLOCK_CALLS,
      monthlyFloor: MONTHLY_FLOOR,
      rowCaps: { planCity: PLAN_BUDGET.planCity, planLocate: PLAN_BUDGET.planLocate, planBlock: PLAN_BUDGET.planBlock },
    });
    // City and block never call Claude; the model is required by the type only.
    const env = { client: getQlooClient(), ctx, sink: { emit: (input: Parameters<typeof emit>[0]) => (events.push(emit(input)), events.at(-1)!) }, model: null as unknown as LanguageModel, abortSignal: request.signal };
    const city = await readCity(env, inputs);
    const block = await readBlock(env, inputs);
    const answer: BlockAnswer = {
      mode: "live",
      local: { city: city.taste, block, gaps: events.flatMap((e) => (e.type === "local.gap" ? [e.text] : [])) },
      ledger: events.flatMap((e) => (e.type === "evidence.added" ? [e.evidence] : [])),
    };
    await store.set(cacheKey, answer, { ttlSeconds: CACHE_TTL }).catch(() => undefined);
    return json(answer);
  });
}
