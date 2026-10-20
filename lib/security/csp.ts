// The security headers every response carries, built here as pure functions so next.config.ts stays
// small and the policies are unit-tested. Two policies, never both on one response (stacked policies
// intersect, and the site's connect-src 'self' would stop /byok from reaching fal):
//   - the site policy, on every path except /byok: one policy for every page, because a soft navigation
//     keeps the first document's policy. Next inlines its page data, so scripts need 'unsafe-inline'
//     ('unsafe-eval' too, in development only). Styles need 'unsafe-inline' for next/font and React's
//     style attributes. Media come from our own origin (/demo) and the public storage hosts.
//   - the /byok policy: a page with no inline code at all, whose only outside connection is fal's queue,
//     with Trusted Types required, so a visitor's fal key can only ever go to fal.
// Vercel's preview toolbar (vercel.live) is allowed on preview deployments only.
// No imports: next.config.ts loads this module directly.

type Env = Readonly<Record<string, string | undefined>>;

/** fal's queue: submit, status and result for every endpoint (status_url and response_url live here too). */
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
/**
 * Where fal serves outputs: fal.media and its subdomains (v3.fal.media, v3b.fal.media), plus the bucket
 * fal's own example outputs live in (lib/media/frames.ts isFalMedia accepts the same hosts).
 */
export const FAL_MEDIA_SOURCES = ["https://fal.media", "https://*.fal.media", "https://storage.googleapis.com/falserverless/"] as const;
/** Every public Vercel Blob store is served from a subdomain here (frames and drafts). */
export const PUBLIC_BLOB_SOURCE = "https://*.public.blob.vercel-storage.com";
/**
 * Every private Vercel Blob store is served from a subdomain here: a brand's product photos, read
 * through presigned URLs (lib/storage.ts PrivateStorage), which /byok shows as thumbnails.
 */
export const PRIVATE_BLOB_SOURCE = "https://*.private.blob.vercel-storage.com";

/** Vercel's documented sources for the preview toolbar (Comments, feedback). */
const VERCEL_LIVE = {
  script: ["https://vercel.live"],
  style: ["https://vercel.live"],
  img: ["https://vercel.live", "https://vercel.com"],
  font: ["https://vercel.live", "https://assets.vercel.com"],
  connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
  frame: ["https://vercel.live"],
} as const;

/** The paths each policy covers, as next.config headers() sources. The site source leaves out /byok and everything under it. */
export const SITE_SOURCE = "/((?!byok(?:/|$)).*)";
export const BYOK_SOURCE = "/byok/:path*";

export interface PolicyOptions {
  /** `next dev`: React needs eval for its debugging stacks. */
  dev: boolean;
  /** A Vercel preview deployment: the toolbar loads from vercel.live. */
  preview: boolean;
}

export function policyOptions(env: Env = process.env): PolicyOptions {
  return { dev: env.NODE_ENV === "development", preview: env.VERCEL_ENV === "preview" };
}

/** The https origin of a configured URL, or null. */
function originOf(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Where Stoop's public files are served from: any public Blob store, and the R2 public URL when one is set. */
export function publicStorageSources(env: Env = process.env): string[] {
  const r2 = originOf(env.R2_PUBLIC_URL);
  return [PUBLIC_BLOB_SOURCE, ...(r2 ? [r2] : [])];
}

/**
 * Where /byok's presigned product photos come from, only for the private store this deployment has
 * (as lib/storage.ts privateStorageFromEnv picks it by STORAGE_DRIVER): with Blob, any private Blob
 * store once PRIVATE_BLOB_READ_WRITE_TOKEN is set; with R2, the refs bucket's own path on its S3 host
 * (https://<account>.r2.cloudflarestorage.com/<bucket>/), never the whole host. Only the presence and
 * shape of these values is read.
 */
export function privateStorageSources(env: Env = process.env): string[] {
  const driver = env.STORAGE_DRIVER?.trim().toLowerCase() || "blob";
  if (driver === "blob") return env.PRIVATE_BLOB_READ_WRITE_TOKEN?.trim() ? [PRIVATE_BLOB_SOURCE] : [];
  if (driver !== "r2") return [];
  const account = env.R2_ACCOUNT_ID?.trim() ?? "";
  const bucket = env.R2_REFS_BUCKET?.trim() ?? "";
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return [];
  return [`https://${account}.r2.cloudflarestorage.com/${bucket}/`];
}

/** Serializes directives in order: "name a b; name c". A directive with no sources is left out. */
export function serializePolicy(directives: ReadonlyArray<readonly [string, readonly string[]]>): string {
  return directives
    .map(([name, sources]) => (sources.length ? `${name} ${sources.join(" ")}` : null))
    .filter((part): part is string => part !== null)
    .join("; ");
}

export function sitePolicy(env: Env = process.env, options: PolicyOptions = policyOptions(env)): string {
  const storage = publicStorageSources(env);
  const live = (kind: keyof typeof VERCEL_LIVE) => (options.preview ? VERCEL_LIVE[kind] : []);
  return serializePolicy([
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(options.dev ? ["'unsafe-eval'"] : []), ...live("script")]],
    ["style-src", ["'self'", "'unsafe-inline'", ...live("style")]],
    ["img-src", ["'self'", "data:", "blob:", ...storage, ...live("img")]],
    ["media-src", ["'self'", "data:", "blob:", ...storage]],
    ["font-src", ["'self'", ...live("font")]],
    ["connect-src", ["'self'", ...live("connect")]],
    ["frame-src", [...live("frame")]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ]);
}

/**
 * /byok: no inline code, fal's queue as the only outside connection, Trusted Types required, and no
 * Trusted Types policy may be made. Images may also come from the private stores, for the presigned
 * product thumbnails.
 */
export function byokPolicy(env: Env = process.env): string {
  const storage = publicStorageSources(env);
  return serializePolicy([
    ["default-src", ["'none'"]],
    ["script-src", ["'self'"]],
    ["style-src", ["'self'"]],
    ["connect-src", ["'self'", FAL_QUEUE_ORIGIN]],
    ["img-src", ["'self'", ...FAL_MEDIA_SOURCES, ...storage, ...privateStorageSources(env)]],
    ["media-src", [...FAL_MEDIA_SOURCES]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'none'"]],
    ["require-trusted-types-for", ["'script'"]],
    ["trusted-types", ["'none'"]],
  ]);
}

export interface Header {
  key: string;
  value: string;
}

const COMMON: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

export function siteHeaders(env: Env = process.env, options: PolicyOptions = policyOptions(env)): Header[] {
  return [{ key: "Content-Security-Policy", value: sitePolicy(env, options) }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, ...COMMON];
}

export function byokHeaders(env: Env = process.env): Header[] {
  return [
    { key: "Content-Security-Policy", value: byokPolicy(env) },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Referrer-Policy", value: "no-referrer" },
    ...COMMON,
  ];
}

/** next.config headers(): the site rule and the /byok rule, whose sources never overlap. */
export function securityHeaderRules(env: Env = process.env): { source: string; headers: Header[] }[] {
  return [
    { source: SITE_SOURCE, headers: siteHeaders(env) },
    { source: BYOK_SOURCE, headers: byokHeaders(env) },
  ];
}
