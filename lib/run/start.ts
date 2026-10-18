// The browser side of /start and of starting a run: plain validation before anything is sent, typed
// calls to the API routes, where a start lands (a live run or an example replay), and a guard so a
// double click never starts twice. Client-safe: the request schemas are light, and the response
// shapes are imported as types only.
import { DESCRIPTION_MAX, RUN_SEEDS, STATED_CUSTOMER_MAX, type IntakeRequest, type RunStartRequest } from "../api/requests";
import type { ApiError, IntakeResponse, REPLAY_REASONS, RunStartResponse, SearchResponse } from "../api/responses";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import { MAX_URL_LENGTH } from "../intake/address";

export { DESCRIPTION_MAX, RUN_SEEDS, STATED_CUSTOMER_MAX };
export const DESCRIPTION_MIN = 20;
export const DEFAULT_REGION = "United States";
export const REGION_LIMITS = { min: 2, max: 80 } as const;
/** The one format the hackathon build makes (Meta Reels and Stories, plus TikTok). */
export const DEFAULT_FORMAT = "Reels + TikTok 9:16";

export type ReplayReason = (typeof REPLAY_REASONS)[number];

// --- Validation -----------------------------------------------------------------------------------

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * A store or product link as people paste it: "porchlight.example/products/red" gets https://.
 * Only public-looking http(s) links pass; the server re-checks everything (lib/intake/address.ts).
 */
export function normalizeLink(raw: string): Checked<string> {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Paste a store or product link." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: "That doesn't look like a link. Try one like https://yourstore.com/products/name." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "Use a web link that starts with https://." };
  if (!url.hostname.includes(".") || /\s/.test(text)) return { ok: false, message: "That doesn't look like a link. Try one like https://yourstore.com/products/name." };
  const value = url.toString();
  if (value.length > MAX_URL_LENGTH) return { ok: false, message: "That link is too long. Paste the product page's own link." };
  return { ok: true, value };
}

export function checkDescription(raw: string): Checked<string> {
  const text = raw.trim();
  if (text.length < DESCRIPTION_MIN) return { ok: false, message: `Add a little more: what it is and what it costs (${DESCRIPTION_MIN} characters or more).` };
  if (text.length > DESCRIPTION_MAX) return { ok: false, message: `Keep it under ${DESCRIPTION_MAX.toLocaleString("en-US")} characters.` };
  return { ok: true, value: text };
}

export function checkRegion(raw: string): Checked<string> {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < REGION_LIMITS.min || text.length > REGION_LIMITS.max) return { ok: false, message: "Name a country, state or city, like United States or Texas." };
  return { ok: true, value: text };
}

/** Step 1's body for POST /api/intake. A blocked link keeps its URL and adds the description. */
export function intakeBody(input: { mode: "link" | "describe"; link: string; description: string; region: string }): Checked<IntakeRequest> {
  const region = checkRegion(input.region);
  if (!region.ok) return region;
  if (input.mode === "link") {
    const url = normalizeLink(input.link);
    if (!url.ok) return url;
    return { ok: true, value: { url: url.value, region: region.value } };
  }
  const description = checkDescription(input.description);
  if (!description.ok) return description;
  const url = input.link.trim() ? normalizeLink(input.link) : null;
  return { ok: true, value: { ...(url?.ok ? { url: url.value } : {}), description: description.value, region: region.value } };
}

/** Step 2's body for POST /api/run: the seeds the founder kept, by id. */
export function runBody(input: { intakeId: string; seedIds: readonly string[]; statedCustomer: string; region: string }): Checked<RunStartRequest> {
  const seedIds = [...new Set(input.seedIds)];
  if (seedIds.length < RUN_SEEDS.min) return { ok: false, message: `Keep at least ${RUN_SEEDS.min} seeds, so Qloo has a taste neighborhood to measure.` };
  if (seedIds.length > RUN_SEEDS.max) return { ok: false, message: `Use ${RUN_SEEDS.max} seeds or fewer.` };
  const stated = input.statedCustomer.trim();
  if (stated.length > STATED_CUSTOMER_MAX) return { ok: false, message: `Keep "Who do you think buys it?" under ${STATED_CUSTOMER_MAX} characters.` };
  return { ok: true, value: { intakeId: input.intakeId, seedIds, statedCustomer: stated || null, region: input.region } };
}

// --- Calling the API ------------------------------------------------------------------------------

export type ApiErrorCode = ApiError["error"]["code"];
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: ApiErrorCode | "network"; message: string };

