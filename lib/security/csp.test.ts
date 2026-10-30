import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { BYOK_SOURCE, byokHeaders, byokPolicy, privateStorageSources, publicStorageSources, securityHeaderRules, SITE_SOURCE, sitePolicy, siteHeaders } from "./csp";

const PROD = { dev: false, preview: false };
const directives = (policy: string) => new Map(policy.split("; ").map((part) => [part.split(" ")[0], part.split(" ").slice(1)] as const));

describe("the site-wide policy", () => {
  it("is one fixed policy for every page: self only, with the inline page data Next needs", () => {
    expect(sitePolicy({}, PROD)).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://tiles.openfreemap.org",
        "media-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
        "font-src 'self'",
        "connect-src 'self' https://tiles.openfreemap.org",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  });

  it("adds eval in development only, and vercel.live on preview deployments only", () => {
    expect(directives(sitePolicy({}, { dev: true, preview: false })).get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(sitePolicy({}, PROD)).not.toContain("unsafe-eval");
    const preview = directives(sitePolicy({}, { dev: false, preview: true }));
    expect(preview.get("script-src")).toContain("https://vercel.live");
    expect(preview.get("connect-src")).toEqual(["'self'", "https://tiles.openfreemap.org", "https://vercel.live", "wss://ws-us3.pusher.com"]);
    expect(preview.get("frame-src")).toEqual(["https://vercel.live"]);
    expect(sitePolicy({}, PROD)).not.toContain("vercel.live");
    expect(sitePolicy({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toContain("'unsafe-eval'");
    expect(sitePolicy({ NODE_ENV: "production", VERCEL_ENV: "production" })).not.toMatch(/unsafe-eval|vercel\.live/);
  });

  it("lets media and images come from the R2 public URL when one is set", () => {
    expect(publicStorageSources({ R2_PUBLIC_URL: "https://media.stoop.example/path/" })).toEqual(["https://*.public.blob.vercel-storage.com", "https://media.stoop.example"]);
    expect(publicStorageSources({ R2_PUBLIC_URL: "http://insecure.example" })).toEqual(["https://*.public.blob.vercel-storage.com"]);
    expect(directives(sitePolicy({ R2_PUBLIC_URL: "https://media.stoop.example" }, PROD)).get("media-src")).toContain("https://media.stoop.example");
  });

  it("comes with nosniff, a referrer policy, a permissions policy and HSTS", () => {
    const headers = Object.fromEntries(siteHeaders({}, PROD).map((h) => [h.key, h.value]));
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
      "Strict-Transport-Security": "max-age=63072000",
    });
  });
});

describe("the block map's sources", () => {
  it("allow only OpenFreeMap's one origin for the map, and MapLibre's worker from self or a blob", () => {
    const policy = directives(sitePolicy({}, PROD));
    expect(policy.get("connect-src")).toEqual(["'self'", "https://tiles.openfreemap.org"]);
    expect(policy.get("img-src")).toContain("https://tiles.openfreemap.org");
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
    // Nothing else opens up: no script, style, font or frame source for the map.
    for (const name of ["script-src", "style-src", "font-src", "default-src"]) expect(policy.get(name)?.some((s) => s.includes("openfreemap"))).toBe(false);
  });
});

describe("the /byok policy", () => {
  it("allows no inline code, fal's queue as the only outside connection, and requires Trusted Types", () => {
    expect(byokPolicy({})).toBe(
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'self' https://queue.fal.run",
        "img-src 'self' https://fal.media https://*.fal.media https://storage.googleapis.com/falserverless/ https://*.public.blob.vercel-storage.com",
        "media-src https://fal.media https://*.fal.media https://storage.googleapis.com/falserverless/",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "require-trusted-types-for 'script'",
        "trusted-types 'none'",
      ].join("; "),
    );
    expect(byokPolicy({ NODE_ENV: "development", VERCEL_ENV: "preview" })).not.toMatch(/unsafe|vercel\.live/);
  });

  it("shows presigned product thumbnails only from the private store this deployment has", () => {
    const account = "0123456789abcdef0123456789abcdef";
    const blob = { PRIVATE_BLOB_READ_WRITE_TOKEN: "set" };
    const r2 = { STORAGE_DRIVER: "r2", R2_ACCOUNT_ID: account, R2_REFS_BUCKET: "stoop-refs" };
    // Blob (the default driver): any private Blob store, once a private store is configured.
    expect(privateStorageSources({})).toEqual([]);
    expect(privateStorageSources(blob)).toEqual(["https://*.private.blob.vercel-storage.com"]);
    // R2: the refs bucket's own path, never the whole account host, and never the Blob wildcard.
    expect(privateStorageSources({ ...r2, ...blob })).toEqual([`https://${account}.r2.cloudflarestorage.com/stoop-refs/`]);
    // No refs bucket, or values that are not an account id and a bucket name: nothing.
    expect(privateStorageSources({ STORAGE_DRIVER: "r2", R2_ACCOUNT_ID: account })).toEqual([]);
    expect(privateStorageSources({ ...r2, R2_ACCOUNT_ID: "evil.example/x" })).toEqual([]);
    expect(privateStorageSources({ ...r2, R2_REFS_BUCKET: "a/../b" })).toEqual([]);
    expect(directives(byokPolicy(blob)).get("img-src")).toContain("https://*.private.blob.vercel-storage.com");
    expect(directives(byokPolicy(r2)).get("img-src")).toContain(`https://${account}.r2.cloudflarestorage.com/stoop-refs/`);
    expect(byokPolicy({})).not.toMatch(/private\.blob|r2\.cloudflarestorage/);
    // Only images: the private stores never reach media, scripts or connections, nor the site policy.
    expect(directives(byokPolicy(r2)).get("connect-src")).toEqual(["'self'", "https://queue.fal.run"]);
    expect(sitePolicy({ ...r2, ...blob }, PROD)).not.toMatch(/private\.blob|r2\.cloudflarestorage/);
  });

  it("isolates the page: same-origin opener, no referrer, nosniff", () => {
    const headers = Object.fromEntries(byokHeaders({}).map((h) => [h.key, h.value]));
    expect(headers).toMatchObject({ "Cross-Origin-Opener-Policy": "same-origin", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  });
});

describe("the header rules in next.config.ts", () => {
  const rules = securityHeaderRules({}).map((rule) => ({ ...buildCustomRoute("header", { source: rule.source, headers: rule.headers }), headers: rule.headers }));
  const cspRulesFor = (path: string) => rules.filter((rule) => new RegExp(rule.regex).test(path) && rule.headers.some((h) => h.key === "Content-Security-Policy"));

  it("never puts two policies on one path: /byok and everything under it get only theirs", () => {
    expect([SITE_SOURCE, BYOK_SOURCE]).toEqual(securityHeaderRules({}).map((r) => r.source));
    for (const path of ["/byok", "/byok/", "/byok/app.js", "/byok/app.css"]) {
      const matched = cspRulesFor(path);
      expect(matched.map((r) => r.source), path).toEqual([BYOK_SOURCE]);
    }
    for (const path of ["/", "/examples/food-hot-sauce", "/report/run_0123", "/api/render", "/demo/clip.mp4", "/_next/static/chunk.js", "/byokx", "/judges"]) {
      expect(cspRulesFor(path).map((r) => r.source), path).toEqual([SITE_SOURCE]);
    }
  });

  it("are what Next itself answers for each path", async () => {
    const byok = await unstable_getResponseFromNextConfig({ url: "https://stoop.example/byok?reportId=example-food-hot-sauce&segment=control", nextConfig });
    expect(byok.headers.get("content-security-policy")).toContain("connect-src 'self' https://queue.fal.run");
    expect(byok.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(byok.headers.get("referrer-policy")).toBe("no-referrer");
    const home = await unstable_getResponseFromNextConfig({ url: "https://stoop.example/examples/food-hot-sauce", nextConfig });
    expect(home.headers.get("content-security-policy")).toContain("connect-src 'self' https://tiles.openfreemap.org;");
    expect(home.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(home.headers.get("cross-origin-opener-policy")).toBeNull();
  });
});
