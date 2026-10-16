// One guarded GET for the page reader: a product page, or its Shopify .json sibling, from a link a
// stranger typed. Built on node:http, node:https, node:dns and node:net only, so nothing between the
// check and the connect resolves the name again:
//   - every hop (the first link and each redirect, at most 3) passes checkUrl in ./address.ts, and
//     every address DNS returns for its host must pass the policy, not just the first one
//   - the socket is pinned to the checked address through a custom lookup, while the hostname stays
//     in the Host header and the TLS SNI, so a DNS rebind cannot swap in another address
//   - https never redirects down to http; storefront ports only (80, 443, 8080, 8443); 5 s for the
//     whole fetch; a 1 MB body cap; HTML, XHTML or JSON only; uncompressed bodies only; no cookies
//     sent or kept; a plain identifying User-Agent
// Network problems never throw: every failure is a typed result the reader can explain in one line.
// PageBudget holds the "one page per run" rule: the product page and its .json sibling, once each.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type net from "node:net";
import { checkUrl, publicAddress, type AddressPolicy, type Family, type UrlCheck } from "./address";

export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_REDIRECTS = 3;
export const USER_AGENT = "StoopPageReader/1.0";
export const PAGE_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "application/json"] as const;
export type PageContentType = (typeof PAGE_CONTENT_TYPES)[number];

export const FETCH_FAILURES = [
  "bad-url",
  "blocked-address",
  "dns-failed",
  "timeout",
  "too-large",
  "unsupported-content-type",
  "http-error",
  "too-many-redirects",
  "insecure-redirect",
  "network-error",
  "over-budget",
] as const;
export type FetchFailure = (typeof FETCH_FAILURES)[number];

export interface PageFetchOk {
  ok: true;
  /** The link as asked for. */
  url: string;
  /** Where the body came from, after redirects. */
  finalUrl: string;
  status: number;
  contentType: PageContentType;
  body: string;
  redirects: number;
}

export interface PageFetchFailed {
  ok: false;
  url: string;
  reason: FetchFailure;
  /** One plain sentence for the trace. */
  detail: string;
  status?: number;
}

export type PageFetch = PageFetchOk | PageFetchFailed;

export interface ResolvedAddress {
  address: string;
  family: Family;
}

/** Every address a hostname resolves to. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The system resolver (getaddrinfo, like a normal connect), asking for every address at once. */
export const systemResolver: Resolver = async (hostname) =>
  (await dns.promises.lookup(hostname, { all: true })).map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));

export interface GuardedFetchOptions {
  /** Which addresses may be reached. Only tests pass anything but the default (to reach 127.0.0.1). */
  policy?: AddressPolicy;
  /** Which ports may be reached. Only tests pass anything but ALLOWED_PORTS (a local server's port). */
  ports?: readonly number[];
  resolve?: Resolver;
  /** Covers the whole fetch: DNS, every redirect and the body. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Narrows the accepted content types, e.g. JSON only for the Shopify sibling. */
  accept?: readonly PageContentType[];
  /** Cancels the fetch, e.g. at the run deadline. Reported as a timeout. */
  signal?: AbortSignal;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type Hop =
  | { kind: "redirect"; status: number; location: string }
  | { kind: "done"; status: number; contentType: PageContentType; body: string }
  | { kind: "failed"; reason: FetchFailure; detail: string; status?: number };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

/**
 * Where a redirect leads, or why it is refused. The target then goes through checkUrl like any link,
 * so a target that names a host is returned as the server wrote it: the URL parser would turn
 * "http://0x7f000001/" into "http://127.0.0.1/" and hide the non-canonical spelling from the check.
 */
export function nextHop(from: URL, location: string): { ok: true; url: string } | { ok: false; reason: FetchFailure; detail: string } {
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return { ok: false, reason: "bad-url", detail: "The site redirected to an invalid link." };
  }
  if (from.protocol === "https:" && next.protocol === "http:") {
    return { ok: false, reason: "insecure-redirect", detail: `The site redirected from https to plain http (${next.host}).` };
  }
  next.hash = "";
  const cleaned = location.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
  const absolute = /^[a-z][a-z0-9+.-]*:[/\\]{2}/i.test(cleaned) ? cleaned : /^[/\\]{2}/.test(cleaned) ? `${from.protocol}${cleaned}` : null;
  // Same target either way; only the spelling of the host differs. A path-only target keeps the checked host.
  const asWritten = absolute !== null && withoutHash(absolute)?.href === next.href ? absolute : next.href;
  return { ok: true, url: asWritten };
}

const mediaType = (header: string | undefined) => (header ?? "").split(";")[0].trim().toLowerCase();
const charsetOf = (header: string | undefined) => /charset\s*=\s*"?([^";\s]+)/i.exec(header ?? "")?.[1] ?? "utf-8";