const FALLBACK = "Something went wrong on our side. The examples still work.";
const CODES = new Set<string>(["invalid", "not_found", "rate_limited", "daily_cap", "busy", "off", "bot", "failed"]);

/** The API's error shape, read defensively: anything else becomes a plain "failed". */
export function readApiError(status: number, body: unknown): Extract<ApiResult<never>, { ok: false }> {
  const error = body && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown } }).error : undefined;
  const code = typeof error?.code === "string" && CODES.has(error.code) ? (error.code as ApiErrorCode) : "failed";
  const message = typeof error?.message === "string" && error.message.trim() ? error.message.trim().slice(0, 300) : FALLBACK;
  return { ok: false, status, code, message };
}

export async function callApi<T>(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, headers: { "content-type": "application/json", ...init.headers }, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, code: "network", message: "Stoop couldn't be reached. Check your connection and try again." };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) return readApiError(response.status, body);
  return { ok: true, data: body as T };
}

export const postIntake = (fetchImpl: typeof fetch, body: IntakeRequest, signal?: AbortSignal) =>
  callApi<IntakeResponse>(fetchImpl, "/api/intake", { method: "POST", body: JSON.stringify(body), signal });

export const postRunStart = (fetchImpl: typeof fetch, body: RunStartRequest) => callApi<RunStartResponse>(fetchImpl, "/api/run", { method: "POST", body: JSON.stringify(body) });

export const postResume = (fetchImpl: typeof fetch, runId: string) => callApi<RunStartResponse>(fetchImpl, `/api/run/${encodeURIComponent(runId)}/resume`, { method: "POST", body: "{}" });

export function searchUrl(input: { intakeId: string; q: string; type: string }): string {
  return `/api/search?${new URLSearchParams({ intakeId: input.intakeId, q: input.q.trim(), type: input.type })}`;
}

export const getSearch = (fetchImpl: typeof fetch, input: { intakeId: string; q: string; type: string }, signal?: AbortSignal) =>
  callApi<SearchResponse>(fetchImpl, searchUrl(input), { method: "GET", signal });

/**
 * One call at a time: while a call is in flight, calling again returns the same promise. The run
 * start is idempotent on the server too (the brief hash joins the run already going).
 */
export function singleFlight<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let pending: Promise<T> | null = null;
  return (...args: A) => {
    pending ??= fn(...args).finally(() => {
      pending = null;
    });
    return pending;
  };
}

// --- Where a start lands --------------------------------------------------------------------------

/** One plain line per replay reason, shown above the example's replay (never an error screen). */
export const REPLAY_NOTES: Readonly<Record<ReplayReason, string>> = {
  replay: "Live runs are off right now, so here is a recorded example run instead.",
  busy: "Two live runs are going right now, so here is a recorded example run while you wait.",
  "daily-cap": "Today's live runs are used up, so here is a recorded example run instead.",
  "rate-limited": "That is a lot of runs in an hour, so here is a recorded example run instead.",
};

export function isReplayReason(value: unknown): value is ReplayReason {
  return typeof value === "string" && Object.hasOwn(REPLAY_NOTES, value);
}

const EXAMPLE_RUN = /^example-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The example a run id replays ("example-food-hot-sauce"), if it is one of the shipped examples. */
export function exampleSlugOf(runId: string): ExampleSlug | null {
  const slug = EXAMPLE_RUN.exec(runId)?.[1];
  return EXAMPLES.find((e) => e.slug === slug)?.slug ?? null;
}

export const exampleRunHref = (slug: ExampleSlug, reason?: ReplayReason) => `/run/example-${slug}${reason ? `?why=${reason}` : ""}`;

/** Where a start goes: the live run's trace, or the example's replay with its reason. */
export function startHref(response: RunStartResponse): string {
  return response.mode === "live" ? `/run/${response.runId}` : exampleRunHref(response.slug, response.reason);
}

/** The finished report: a live run's own page, or the example's static report. */
export function reportHref(runId: string): string {
  const slug = exampleSlugOf(runId);
  return slug ? `/examples/${slug}` : `/report/${runId}`;
}

/** "Try an example" chips on /start: each opens that example's recorded run. */
export const EXAMPLE_CHIPS: readonly { slug: ExampleSlug; label: string; brandName: string }[] = EXAMPLES.map((example) => ({
  slug: example.slug,
  brandName: example.brandName,
  label: ({ "food-hot-sauce": "Hot sauce", "home-candles": "Soy candles", "pets-outfits": "Pet hats" } as const)[example.slug],
}));
