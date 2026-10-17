// The one store every lane builds on: Upstash Redis in production, MemoryStore in tests and local
// dev without keys. Values are JSON, so a value read back is always a copy. An adapter encodes and
// decodes JSON itself, so a stored "123" stays a string.
// The shared conformance suite in lib/store/contract.ts runs against every adapter.

export interface SetOptions {
  /** Expires the key after this many seconds. Without it the key keeps (or loses) no expiry: a set clears an old one. */
  ttlSeconds?: number;
  /** Writes only when the key does not exist yet (SET NX). */
  ifAbsent?: boolean;
}

export interface IncrOptions {
  /** Added to the counter (default 1). */
  by?: number;
  /** Set only when this call creates the counter, so a daily counter expires a fixed time after its first use. */
  ttlSeconds?: number;
}

export interface LeaseOptions {
  /** At most this many live leases in the set. */
  max: number;
  /** A lease expires this long after it was taken or refreshed, so a crashed run frees its slot. */
  ttlMs: number;
  /** For tests; defaults to Date.now(). */
  now?: number;
}

/** No shared store is set up where one is needed (on Vercel without Upstash keys): routes fail closed. */
export class StoreUnavailableError extends Error {
  override name = "StoreUnavailableError";
}

export interface Store {
  readonly kind: "memory" | "upstash";
  get<T>(key: string): Promise<T | null>;
  /** Returns false when `ifAbsent` was set and the key already existed (nothing written). */
  set(key: string, value: unknown, options?: SetOptions): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Deletes the key only while it still holds exactly this value (compare and delete). Atomic. */
  deleteIfEquals(key: string, value: unknown): Promise<boolean>;
  /** Sets a key's TTL from now, if the key exists. */
  expire(key: string, ttlSeconds: number): Promise<void>;
  /** Returns the new value. */
  incr(key: string, options?: IncrOptions): Promise<number>;
  /** Appends to a list and returns its new length. A TTL is refreshed on every append. Appending nothing writes nothing. */
  append(key: string, values: readonly unknown[], options?: { ttlSeconds?: number }): Promise<number>;
  /** Items from `start` to `end`, both inclusive, with negative indexes from the end (LRANGE). */
  range<T>(key: string, start: number, end: number): Promise<T[]>;
  length(key: string): Promise<number>;
  /**
   * Takes a lease (a member of a set scored by its expiry) when fewer than `max` live leases are
   * held, or refreshes one this member already holds. Expired leases are dropped first. Atomic.
   */
  leaseAcquire(key: string, member: string, options: LeaseOptions): Promise<boolean>;
  leaseRelease(key: string, member: string): Promise<void>;
  /** Live leases, after dropping expired ones. */
  leaseCount(key: string, now?: number): Promise<number>;
  /** Whether this member holds a live lease. Read only: it never refreshes one. */
  leaseHeld(key: string, member: string, now?: number): Promise<boolean>;
  /**
   * Reserves the next start slot on a shared clock, so every instance together keeps
   * `spacingMs` between starts (the global Qloo pacer: 250 ms). Returns how long to wait before
   * starting, 0 when the slot is now. Atomic.
   */
  reserveSlot(key: string, spacingMs: number, options?: { now?: number }): Promise<number>;
  /** True when the store answers (health check). */
  ping(): Promise<boolean>;
}
