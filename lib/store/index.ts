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
  // Vercel's Upstash integration names the same two values KV_REST_API_URL and KV_REST_API_TOKEN.
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (url && token) return (current = new UpstashStore({ url, token }));
  if (env.VERCEL === "1") throw new StoreUnavailableError("No shared store is configured: the in-memory store is for local use only.");
  return (current = new MemoryStore());
}

/** Tests swap in their own store (null resets to a fresh one on the next getStore). */
export function setStore(store: Store | null): void {
  current = store;
}

export type { Store } from "./types";
