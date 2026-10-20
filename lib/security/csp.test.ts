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
        "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
        "media-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
        "font-src 'self'",
        "connect-src 'self'",
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
    expect(preview.get("connect-src")).toEqual(["'self'", "https://vercel.live", "wss://ws-us3.pusher.com"]);
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
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Strict-Transport-Security": "max-age=63072000",
    });
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
        "img-src 'self' https://fal.media https://*.fal.media https://storage.googleapis.com/falserverless/ https://*.public.blob.vercel-storage.com https://*.private.blob.vercel-storage.com",
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

  it("shows presigned product thumbnails from the private stores: any private Blob store, and the R2 refs bucket's host when it is set", () => {
    const account = "0123456789abcdef0123456789abcdef";
    expect(privateStorageSources({})).toEqual(["https://*.private.blob.vercel-storage.com"]);
    expect(privateStorageSources({ R2_ACCOUNT_ID: account, R2_REFS_BUCKET: "stoop-refs" })).toEqual([
      "https://*.private.blob.vercel-storage.com",
      `https://${account}.r2.cloudflarestorage.com`,
    ]);
    // No refs bucket, or an account id that is not one: no R2 host.
    expect(privateStorageSources({ R2_ACCOUNT_ID: account })).toEqual(["https://*.private.blob.vercel-storage.com"]);
    expect(privateStorageSources({ R2_ACCOUNT_ID: "evil.example/x", R2_REFS_BUCKET: "stoop-refs" })).toEqual(["https://*.private.blob.vercel-storage.com"]);
    const img = directives(byokPolicy({ R2_ACCOUNT_ID: account, R2_REFS_BUCKET: "stoop-refs" })).get("img-src");
    expect(img).toEqual(expect.arrayContaining(["https://*.private.blob.vercel-storage.com", `https://${account}.r2.cloudflarestorage.com`]));
    // Only images: the private stores never reach media, scripts or connections.
    expect(directives(byokPolicy({ R2_ACCOUNT_ID: account, R2_REFS_BUCKET: "stoop-refs" })).get("connect-src")).toEqual(["'self'", "https://queue.fal.run"]);
    expect(sitePolicy({ R2_ACCOUNT_ID: account, R2_REFS_BUCKET: "stoop-refs" }, PROD)).not.toMatch(/private\.blob|r2\.cloudflarestorage/);
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
    expect(home.headers.get("content-security-policy")).toContain("connect-src 'self';");
    expect(home.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(home.headers.get("cross-origin-opener-policy")).toBeNull();
  });
});
