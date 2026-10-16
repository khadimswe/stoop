// Reads one product page into a PageRead: the product, price, category, images, the page copy, and
// whether reading was blocked. Order of sources: the Shopify product JSON (`/products/<handle>.json`),
// then a JSON-LD Product, then Open Graph and meta tags, then the visible text. At most two fetches
// (the JSON sibling and the page), both through one PageBudget, so a run reads one page.
//
// The page is untrusted data. Its text is returned as plain strings for Claude to read inside a
// quoted block (./site-reading.ts), never as instructions, and every string is run through the
// guardrails: long dashes become commas, and anything else a guardrail catches is flagged (or, for
// tags and image alt text, dropped) in `flags`. A blocked or unreadable page never fails: the result
// says why in one line, keeps whatever was read, and the caller falls back to the description.
// Whether a product photo shows a person is not decided here; the render gate does that.
import { z } from "zod";
import { checkText, stripEmDashes, type GuardRule } from "../guardrails";
import { PageBudget, type FetchFailure, type GuardedFetchOptions, type PageContentType, type PageFetch } from "./guarded-fetch";
import { capText, collapse, findProductNode, firstHeading, jsonLdBlocks, metaTags, plainText, titleOf, visibleText } from "./html";
import { checkUrl, MAX_URL_LENGTH } from "./address";

export const COPY_MAX = 6_000;
const NAME_MAX = 200;
const SHORT_MAX = 100;
const DESCRIPTION_MAX = 2_000;
const TAG_MAX = 60;
const MAX_TAGS = 20;
const MAX_IMAGES = 8;
const ALT_MAX = 200;
/** Visible text shorter than this, with no product data, means a JavaScript-only page. */
export const MIN_READABLE_COPY = 200;

export const PAGE_SOURCES = ["shopify", "jsonld", "meta", "text"] as const;
export type PageSource = (typeof PAGE_SOURCES)[number];

const GUARD_RULES = ["minor", "ethnicity", "likeness", "named-reference", "health-claim", "fake-proof", "em-dash"] as const satisfies readonly GuardRule[];

const text = (max: number) => z.string().trim().min(1).max(max);

export const productReadSchema = z.strictObject({
  name: text(NAME_MAX),
  brand: text(SHORT_MAX).optional(),
  /** As the page states it, digits and a decimal point only, e.g. "14.00". */
  price: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  category: text(SHORT_MAX).optional(),
  description: text(DESCRIPTION_MAX).optional(),
  tags: z.array(text(TAG_MAX)).max(MAX_TAGS),
  images: z.array(z.strictObject({ url: z.url({ protocol: /^https$/ }), alt: text(ALT_MAX).optional() })).max(MAX_IMAGES),
});
export type ProductRead = z.infer<typeof productReadSchema>;

/** A guardrail hit on page text: flagged (kept, so the caller decides) or dropped. */
export const pageFlagSchema = z.strictObject({
  path: z.string(),
  rule: z.enum(GUARD_RULES),
  match: z.string(),
  action: z.enum(["flagged", "dropped"]),
});
export type PageFlag = z.infer<typeof pageFlagSchema>;

export const fetchLogSchema = z.strictObject({
  url: z.string().max(MAX_URL_LENGTH),
  ok: z.boolean(),
  status: z.number().int().optional(),
  reason: z.string().optional(),
});

export const pageReadSchema = z.strictObject({
  /** The link as given. */
  url: z.string().max(MAX_URL_LENGTH),
  /** Where the product was read from, after redirects. */
  finalUrl: z.string().max(MAX_URL_LENGTH).optional(),
  /** Which source gave the product. Null when nothing readable was found. */
  source: z.enum(PAGE_SOURCES).nullable(),
  product: productReadSchema.nullable(),
  /** The page's visible copy (for Shopify, the product title and description). */
  copy: z.string().max(COPY_MAX),
  /** Set when the page could not be read properly; the caller falls back to the description. */
  blocked: z.strictObject({ reason: z.string().min(1) }).optional(),
  flags: z.array(pageFlagSchema),
  /** Every fetch made, for the trace. */
  fetches: z.array(fetchLogSchema),
});
export type PageRead = z.infer<typeof pageReadSchema>;

