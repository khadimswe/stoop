// Typed name resolution, shared by the Gate 2 data check and the intake's suggested seeds. One
// /search call per name (types always set), and the hit counts only when its name matches what was
// asked for (lib/qloo/match.ts), because /search returns its best guess for any query. Both callers
// build the request here, so they send identical params and replay the same recordings.
import type { z } from "zod";
import type { QlooClient } from "./client";
import { ENDPOINTS, type Endpoint, type EntityType } from "./constants";
import type { RunContext } from "./context";
import { matchResult, normalizeName, type MatchKind } from "./match";
import type { QlooParams } from "./params";
import { searchResponse } from "./types";

/** One Qloo request with a stable id. The id is the receipt key and the recipe id. */
export interface PlannedRequest {
  id: string;
  endpoint: Endpoint;
  params: QlooParams;
  note?: string;
}

/** Reads one planned request and returns its typed data. A 404 returns `notFound` when given. */
export type Lookup = <T>(request: PlannedRequest, schema: z.ZodType<T>, notFound?: T) => Promise<T>;

/** Reads a planned request through the real client (fixtures mode: a miss throws, nothing goes live). */
export function clientLookup(client: QlooClient, ctx: RunContext): Lookup {
  return async (request, schema, notFound) =>
    (await client.request(ctx, { endpoint: request.endpoint, params: request.params, schema, label: request.id, onNotFound: notFound })).data;
}

/** Results per search. Recorded Gate 2 searches all used 5 (fixtures/pool-resolve.json). */
export const SEARCH_TAKE = 5;

export const searchId = (name: string, type: EntityType) => `search--${normalizeName(name).replace(/ /g, "-")}--${type}`;

export function searchRequest(name: string, type: EntityType, note?: string): PlannedRequest {
  return {
    id: searchId(name, type),
    endpoint: ENDPOINTS.search,
    params: { query: name, types: [`urn:entity:${type}`], take: SEARCH_TAKE },
    ...(note === undefined ? {} : { note }),
  };
}

export interface ResolvedEntity {
  query: string;
  type: EntityType;
  /** Id of the /search request behind the answer (the receipt). */
  request: string;
  /** Set when a search hit's name matched the query; otherwise the name was dropped. */
  entity?: { id: string; name: string; popularity: number | null; match: MatchKind };
}

/** Resolves one name of a known type. A miss (no hit, or no hit with a matching name) leaves `entity` unset. */
export async function resolveEntity(name: string, type: EntityType, lookup: Lookup): Promise<ResolvedEntity> {
  const request = searchRequest(name, type);
  const results = await lookup(request, searchResponse, []);
  const hit = matchResult(name, results);
  return {
    query: name,
    type,
    request: request.id,
    entity: hit ? { id: hit.result.id, name: hit.result.name, popularity: hit.result.popularity, match: hit.match } : undefined,
  };
}
