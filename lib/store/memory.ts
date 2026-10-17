// In-memory Store for tests and local dev without Upstash keys. One process only: it is never the
// production store, because serverless instances do not share memory.
import type { IncrOptions, LeaseOptions, SetOptions, Store } from "./types";

type Entry = { kind: "value"; value: string } | { kind: "counter"; value: number } | { kind: "list"; items: string[] } | { kind: "leases"; members: Map<string, number> };

const copy = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("The store keeps JSON values only.");
  return json;
};

/** LRANGE indexes: negative counts from the end, both ends inclusive, out of range clamps. */
function slice<T>(items: readonly T[], start: number, end: number): T[] {
  const from = start < 0 ? Math.max(items.length + start, 0) : start;
  const to = end < 0 ? items.length + end : Math.min(end, items.length - 1);
  return from > to ? [] : items.slice(from, to + 1);
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, { entry: Entry; expiresAt: number | null }>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  private live(key: string): Entry | null {
    const found = this.entries.get(key);
    if (!found) return null;
    if (found.expiresAt !== null && found.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return found.entry;
  }

  private expiresAt(key: string): number | null {
    return this.entries.get(key)?.expiresAt ?? null;
  }

  private put(key: string, entry: Entry, expiresAt: number | null): void {
    this.entries.set(key, { entry, expiresAt });
  }

  private ofKind<K extends Entry["kind"]>(key: string, kind: K): Extract<Entry, { kind: K }> | null {
    const entry = this.live(key);
    if (entry && entry.kind !== kind) throw new Error(`Key ${key} holds a ${entry.kind}, not a ${kind}.`);
    return entry as Extract<Entry, { kind: K }> | null;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.live(key);
    if (!entry) return null;
    if (entry.kind === "value") return JSON.parse(entry.value) as T;
    if (entry.kind === "counter") return entry.value as T;
    throw new Error(`Key ${key} holds a ${entry.kind}, not a value.`);
  }

  async set(key: string, value: unknown, options: SetOptions = {}): Promise<boolean> {
    if (options.ifAbsent && this.live(key)) return false;
    this.put(key, { kind: "value", value: copy(value) }, options.ttlSeconds ? this.now() + options.ttlSeconds * 1000 : null);
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.live(key);
    if (entry) this.put(key, entry, this.now() + ttlSeconds * 1000);
  }

  async incr(key: string, options: IncrOptions = {}): Promise<number> {
    const by = options.by ?? 1;
    if (!Number.isInteger(by)) throw new Error("incr takes whole numbers only.");
    const entry = this.live(key);
    if (entry && entry.kind !== "counter") throw new Error(`Key ${key} holds a ${entry.kind}, not a counter.`);
    const value = (entry?.value ?? 0) + by;
    const expiresAt = entry ? this.expiresAt(key) : options.ttlSeconds ? this.now() + options.ttlSeconds * 1000 : null;
    this.put(key, { kind: "counter", value }, expiresAt);
    return value;
  }

  async append(key: string, values: readonly unknown[], options: { ttlSeconds?: number } = {}): Promise<number> {
    const list = this.ofKind(key, "list");
    if (values.length === 0) return list?.items.length ?? 0;
    const items = [...(list?.items ?? []), ...values.map(copy)];
    const expiresAt = options.ttlSeconds ? this.now() + options.ttlSeconds * 1000 : list ? this.expiresAt(key) : null;
    this.put(key, { kind: "list", items }, expiresAt);
    return items.length;
  }

  async range<T>(key: string, start: number, end: number): Promise<T[]> {
    return slice(this.ofKind(key, "list")?.items ?? [], start, end).map((item) => JSON.parse(item) as T);
  }

  async length(key: string): Promise<number> {
    return this.ofKind(key, "list")?.items.length ?? 0;
  }

  private leases(key: string, now: number): Map<string, number> {
    const members = new Map(this.ofKind(key, "leases")?.members ?? []);
    for (const [member, expiresAt] of members) if (expiresAt <= now) members.delete(member);
    return members;
  }

  async leaseAcquire(key: string, member: string, options: LeaseOptions): Promise<boolean> {
    const now = options.now ?? this.now();
    const members = this.leases(key, now);
    if (!members.has(member) && members.size >= options.max) {
      this.put(key, { kind: "leases", members }, null);
      return false;
    }
    members.set(member, now + options.ttlMs);
    this.put(key, { kind: "leases", members }, null);
    return true;
  }

  async leaseRelease(key: string, member: string): Promise<void> {
    const members = this.leases(key, this.now());
    members.delete(member);
    this.put(key, { kind: "leases", members }, null);
  }

  async leaseCount(key: string, now?: number): Promise<number> {
    return this.leases(key, now ?? this.now()).size;
  }

  async reserveSlot(key: string, spacingMs: number, options: { now?: number } = {}): Promise<number> {
    const now = options.now ?? this.now();
    const next = this.ofKind(key, "counter")?.value ?? 0;
    const slot = Math.max(next, now);
    // The key outlives its last slot a little, then disappears.
    this.put(key, { kind: "counter", value: slot + spacingMs }, slot + spacingMs + 60_000);
    return slot - now;
  }

  async leaseHeld(key: string, member: string, now?: number): Promise<boolean> {
    return this.leases(key, now ?? this.now()).has(member);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