/** A product as read, before cleaning and guardrails. */
export interface RawProduct {
  name?: string;
  brand?: string;
  price?: string;
  currency?: string;
  category?: string;
  description?: string;
  tags: string[];
  images: { url: string; alt?: string }[];
}

interface RawRead {
  source: PageSource | null;
  product: RawProduct | null;
  copy: string;
  blocked?: { reason: string };
}

// --- Small readers -------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** How deep textOf and firstOffer follow arrays, names and variants. Real pages need 2. */
const MAX_JSON_LD_DEPTH = 3;
const MAX_JSON_LD_ITEMS = 10;

/** A JSON-LD value as text: a string, a number, the first string of an array, or an object's name (bounded depth). */
function textOf(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return plainText(value) || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (depth >= MAX_JSON_LD_DEPTH) return undefined;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_JSON_LD_ITEMS)) {
      const found = textOf(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) return textOf(value.name, depth + 1);
  return undefined;
}

export function normalizePrice(value: unknown): string | undefined {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/,(?=\d{3}\b)/g, "") : "";
  return /^\d+(?:\.\d+)?$/.test(raw) ? raw : undefined;
}

const normalizeCurrency = (value: unknown) => (typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : undefined);

/**
 * Only https images on a public host and a storefront port, resolved against the page;
 * protocol-relative links become https. A later step may fetch them, so a link to a private or
 * metadata address (https://169.254.169.254/, https://localhost:6379/) is dropped here.
 */
function httpsImage(src: unknown, base: string): string | undefined {
  if (typeof src !== "string" || !src.trim()) return undefined;
  const trimmed = src.trim();
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed, base);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" && checkUrl(url.href).ok ? url.href : undefined;
}

function addImage(images: RawProduct["images"], src: unknown, base: string, alt?: unknown) {
  const url = httpsImage(src, base);
  if (!url || images.some((image) => image.url === url) || images.length >= MAX_IMAGES) return;
  const altText = typeof alt === "string" ? collapse(alt) : undefined;
  images.push(altText ? { url, alt: altText } : { url });
}

const splitTags = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []).flatMap((tag) => (typeof tag === "string" && tag.trim() ? [collapse(tag)] : []));

// --- Shopify -------------------------------------------------------------------------------------

const shopifyJsonSchema = z.looseObject({
  product: z.looseObject({
    title: z.string(),
    body_html: z.string().nullish(),
    vendor: z.string().nullish(),
    product_type: z.string().nullish(),
    tags: z.union([z.string(), z.array(z.string())]).nullish(),
    variants: z.array(z.looseObject({ price: z.union([z.string(), z.number()]).nullish(), price_currency: z.string().nullish() })).nullish(),
    images: z.array(z.looseObject({ src: z.string(), alt: z.string().nullish() })).nullish(),
    image: z.looseObject({ src: z.string(), alt: z.string().nullish() }).nullish(),
  }),
});

/** A Shopify `/products/<handle>.json` body as a product, or null when it is not one. */
export function readShopifyJson(body: string, base: string): RawProduct | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = shopifyJsonSchema.safeParse(json);
  if (!parsed.success) return null;
  const { product } = parsed.data;
  const images: RawProduct["images"] = [];
  for (const image of product.images ?? []) addImage(images, image.src, base, image.alt);
  if (product.image) addImage(images, product.image.src, base, product.image.alt);
  const variant = product.variants?.[0];
  return {
    name: collapse(product.title),
    brand: product.vendor ? collapse(product.vendor) : undefined,
    price: normalizePrice(variant?.price),
    currency: normalizeCurrency(variant?.price_currency),
    category: product.product_type ? collapse(product.product_type) : undefined,
    description: product.body_html ? visibleText(product.body_html) : undefined,
    tags: splitTags(product.tags),
    images,
  };
}

// --- HTML ----------------------------------------------------------------------------------------

