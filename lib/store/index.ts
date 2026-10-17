// The process's store: Upstash when its REST URL and token are set, else a MemoryStore for tests and
// local dev. Serverless instances do not share memory, so on Vercel the memory store would split
// votes, signups and the visitor salt per instance: there it refuses, and routes fail closed.
import { MemoryStore } from "./memory";
import { StoreUnavailableError, type Store } from "./types";
import { UpstashStore } from "./upstash";

type Env = Readonly<Record<string, string | undefined>>;

let current: Store | null = null;

export function getStore(env: Env = process.env): Store {
  if (current) return current;
  const pair = upstashPair(env);
  if (pair) return (current = new UpstashStore(pair));
  if (env.VERCEL === "1") throw new StoreUnavailableError("No shared store is configured: the in-memory store is for local use only.");
  return (current = new MemoryStore());
}

/**
 * The Upstash REST URL and token, as a pair under one naming scheme: UPSTASH_REDIS_REST_* first, then
 * the names Vercel's Upstash integration sets (KV_REST_API_URL and KV_REST_API_TOKEN). Never a URL
 * from one scheme with the token from the other.
 */
export function upstashPair(env: Env): { url: string; token: string } | null {
  for (const [urlName, tokenName] of [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ] as const) {
    const url = env[urlName]?.trim();
    const token = env[tokenName]?.trim();
    if (url && token) return { url, token };
  }
  return null;
}

/** Tests swap in their own store (null resets to a fresh one on the next getStore). */
export function setStore(store: Store | null): void {
  current = store;
}

export type { Store } from "./types";