function decodeBody(body: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** A lookup that answers with the already-checked address, whatever it is asked. One socket per request. */
function pinnedLookup(pinned: ResolvedAddress): net.LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  };
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

type CheckedUrl = Extract<UrlCheck, { ok: true }>;

/** The one address this hop connects to. Every resolved address must pass, so a mixed answer is refused. */
async function pinAddress(
  checked: CheckedUrl,
  resolve: Resolver,
  policy: AddressPolicy,
  signal: AbortSignal,
): Promise<ResolvedAddress | { reason: FetchFailure; detail: string }> {
  if (checked.ip) return checked.ip;
  let found: ResolvedAddress[];
  try {
    found = await untilAborted(resolve(checked.host), signal);
  } catch {
    return { reason: "dns-failed", detail: `Stoop could not find ${checked.host}.` };
  }
  if (found.length === 0) return { reason: "dns-failed", detail: `Stoop could not find ${checked.host}.` };
  for (const entry of found) {
    const verdict = policy(entry.address);
    if (!verdict.allowed) return { reason: "blocked-address", detail: `${checked.host} points to a blocked address: ${verdict.detail}.` };
  }
  return found[0];
}

interface HopSettings {
  signal: AbortSignal;
  maxBytes: number;
  accept: readonly PageContentType[];
}

function requestOnce(checked: CheckedUrl, pinned: ResolvedAddress, settings: HopSettings): Promise<Hop> {
  const { url } = checked;
  const secure = url.protocol === "https:";
  return new Promise<Hop>((resolve) => {
    let settled = false;
    const settle = (hop: Hop) => {
      if (settled) return;
      settled = true;
      resolve(hop);
    };
    const lost = (error?: unknown): Hop => ({
      kind: "failed",
      reason: settings.signal.aborted ? "timeout" : "network-error",
      detail: error ? `Stoop could not read the page (${describe(error)}).` : "The connection closed before the page finished.",
    });
    const tooLarge: Hop = { kind: "failed", reason: "too-large", detail: `The page is larger than ${Math.round(settings.maxBytes / 1000)} KB.` };

    const options: https.RequestOptions = {
      method: "GET",
      protocol: url.protocol,
      // A numeric host is used as is; a name keeps its spelling for the Host header and SNI and is
      // resolved only by the pinned lookup.
      hostname: checked.ip ? checked.ip.address : checked.host,
      port: url.port ? Number(url.port) : secure ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: url.host,
        "User-Agent": USER_AGENT,
        Accept: `${settings.accept.join(",")};q=0.9`,
        "Accept-Encoding": "identity",
      },
      agent: false,
      signal: settings.signal,
      ...(checked.ip ? {} : { lookup: pinnedLookup(pinned) }),
      // SNI never carries the trailing dot of a fully qualified name (RFC 6066).
      ...(secure && !checked.ip ? { servername: checked.host.replace(/\.$/, "") } : {}),
    };

    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const stop = (hop: Hop) => {
        settle(hop);
        res.destroy();
      };
      if (REDIRECT_STATUSES.has(status)) {
        const location = res.headers.location;
        stop(location ? { kind: "redirect", status, location } : { kind: "failed", reason: "http-error", detail: `The site answered HTTP ${status} without a target.`, status });
        return;
      }
      if (status < 200 || status > 299) {
        stop({ kind: "failed", reason: "http-error", detail: `The site answered HTTP ${status}.`, status });
        return;
      }
      const type = mediaType(res.headers["content-type"]);
      if (!(settings.accept as readonly string[]).includes(type)) {
        stop({ kind: "failed", reason: "unsupported-content-type", detail: `The link returned ${type || "no content type"}, not a web page.`, status });
        return;
      }
      const encoding = (res.headers["content-encoding"] ?? "").trim().toLowerCase();
      if (encoding && encoding !== "identity") {
        stop({ kind: "failed", reason: "unsupported-content-type", detail: `The site sent a compressed (${encoding}) body.`, status });
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > settings.maxBytes) {
        stop(tooLarge);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > settings.maxBytes) stop(tooLarge);
        else chunks.push(chunk);
      });
      res.on("end", () =>
        settle({ kind: "done", status, contentType: type as PageContentType, body: decodeBody(Buffer.concat(chunks), charsetOf(res.headers["content-type"])) }),
      );
      res.on("error", (error) => settle(lost(error)));
      res.on("close", () => {
        if (!res.complete) settle(lost());
      });
    };

    let req: http.ClientRequest;
    try {
      req = (secure ? https : http).request(options, onResponse);
    } catch (error) {
      settle(lost(error));
      return;
    }
    req.on("error", (error) => settle(lost(error)));
    req.end();
  });
}