function firstOffer(node: Record<string, unknown>, depth = 0): Record<string, unknown> | undefined {
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (isRecord(offers)) return offers;
  if (depth >= MAX_JSON_LD_DEPTH) return undefined;
  const variants = Array.isArray(node.hasVariant) ? node.hasVariant.slice(0, MAX_JSON_LD_ITEMS) : [];
  for (const variant of variants) if (isRecord(variant)) return firstOffer(variant, depth + 1);
  return undefined;
}

function productFromJsonLd(node: Record<string, unknown>, base: string): RawProduct | null {
  const name = textOf(node.name);
  if (!name) return null;
  const offer = firstOffer(node);
  const spec = isRecord(offer?.priceSpecification) ? offer.priceSpecification : undefined;
  const images: RawProduct["images"] = [];
  for (const image of Array.isArray(node.image) ? node.image : [node.image]) {
    if (isRecord(image)) addImage(images, image.url ?? image.contentUrl, base, image.caption ?? image.name);
    else addImage(images, image, base);
  }
  return {
    name,
    brand: textOf(node.brand) ?? textOf(node.manufacturer),
    price: normalizePrice(offer?.price ?? offer?.lowPrice ?? spec?.price),
    currency: normalizeCurrency(offer?.priceCurrency ?? spec?.priceCurrency),
    category: textOf(node.category),
    description: textOf(node.description),
    tags: splitTags(node.keywords),
    images,
  };
}

function productFromMeta(meta: Record<string, string[]>, base: string): RawProduct | null {
  const first = (...keys: string[]) => keys.map((key) => meta[key]?.[0]).find(Boolean);
  const name = first("og:title", "twitter:title");
  if (!name) return null;
  const images: RawProduct["images"] = [];
  const alt = first("og:image:alt", "twitter:image:alt");
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image"]) for (const src of meta[key] ?? []) addImage(images, src, base, alt);
  return {
    name,
    brand: first("product:brand", "og:brand", "og:site_name"),
    price: normalizePrice(first("product:price:amount", "og:price:amount")),
    currency: normalizeCurrency(first("product:price:currency", "og:price:currency")),
    category: first("product:category"),
    description: first("og:description", "description", "twitter:description"),
    tags: [],
    images,
  };
}

/** Fills the fields one source left empty from the next. */
function merge(primary: RawProduct, ...fallbacks: (RawProduct | null)[]): RawProduct {
  const merged: RawProduct = { ...primary, tags: [...primary.tags], images: [...primary.images] };
  for (const fallback of fallbacks) {
    if (!fallback) continue;
    for (const key of ["brand", "price", "currency", "category", "description"] as const) merged[key] ??= fallback[key];
    if (merged.tags.length === 0) merged.tags = [...fallback.tags];
    for (const image of fallback.images) addImage(merged.images, image.url, image.url, image.alt);
  }
  // A price without its currency (or the reverse) from a different source would mislead.
  if (!merged.price) delete merged.currency;
  return merged;
}

// Challenge pages from the common bot walls (Cloudflare, Akamai, PerimeterX, Imperva, DataDome).
const BOT_TITLE = /^(?:just a moment|attention required|access denied|pardon our interruption|please verify you are a human|are you a robot|security check|one more step|ddos protection)/i;
const BOT_MARKERS = ["cf-chl-", "challenge-platform", "px-captcha", "_incapsula_resource", "captcha-delivery.com"];

