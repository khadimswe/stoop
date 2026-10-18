// The production Qloo cache: request hash to response in the shared store, 7 days
// (the cache TTL), so every instance and every resumed run reuses what was already paid for. Large answers
// (heatmaps run to about 2 MB of JSON) are stored gzipped, about a quarter of the size; one
// still too big for a single store value is simply not cached.
import { gunzipSync, gzipSync } from "node:zlib";
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import type { CacheEntry } from "./cache";
import type { QlooCache } from "./cache";

/** Entries above this many characters of JSON are compressed. */
export const COMPRESS_OVER = 128_000;
/** A value this large is past what one store write should carry; it is not cached. */
export const MAX_STORED = 900_000;

type Stored = CacheEntry | { gz: string };

export class StoreQlooCache implements QlooCache {
  constructor(private readonly store: Store) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const stored = await this.store.get<Stored>(keys.qloo.cache(key));
    if (!stored) return undefined;
    return "gz" in stored ? (JSON.parse(gunzipSync(Buffer.from(stored.gz, "base64")).toString("utf8")) as CacheEntry) : stored;
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    const json = JSON.stringify(entry);
    const value: Stored = json.length > COMPRESS_OVER ? { gz: gzipSync(json).toString("base64") } : entry;
    if ("gz" in value && value.gz.length > MAX_STORED) return;
    await this.store.set(keys.qloo.cache(key), value, { ttlSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) });
  }
}
