// Record mode, for scripts only (the app never records): requests that are already recorded replay
// from fixtures/, and the ones that are not go live and are written to a new fixture, slimmed the
// way every Stoop call is. Culture's agent decides its own probes, so they cannot be planned as a
// recipe ahead of time like Gate 2's and Gate 3's recordings; this records them as they happen, and
// the next run replays them strictly. The run's own cap still bounds every live call.
import { writeFile } from "node:fs/promises";
import type { CacheEntry, QlooCache } from "./cache";
import type { Endpoint } from "./constants";
import { encodeFixture, FixtureCache, FIXTURES_DIR, type Fixture, type RecordedRequest } from "./fixtures";
import { QLOO_BASE_URL } from "./constants";

/** Splits the client's readable "endpoint?query" back into the fixture's endpoint and string params. */
export function splitRequest(request: string): { endpoint: string; params: Record<string, string> } {
  const at = request.indexOf("?");
  const endpoint = at === -1 ? request : request.slice(0, at);
  const params = Object.fromEntries(new URLSearchParams(at === -1 ? "" : request.slice(at + 1)));
  return { endpoint, params };
}

export class RecordingCache implements QlooCache {
  private readonly replay: FixtureCache;
  private readonly pending = new Map<string, string>();
  /** Answers recorded in this run, served again if the run repeats a request. */
  private readonly fresh = new Map<string, CacheEntry>();
  private readonly recorded: RecordedRequest[] = [];

  constructor(fixtures: readonly Fixture[]) {
    this.replay = new FixtureCache(fixtures);
  }

  /** How many live answers this run recorded. */
  get size(): number {
    return this.recorded.length;
  }

  async get(key: string, request?: string): Promise<CacheEntry | undefined> {
    const hit = this.fresh.get(key) ?? (await this.replay.get(key));
    if (!hit && request) this.pending.set(key, request);
    return hit;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const request = this.pending.get(key);
    if (!request) return;
    this.pending.delete(key);
    this.fresh.set(key, entry);
    const { endpoint, params } = splitRequest(request);
    this.recorded.push({
      id: `${endpoint.replace(/\W+/g, "-").replace(/^-|-$/g, "")}--${key.slice(0, 12)}`,
      endpoint: endpoint as Endpoint,
      params,
      query: request.slice(request.indexOf("?") + 1),
      status: entry.status,
      body: entry.body ?? undefined,
    });
  }

  /**
   * Writes what was recorded as fixtures/<name>.json (gzipped when large). Refuses when a secret
   * appears in the output. Returns the file, or null when nothing new was recorded.
   */
  async save(name: string, description: string, options: { now?: Date; secret?: string; dir?: string } = {}): Promise<string | null> {
    if (this.recorded.length === 0) return null;
    const fixture: Fixture = {
      name,
      description,
      recordedAt: (options.now ?? new Date()).toISOString(),
      baseUrl: QLOO_BASE_URL,
      probe: false,
      requests: [...this.recorded].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const { file, text, data } = encodeFixture(name, fixture, options.dir ?? FIXTURES_DIR);
    if (options.secret && text.includes(options.secret)) throw new Error(`Refusing to write ${file}: a secret appeared in the recording.`);
    await writeFile(file, data);
    return file;
  }
}
