// The process's store. Until the Upstash adapter lands this is always a MemoryStore, which is right
// for tests and local dev only: serverless instances do not share memory.
import { MemoryStore } from "./memory";
import type { Store } from "./types";

let current: Store | null = null;

export function getStore(): Store {
  return (current ??= new MemoryStore());
}

/** Tests swap in their own store (null resets to a fresh one on the next getStore). */
export function setStore(store: Store | null): void {
  current = store;
}

export type { Store } from "./types";