/**
 * Fetches one public page. Follows up to `maxRedirects` redirects, re-checking each target exactly
 * like the first link. Resolves with the body or a typed failure; never rejects.
 */
export async function guardedFetch(input: string, options: GuardedFetchOptions = {}): Promise<PageFetch> {
  const policy = options.policy ?? publicAddress;
  const resolve = options.resolve ?? systemResolver;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const settings = { maxBytes: options.maxBytes ?? MAX_BODY_BYTES, accept: options.accept ?? PAGE_CONTENT_TYPES };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();

  const failed = (reason: FetchFailure, detail: string, status?: number): PageFetchFailed => ({
    ok: false,
    url: input,
    reason,
    detail,
    ...(status === undefined ? {} : { status }),
  });
  const stopped = () => failed("timeout", timedOut ? `The site did not answer within ${timeoutMs / 1000} s.` : "The read was cancelled.");

  try {
    let current = input;
    for (let redirects = 0; ; redirects++) {
      if (controller.signal.aborted) return stopped();
      const checked = checkUrl(current, policy, options.ports);
      if (!checked.ok) return failed(checked.reason, checked.detail);
      const pinned = await pinAddress(checked, resolve, policy, controller.signal);
      if ("reason" in pinned) return controller.signal.aborted ? stopped() : failed(pinned.reason, pinned.detail);
      const hop = await requestOnce(checked, pinned, { ...settings, signal: controller.signal });
      if (hop.kind === "failed") return controller.signal.aborted ? stopped() : failed(hop.reason, hop.detail, hop.status);
      if (hop.kind === "redirect") {
        if (redirects >= maxRedirects) return failed("too-many-redirects", `The link redirected more than ${maxRedirects} times.`, hop.status);
        const next = nextHop(checked.url, hop.location);
        if (!next.ok) return failed(next.reason, next.detail, hop.status);
        current = next.url;
        continue;
      }
      const finalUrl = new URL(checked.url);
      finalUrl.hash = "";
      return { ok: true, url: input, finalUrl: finalUrl.href, status: hop.status, contentType: hop.contentType, body: hop.body, redirects };
    }
  } catch (error) {
    return controller.signal.aborted ? stopped() : failed("network-error", `Stoop could not read the page (${describe(error)}).`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

// --- One page per run ---------------------------------------------------------------------------

const PRODUCT_PATH = /\/products\/([^/]+?)\/?$/;
const DATA_SUFFIX = /\.(?:json|js|xml|atom|oembed)$/i;

function withoutHash(input: string): URL | null {
  try {
    const url = new URL(input);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/**
 * The only fetches a run may make: the product page itself, and for a `/products/<handle>` link its
 * Shopify product JSON on the same origin (the same path plus ".json", or `/products/<handle>.json`).
 * Each is allowed once, so a page cannot make the reader crawl.
 */
export class PageBudget {
  readonly pageUrl: string | null;
  /** The Shopify product JSON to try first: the same path plus ".json". Null for other paths. */
  readonly jsonUrl: string | null;
  private readonly jsonForms: ReadonlySet<string>;
  private pageUsed = false;
  private jsonUsed = false;

  constructor(productUrl: string) {
    const url = withoutHash(productUrl);
    this.pageUrl = url?.href ?? null;
    const handle = url ? PRODUCT_PATH.exec(url.pathname)?.[1] : undefined;
    if (url && handle && !DATA_SUFFIX.test(handle)) {
      const samePath = `${url.origin}${url.pathname.replace(/\/$/, "")}.json`;
      this.jsonUrl = samePath;
      this.jsonForms = new Set([samePath, `${url.origin}/products/${handle}.json`]);
    } else {
      this.jsonUrl = null;
      this.jsonForms = new Set();
    }
  }

  /** Takes one allowed fetch, or says why not. */
  claim(input: string): { ok: true } | { ok: false; detail: string } {
    const href = withoutHash(input)?.href;
    if (href && href === this.pageUrl) {
      if (this.pageUsed) return { ok: false, detail: "The product page was already read in this run." };
      this.pageUsed = true;
      return { ok: true };
    }
    if (href && this.jsonForms.has(href)) {
      if (this.jsonUsed) return { ok: false, detail: "The product JSON was already read in this run." };
      this.jsonUsed = true;
      return { ok: true };
    }
    return { ok: false, detail: "A run reads only the product page and its Shopify product JSON." };
  }

  /** guardedFetch, behind the budget. */
  async fetch(input: string, options?: GuardedFetchOptions): Promise<PageFetch> {
    const claim = this.claim(input);
    if (!claim.ok) return { ok: false, url: input, reason: "over-budget", detail: claim.detail };
    return guardedFetch(input, options);
  }
}
