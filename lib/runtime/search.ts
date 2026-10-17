// Qloo autocomplete for a "you" seed on /start. Results are tied to the intake, so a run accepts only
// seeds Qloo resolved: the founder picks one of Qloo's own entities, never a free name.
import { searchRequestSchema, type SearchRequest } from "../api/requests";
import type { SearchResponse } from "../api/responses";
import { isLive } from "../config";
import { MONTHLY_FLOOR } from "../qloo/budget";
import { createRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import type { QlooClient } from "../qloo/client";
import { searchEntities } from "../qloo/search";
import type { Seed } from "../report/schema";
import { keys, TTL } from "../store/keys";
import { ApiFailure, hourOf } from "./errors";
import { loadIntake } from "./record";
import type { RequestContext } from "./types";

/** Searches one intake may make, and one visitor per hour. */
export const SEARCHES_PER_INTAKE = 12;
export const SEARCHES_PER_HOUR = 60;
const RESULTS = 5;

export interface SearchDeps {
  client: QlooClient;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
}

export async function searchSeeds(deps: SearchDeps, raw: SearchRequest, ctx: RequestContext): Promise<SearchResponse> {
  if (!isLive(deps.env ?? process.env)) throw new ApiFailure("off", "Live runs are off right now. The examples show a full run.", 503);
  const input = searchRequestSchema.parse(raw);
  const now = deps.now ?? Date.now;
  const intake = await loadIntake(ctx.store, input.intakeId);
  if (!intake) throw new ApiFailure("not_found", "That product read has expired. Start again from your link.", 404);
  if ((await ctx.store.incr(keys.rate("search", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 })) > SEARCHES_PER_HOUR) {
    throw new ApiFailure("rate_limited", "Too many searches in an hour. Try again a little later.", 429);
  }
  if ((await ctx.store.incr(keys.intakeSearches(input.intakeId), { ttlSeconds: TTL.intake })) > SEARCHES_PER_INTAKE) {
    throw new ApiFailure("rate_limited", "That is the most searches for one product. Pick from what you found.", 429);
  }

  const type = `urn:entity:${input.type}` as const;
  const monthRemaining = await lastMonthRemaining(ctx.store, now());
  const qctx = createRunContext({ runId: `search-${input.intakeId}`, cap: 1, ...(monthRemaining !== undefined ? { monthlyFloor: MONTHLY_FLOOR, monthRemaining } : {}) });
  const result = await searchEntities(deps.client, qctx, { query: input.q, types: [type], take: RESULTS }, { label: `Searching Qloo for "${input.q}"`, stage: "intake" });
  const results: Seed[] = result.data.slice(0, RESULTS).map((entity) => ({
    ref: { kind: "entity", id: entity.id, name: entity.name, type: entity.type ?? type },
    origin: "you",
    evidenceIds: [result.evidence.id],
  }));
  if (results.length) await ctx.store.append(keys.intakeSearched(input.intakeId), [{ seeds: results, evidence: result.evidence }], { ttlSeconds: TTL.intake });
  return { results, evidence: [result.evidence] };
}