/** Reads a fetched HTML page. Pure: no network. */
export function readHtml(html: string, base: string): RawRead {
  const blocks = jsonLdBlocks(html);
  const node = findProductNode(blocks);
  const fromJsonLd = node ? productFromJsonLd(node, base) : null;
  const meta = metaTags(html);
  const fromMeta = productFromMeta(meta, base);
  const title = titleOf(html);
  const copy = capText(visibleText(html), COPY_MAX);

  if (!fromJsonLd && !fromMeta) {
    const lower = html.slice(0, 200_000).toLowerCase();
    if ((title && BOT_TITLE.test(title)) || BOT_MARKERS.some((marker) => lower.includes(marker))) {
      return { source: null, product: null, copy: "", blocked: { reason: "The site showed a bot check instead of the page." } };
    }
  }

  if (fromJsonLd) return { source: "jsonld", product: merge(fromJsonLd, fromMeta), copy };
  if (fromMeta) return { source: "meta", product: fromMeta, copy };

  // A JavaScript-only shell has a title ("Loading") but no product: say so, and keep its little copy.
  if (copy.length < MIN_READABLE_COPY) {
    return { source: null, product: null, copy, blocked: { reason: "The page needs JavaScript to show the product, so there was little to read." } };
  }
  const name = firstHeading(html) ?? title;
  const product: RawProduct | null = name ? { name, description: meta.description?.[0], tags: [], images: [] } : null;
  return { source: "text", product, copy };
}

// --- Cleaning and guardrails ---------------------------------------------------------------------

function clean(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = capText(collapse(stripEmDashes(value)), max);
  return cleaned || undefined;
}

/** Every page string goes through the guardrails. Hits are flagged, or dropped for tags and alt text. */
function guard(raw: RawRead): Pick<PageRead, "product" | "copy" | "flags"> {
  const flags: PageFlag[] = [];
  const passes = (path: string, value: string, action: PageFlag["action"]) => {
    const issues = checkText(value);
    for (const issue of issues) flags.push({ path, rule: issue.rule, match: issue.match, action });
    return issues.length === 0;
  };
  const keep = (path: string, value: string | undefined, max: number) => {
    const cleaned = clean(value, max);
    if (cleaned) passes(path, cleaned, "flagged");
    return cleaned;
  };

  let product: ProductRead | null = null;
  const name = raw.product ? keep("product.name", raw.product.name, NAME_MAX) : undefined;
  if (raw.product && name) {
    const tags: string[] = [];
    for (const tag of raw.product.tags) {
      const cleaned = clean(tag, TAG_MAX);
      if (cleaned && !tags.includes(cleaned) && tags.length < MAX_TAGS && passes(`product.tags.${tags.length}`, cleaned, "dropped")) tags.push(cleaned);
    }
    const images = raw.product.images.slice(0, MAX_IMAGES).map((image, index) => {
      const alt = clean(image.alt, ALT_MAX);
      return alt && passes(`product.images.${index}.alt`, alt, "dropped") ? { url: image.url, alt } : { url: image.url };
    });
    const optional = (key: "brand" | "category" | "description", max: number) => {
      const value = keep(`product.${key}`, raw.product?.[key], max);
      return value ? { [key]: value } : {};
    };
    product = {
      name,
      ...optional("brand", SHORT_MAX),
      ...(raw.product.price ? { price: raw.product.price } : {}),
      ...(raw.product.price && raw.product.currency ? { currency: raw.product.currency } : {}),
      ...optional("category", SHORT_MAX),
      ...optional("description", DESCRIPTION_MAX),
      tags,
      images,
    };
  }
  const copy = clean(raw.copy, COPY_MAX) ?? "";
  if (copy) passes("copy", copy, "flagged");
  return { product, copy, flags };
}

/** Links are stored at most MAX_URL_LENGTH long (an overlong one was refused, but is still echoed). */
const capUrl = (url: string) => url.slice(0, MAX_URL_LENGTH);

function finish(url: string, raw: RawRead, fetches: PageRead["fetches"], finalUrl?: string): PageRead {
  const guarded = guard(raw);
  return pageReadSchema.parse({
    url: capUrl(url),
    ...(finalUrl ? { finalUrl: capUrl(finalUrl) } : {}),
    source: guarded.product ? raw.source : null,
    ...guarded,
    ...(raw.blocked ? { blocked: raw.blocked } : {}),
    fetches,
  });
}

/** Shopify's visible copy: the title, then the description, as sentences. */
const shopifyCopy = (product: RawProduct) =>
  [product.name, product.description]
    .filter((part): part is string => !!part)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");

