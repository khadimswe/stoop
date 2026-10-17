// The production Qloo cache: request hash to response in the shared store, 7 days (CLAUDE.md
// section 2), so every instance and every resumed run reuses what was already paid for.
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import type { CacheEntry, QlooCache } from "./cache";

export class StoreQlooCache implements QlooCache {
  constructor(private readonly store: Store) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    return (await this.store.get<CacheEntry>(keys.qloo.cache(key))) ?? undefined;
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    await this.store.set(keys.qloo.cache(key), entry, { ttlSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) });
  }
}
