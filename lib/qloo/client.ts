// The only door to Qloo. Every request is validated, cached, paced, budgeted, retried when it is
// safe to retry, shape-checked, and returned with an Evidence receipt.
//
// This module is pure (no `server-only`) so tests and scripts can use it. The app gets its
// singleton from `./server`; the fixture recorder script builds its own.
import type { z } from "zod";
import type { Evidence } from "../evidence";
import type { CacheEntry, QlooCache } from "./cache";
import {
  BACKOFF_BASE_MS,
  DEFAULT_TTL_MS,
  MAX_RETRIES,
  MAX_RETRY_WAIT_MS,
  QLOO_BASE_URL,
  RATE_LIMIT_HEADERS,
  REQUEST_TIMEOUT_MS,
  RETRYABLE_STATUSES,
  type Endpoint,
} from "./constants";
import type { BudgetRow } from "./budget";
import type { RunContext } from "./context";
import { QlooBudgetError, QlooConfigError, QlooHttpError, QlooShapeError, redact } from "./errors";
import { createLimiter, realSleep, type Limiter } from "./limiter";
import { cacheKey, canonicalQuery, paramsRecord, type QlooParams } from "./params";
import { validateParams } from "./schemas";

export interface QlooClientOptions {
  apiKey?: string;
  cache?: QlooCache;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limiter?: Limiter;
  baseUrl?: string;
  ttlMs?: number;
  maxRetries?: number;
  /** Covers the whole request, including reading the body. */
  timeoutMs?: number;
}

export interface QlooRequest<T> {
  endpoint: Endpoint;
  params: QlooParams;
  /** Response schema from `./types`. A mismatch throws QlooShapeError instead of passing bad data on. */
  schema: z.ZodType<T>;
  /** Human label for the trace, e.g. "Resolving Olipop to a brand entity". */
  label?: string;
  stage?: string;
  /**
   * The budget row this call spends (lib/qloo/budget.ts). Refused once the run's cap for that row is
   * reached; a run with row caps refuses any call without a known row, so nothing slips past the table.
   */
  budgetRow?: BudgetRow;
  /** Trims large bodies (heatmaps) before they are cached. */
  slim?: (body: unknown) => unknown;
  /** Returned when Qloo answers 404 (search with no match). Without it, a 404 throws. */
  onNotFound?: T;
}

export interface QlooResult<T> {
  data: T;
  evidence: Evidence;
}

export interface RawResponse {
  status: number;
  body: unknown;
  /** Only the rate-limit headers; everything else is dropped. */
  headers: Record<string, string>;
  query: string;
  durationMs: number;
  fetchedAt: number;
}

export interface QlooClient {
  request<T>(ctx: RunContext, req: QlooRequest<T>): Promise<QlooResult<T>>;
  /** For the fixture recorder: one live call that returns any status, with no cache and no run budget. */
  raw(endpoint: Endpoint, params: QlooParams, options?: { validate?: boolean }): Promise<RawResponse>;
}

