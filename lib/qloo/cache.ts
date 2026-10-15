import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** A cached Qloo response. Only successful (2xx) and deterministic 404 responses are cached. */
export interface CacheEntry {
  status: number;
  body: unknown;
  /** When Qloo actually served this response (ms since epoch). Shown as "recorded" in evidence. */
  fetchedAt: number;
}

export interface QlooCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry, ttlMs: number): Promise<void>;
}

type Clock = () => number;

/** In-process cache. Used in tests and as the production fallback until Upstash lands (Gate 5). */
export class MemoryCache implements QlooCache {
  private readonly store = new Map<string, { entry: CacheEntry; expiresAt: number }>();

  constructor(private readonly now: Clock = Date.now) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.entry;
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    this.store.set(key, { entry, expiresAt: this.now() + ttlMs });
  }
}

/**
 * Disk cache for local dev and scripts, so dev-server restarts and hot reloads do not spend quota.
 * Lives in `.cache/qloo` (gitignored). Not for production: Vercel's filesystem is read-only.
 */
export class FileCache implements QlooCache {
  constructor(
    private readonly dir: string,
    private readonly now: Clock = Date.now,
  ) {}

  private file(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const saved = JSON.parse(await readFile(this.file(key), "utf8")) as { entry: CacheEntry; expiresAt: number };
      if (saved.expiresAt <= this.now()) {
        await rm(this.file(key), { force: true });
        return undefined;
      }
      return saved.entry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), JSON.stringify({ entry, expiresAt: this.now() + ttlMs }));
  }
}
