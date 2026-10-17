import { sha256 } from "../hash";
import type { Endpoint } from "./constants";

export type ParamScalar = string | number | boolean;
export type ParamValue = ParamScalar | readonly ParamScalar[];
export type QlooParams = Readonly<Record<string, ParamValue | undefined>>;

function serializeValue(value: ParamValue): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(",");
  return String(value);
}

/** Params as sorted string pairs, with undefined values dropped and arrays comma-joined. */
export function canonicalEntries(params: QlooParams): [string, string][] {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined)
    .sort()
    .map((key) => [key, serializeValue(params[key] as ParamValue)]);
}

/** Stable query string: same params in any key order produce the same string. */
export function canonicalQuery(params: QlooParams): string {
  return canonicalEntries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** Params as a plain string record, safe to store in evidence (the key travels in a header, never here). */
export function paramsRecord(params: QlooParams): Record<string, string> {
  return Object.fromEntries(canonicalEntries(params));
}

export function cacheKey(endpoint: Endpoint, params: QlooParams): string {
  return sha256(`${endpoint}?${canonicalQuery(params)}`);
}
