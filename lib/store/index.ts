// The process's store. Until the Upstash adapter lands this is a MemoryStore, which is right for tests
// and local dev only: serverless instances do not share memory, so on Vercel it would split votes,
// signups and the visitor salt per instance. There it refuses, and routes that need a store fail closed.
import { MemoryStore } from "./memory";
import type { Store } from "./types";

let current: Store | null = null;

export function getStore(env: Readonly<Record<string, string | undefined>> = process.env): Store {
  if (current) return current;
  if (env.VERCEL === "1") throw new Error("No shared store is configured: the in-memory store is for local use only.");
  return (current = new MemoryStore());
}

/** Tests swap in their own store (null resets to a fresh one on the next getStore). */
export function setStore(store: Store | null): void {
  current = store;
}

export type { Store } from "./types";
