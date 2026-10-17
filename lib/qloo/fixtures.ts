// Recorded Qloo responses: the file format, reading and writing, and the replay cache behind
// QLOO_MODE=fixtures. Fixtures are real responses only (see fixtures/README.md). Files over
// GZIP_ABOVE_BYTES are stored as `<name>.json.gz` (heatmaps hold about 10,000 cells); smaller ones
// stay readable JSON. This module is pure Node (no `server-only`) so scripts and tests can use it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CacheEntry, QlooCache } from "./cache";
import { QlooFixtureMissError } from "./errors";
import { cacheKey } from "./params";
import type { Endpoint } from "./constants";

export interface RecordedRequest {
  id: string;
  note?: string;
  endpoint: string;
  /** Params as sent, serialized (arrays comma-joined), so `cacheKey(endpoint, params)` matches the live key. */
  params: Record<string, string>;
  query?: string;
  /** 0 when the request failed on the network after retries (then `error` says why). */
  status: number;
  headers?: Record<string, string>;
  durationMs?: number;
  body?: unknown;
  error?: string;
}

export interface Fixture {
  name: string;
  description?: string;
  recordedAt: string;
  baseUrl: string;
  /** True when params were not validated (testing what Qloo does with params Stoop does not allow). */
  probe: boolean;
  requests: RecordedRequest[];
}

export const FIXTURES_DIR = "fixtures";
const EM_DASH_PATTERN = new RegExp(String.fromCharCode(0x2014), "g");
export const GZIP_ABOVE_BYTES = 1_000_000;

const JSON_EXT = ".json";
const GZ_EXT = ".json.gz";

/** The existing file for a fixture name, plain or gzipped, or undefined. */
export function findFixture(name: string, dir = FIXTURES_DIR): string | undefined {
  for (const ext of [JSON_EXT, GZ_EXT]) {
    const file = path.join(dir, `${name}${ext}`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Serializes a fixture: pretty JSON when small, gzipped compact JSON when large. `text` is the JSON
 * before compression, so callers can check it (for example, that no API key appears) before writing.
 */
export function encodeFixture(name: string, value: unknown, dir = FIXTURES_DIR): { file: string; text: string; data: string | Buffer } {
  // Qloo's own text can hold U+2014; it is written as an escape (same JSON, no raw character in the repo).
  const escaped = (json: string) => json.replace(EM_DASH_PATTERN, "\\u2014");
  const pretty = escaped(`${JSON.stringify(value, null, 2)}\n`);
  if (pretty.length <= GZIP_ABOVE_BYTES) return { file: path.join(dir, `${name}${JSON_EXT}`), text: pretty, data: pretty };
  const compact = escaped(`${JSON.stringify(value)}\n`);
  return { file: path.join(dir, `${name}${GZ_EXT}`), text: compact, data: gzipSync(compact, { level: 9 }) };
}

export function readFixtureFile(file: string): Fixture {
  const buffer = readFileSync(file);
  const text = file.endsWith(GZ_EXT) ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  return JSON.parse(text) as Fixture;
}

const loaded = new Map<string, { key: string; fixtures: Fixture[] }>();

/**
 * Every fixture at the top level of `dir` (recipes/ and raw/ are not fixtures). Parsed once per
 * process (the Gate 2 set is about 45 MB of JSON) and parsed again only when the file list changes.
 * Callers must not mutate the result.
 */
export function loadFixtures(dir = FIXTURES_DIR): Fixture[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(JSON_EXT) || file.endsWith(GZ_EXT))
    .sort();
  const key = files.join("\n");
  const hit = loaded.get(dir);
  if (hit && hit.key === key) return hit.fixtures;
  const fixtures = files.map((file) => readFixtureFile(path.join(dir, file)));
  loaded.set(dir, { key, fixtures });
  return fixtures;
}

/** The request with this id in a fixture. Throws when it is missing, so analysis never runs on a gap. */
export function recorded(fixture: Fixture, id: string): RecordedRequest {
  const request = fixture.requests.find((r) => r.id === id);
  if (!request) throw new Error(`Fixture ${fixture.name} has no request "${id}".`);
  return request;
}

/**
 * Read-only cache over recorded fixtures, keyed exactly like live requests. Strict mode throws on a
 * miss instead of letting the client go live, which is what QLOO_MODE=fixtures needs. Probe fixtures
 * are left out: their params were never validated, so the app could not have sent them.
 */
export class FixtureCache implements QlooCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    fixtures: readonly Fixture[],
    private readonly options: { strict?: boolean } = {},
  ) {
    // Newest recording wins when the same request was recorded twice.
    const ordered = [...fixtures].filter((f) => !f.probe).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    for (const fixture of ordered) {
      const fetchedAt = Date.parse(fixture.recordedAt);
      for (const req of fixture.requests) {
        const replayable = (req.status >= 200 && req.status < 300) || req.status === 404;
        if (!replayable || req.body === undefined) continue;
        this.entries.set(cacheKey(req.endpoint as Endpoint, req.params), {
          status: req.status,
          body: req.status === 404 ? null : req.body,
          fetchedAt,
        });
      }
    }
  }

  static fromDir(dir = FIXTURES_DIR, options: { strict?: boolean } = {}): FixtureCache {
    return new FixtureCache(loadFixtures(dir), options);
  }

  get size(): number {
    return this.entries.size;
  }

  async get(key: string, request?: string): Promise<CacheEntry | undefined> {
    const hit = this.entries.get(key);
    if (!hit && this.options.strict) throw new QlooFixtureMissError(request ?? `cache key ${key}`);
    return hit;
  }

  async set(): Promise<void> {
    // Read-only: replays never write.
  }
}