const MISSING_KEY = "QLOO_API_KEY missing";

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function pickHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of RATE_LIMIT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) kept[name] = value;
  }
  return kept;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function createQlooClient(options: QlooClientOptions = {}): QlooClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const limiter = options.limiter ?? createLimiter({ now, sleep });
  const baseUrl = options.baseUrl ?? QLOO_BASE_URL;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const apiKey = options.apiKey?.trim() || undefined;
  const cache = options.cache;

  const snippet = (text: string) => redact(text, apiKey).replace(/\s+/g, " ").trim().slice(0, 300);

  function backoff(attempt: number): number {
    return BACKOFF_BASE_MS * 2 ** attempt + Math.floor(random() * 250);
  }

  function retryDelay(attempt: number, headers: Headers): number {
    const retryAfter = Number(headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    // Seconds until the per-second window resets: Qloo sends "1" with a limit of 5 per second
    // (fixtures/smoke.json). Anything larger falls back to backoff.
    const reset = Number(headers.get("x-second-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0 && reset <= 2) return reset * 1000;
    return backoff(attempt);
  }

  /** One HTTP attempt. The timeout covers headers and body, so a stalled body cannot hang a run. */
  async function fetchOnce(url: string, key: string): Promise<{ response: Response; text: string }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    const work = (async () => {
      const response = await fetchImpl(url, {
        headers: { "X-Api-Key": key, Accept: "application/json" },
        // A cross-origin redirect would forward X-Api-Key to another host, so redirects are refused.
        redirect: "error",
        signal: controller.signal,
      });
      return { response, text: await response.text() };
    })();
    work.catch(() => {}); // the timeout may win; the loser must not become an unhandled rejection
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One logical request with pacing and retries. Returns the final response for any status.
   * `mayRetry` runs before every retry: it charges the retry to a budget, or returns false to stop
   * retrying, in which case the last response (or network error) is returned as is.
   */
  async function send(endpoint: Endpoint, query: string, mayRetry: () => boolean): Promise<RawResponse> {
    if (!apiKey) throw new QlooConfigError(MISSING_KEY);
    const url = `${baseUrl}${endpoint}${query ? `?${query}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      await limiter.pace();
      const started = now();
      let result: { response: Response; text: string };
      try {
        result = await fetchOnce(url, apiKey);
      } catch (error) {
        if (attempt < maxRetries && mayRetry()) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new QlooHttpError(endpoint, 0, snippet(describe(error)));
      }
      const { response, text } = result;
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        const delay = retryDelay(attempt, response.headers);
        // A wait longer than the cap (e.g. monthly quota spent) or an exhausted budget fails fast,
        // so the caller can fall back to cache and a "partial data" badge.
        if (delay <= MAX_RETRY_WAIT_MS && mayRetry()) {
          await sleep(delay);
          continue;
        }
      }
      return {
        status: response.status,
        body: parseBody(text),
        headers: pickHeaders(response.headers),
        query,
        durationMs: now() - started,
        fetchedAt: now(),
      };
    }
  }

  function budgetProblem(ctx: RunContext, row?: string): string | null {
    if (ctx.liveCalls >= ctx.cap) return `Run ${ctx.runId} reached its cap of ${ctx.cap} live Qloo calls`;
    const rowCap = row === undefined ? undefined : ctx.rowCaps[row];
    if (row !== undefined && rowCap !== undefined && (ctx.rowCalls[row] ?? 0) >= rowCap) {
      return `Run ${ctx.runId} spent its ${rowCap} ${row} calls`;
    }
    if (ctx.monthRemaining !== undefined && ctx.monthRemaining < ctx.monthlyFloor) {
      return `Qloo monthly quota is below the floor (${ctx.monthRemaining} calls left)`;
    }
    return null;
  }

  function assertBudget(ctx: RunContext, row?: string): void {
    const problem = budgetProblem(ctx, row);
    if (problem) throw new QlooBudgetError(problem);
  }

  function charge(ctx: RunContext, stage: string | undefined, row: string | undefined): void {
    ctx.liveCalls++;
    if (stage) ctx.stageCalls[stage] = (ctx.stageCalls[stage] ?? 0) + 1;
    if (row) ctx.rowCalls[row] = (ctx.rowCalls[row] ?? 0) + 1;
  }

  /** With row caps, retries may only use the calls the table leaves unplanned. */
  function retrySlackSpent(ctx: RunContext): boolean {
    const planned = Object.values(ctx.rowCaps).reduce((sum, calls) => sum + calls, 0);
    return planned > 0 && ctx.retryCalls >= Math.max(0, ctx.cap - planned);
  }

  /** In a run with row caps, every call names a row the table knows. */
  function assertRow(ctx: RunContext, row: string | undefined): void {
    if (Object.keys(ctx.rowCaps).length === 0) return;
    if (row === undefined) throw new QlooBudgetError(`Run ${ctx.runId} has a budget table, and this call names no budget row`);
    if (!Object.hasOwn(ctx.rowCaps, row)) throw new QlooBudgetError(`Run ${ctx.runId} has no budget row "${row}"`);
  }

  /** Turns a cached or fresh entry into typed data, or throws. */
  function parse<T>(req: QlooRequest<T>, entry: CacheEntry): T {
    if (entry.status === 404) {
      if (req.onNotFound === undefined) throw new QlooHttpError(req.endpoint, 404, "");
      return req.onNotFound;
    }
    const parsed = req.schema.safeParse(entry.body);
    if (!parsed.success) {
      throw new QlooShapeError(
        req.endpoint,
        parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      );
    }
    return parsed.data;
  }

  function record<T>(
    ctx: RunContext,
    req: QlooRequest<T>,
    entry: CacheEntry,
    meta: { cached: boolean; shared?: boolean; durationMs: number },
  ): Evidence {
    return ctx.ledger.add({
      endpoint: req.endpoint,
      params: paramsRecord(req.params),
      label: req.label,
      stage: req.stage,
      status: entry.status,
      cached: meta.cached,
      ...(meta.shared ? { shared: true } : {}),
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      durationMs: meta.durationMs,
    });
  }

  async function request<T>(ctx: RunContext, req: QlooRequest<T>): Promise<QlooResult<T>> {
    validateParams(req.endpoint, req.params);
    assertRow(ctx, req.budgetRow);
    const key = cacheKey(req.endpoint, req.params);

    const hit = await cache?.get(key, `${req.endpoint}?${canonicalQuery(req.params)}`);
    if (hit) {
      const data = parse(req, hit);
      ctx.cachedCalls++;
      return { data, evidence: record(ctx, req, hit, { cached: true, durationMs: 0 }) };
    }

    // Every live call needs the key; check it before anything is charged.
    if (!apiKey) throw new QlooConfigError(MISSING_KEY);

    // Identical requests already in flight in the same run share one call. Sharing is per run, so one
    // run's budget can never fail or charge another run. The first attempt is reserved synchronously
    // (parallel calls cannot overshoot the cap) and each retry must fit in the budget too.
    const flightKey = `${ctx.runId}:${key}`;
    const joining = limiter.inFlight(flightKey);
    if (!joining) {
      assertBudget(ctx, req.budgetRow);
      charge(ctx, req.stage, req.budgetRow);
    }
    const fetched = await limiter.run(flightKey, async () => {
      const response = await send(req.endpoint, canonicalQuery(req.params), () => {
        // Retries draw on the run cap's slack (the cap minus the planned rows), not on the row, so one
        // 503 never costs a world one of its planned calls, and retries can never eat a planned call.
        if (budgetProblem(ctx) || retrySlackSpent(ctx)) return false;
        charge(ctx, req.stage, undefined);
        ctx.retryCalls++;
        return true;
      });

      const remaining = response.headers["x-month-ratelimit-remaining"];
      if (remaining !== undefined && Number.isFinite(Number(remaining))) ctx.monthRemaining = Number(remaining);

      const deterministicMiss = response.status === 404 && req.onNotFound !== undefined;
      if (!deterministicMiss && (response.status < 200 || response.status >= 300)) {
        const text = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "");
        throw new QlooHttpError(req.endpoint, response.status, snippet(text));
      }

      let body: unknown = null;
      if (!deterministicMiss) body = req.slim ? req.slim(response.body) : response.body;
      const entry: CacheEntry = { status: response.status, body, fetchedAt: response.fetchedAt };

      // Parse before caching, so a bad body (gateway HTML, unexpected shape) is never cached. The
      // cache is written inside the shared task, so no identical request slips in before it lands.
      parse(req, entry);
      try {
        await cache?.set(key, entry, ttlMs);
      } catch (error) {
        // The call is already paid for: keep the data and only warn (never log bodies or keys).
        console.warn(`Qloo cache write failed for ${req.endpoint}: ${snippet(describe(error))}`);
      }
      return { entry, durationMs: response.durationMs };
    });

    const data = parse(req, fetched.entry);
    if (joining) ctx.cachedCalls++;
    const evidence = record(ctx, req, fetched.entry, {
      cached: joining,
      shared: joining,
      durationMs: joining ? 0 : fetched.durationMs,
    });
    return { data, evidence };
  }

  async function raw(endpoint: Endpoint, params: QlooParams, rawOptions: { validate?: boolean } = {}) {
    if (rawOptions.validate !== false) validateParams(endpoint, params);
    return send(endpoint, canonicalQuery(params), () => true);
  }

  return { request, raw };
}