// --- Reading a link --------------------------------------------------------------------------------

/** One line for the trace and the fallback notice, per fetch failure. */
export function blockedReason(reason: FetchFailure, detail: string, status?: number): string {
  switch (reason) {
    case "blocked-address":
      return "The link points to a private or local address, so Stoop did not read it.";
    case "dns-failed":
      return "Stoop could not find that website.";
    case "timeout":
      return "The site took too long to answer.";
    case "too-large":
      return "The page is too large to read.";
    case "unsupported-content-type":
      return "The link is not a web page Stoop can read.";
    case "http-error":
      return status === 401 || status === 403 || status === 429 || status === 503
        ? `The site blocked the page reader (HTTP ${status}).`
        : `The site answered HTTP ${status ?? "error"}.`;
    case "too-many-redirects":
      return "The link redirects too many times.";
    case "insecure-redirect":
      return "The link redirects from https to plain http, so Stoop stopped.";
    case "network-error":
      return "Stoop could not connect to the site.";
    case "bad-url":
    case "over-budget":
      return detail;
  }
}

/** A JSON fetch that failed for one of these reasons would fail the same way for the page. */
const SAME_FOR_THE_PAGE = new Set<FetchFailure>(["blocked-address", "dns-failed", "timeout", "network-error", "bad-url"]);

export interface ReadPageOptions {
  /** Passed to every fetch (tests inject a policy and a resolver here). */
  fetch?: GuardedFetchOptions;
  /** The run's budget. Defaults to a fresh one for this link. */
  budget?: PageBudget;
}

const logOf = (result: PageFetch): PageRead["fetches"][number] =>
  result.ok
    ? { url: capUrl(result.url), ok: true, status: result.status }
    : { url: capUrl(result.url), ok: false, reason: result.reason, ...(result.status ? { status: result.status } : {}) };

const nothing = (reason: string): RawRead => ({ source: null, product: null, copy: "", blocked: { reason } });

/** Reads one product link. Never throws for anything a site does; a blocked read says why. */
export async function readPage(input: string, options: ReadPageOptions = {}): Promise<PageRead> {
  const fetches: PageRead["fetches"] = [];
  try {
    return await readLink(input, options, fetches);
  } catch {
    // A parser surprise (a page built to break it) becomes a blocked read, never a failed intake.
    return finish(input, nothing("Stoop could not read the page."), fetches);
  }
}

async function readLink(input: string, options: ReadPageOptions, fetches: PageRead["fetches"]): Promise<PageRead> {
  const checked = checkUrl(input, options.fetch?.policy, options.fetch?.ports);
  if (!checked.ok) return finish(input, nothing(blockedReason(checked.reason, checked.detail)), fetches);

  const budget = options.budget ?? new PageBudget(input);
  const get = async (url: string, accept?: readonly PageContentType[]) => {
    const result = await budget.fetch(url, { ...options.fetch, ...(accept ? { accept } : {}) });
    fetches.push(logOf(result));
    return result;
  };

  if (budget.jsonUrl) {
    const json = await get(budget.jsonUrl, ["application/json"]);
    if (json.ok) {
      const product = readShopifyJson(json.body, json.finalUrl);
      if (product) return finish(input, { source: "shopify", product, copy: shopifyCopy(product) }, fetches, json.finalUrl);
    } else if (SAME_FOR_THE_PAGE.has(json.reason)) {
      return finish(input, nothing(blockedReason(json.reason, json.detail, json.status)), fetches);
    }
  }

  const page = await get(budget.pageUrl ?? input);
  if (!page.ok) return finish(input, nothing(blockedReason(page.reason, page.detail, page.status)), fetches);
  if (page.contentType === "application/json") {
    const product = readShopifyJson(page.body, page.finalUrl);
    const read: RawRead = product ? { source: "shopify", product, copy: shopifyCopy(product) } : nothing("The link returned data, not a product page.");
    return finish(input, read, fetches, page.finalUrl);
  }
  return finish(input, readHtml(page.body, page.finalUrl), fetches, page.finalUrl);
}
