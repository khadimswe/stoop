import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { getRelativeURL } from "next/dist/shared/lib/router/utils/relativize-url";
import { describe, expect, it } from "vitest";
import { config as proxyConfig } from "../../proxy";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store/types";
import { issuePass, JUDGE_CODE_ATTEMPTS_PER_HOUR, JUDGE_COOKIE, JUDGE_HINT_COOKIE, passMaxAge, verifyPass, type JudgeConfig } from "./pass";
import { judgeProxy } from "./proxy";

const CODE = "judge-code-0123456789";
const NOW = Date.parse("2026-11-03T12:00:00Z");
const config: JudgeConfig = { code: CODE, secret: "s".repeat(32), until: Date.parse("2026-11-17T08:00:00Z") };

function setup(options: { config?: JudgeConfig | null; store?: () => Store } = {}) {
  const store = new MemoryStore({ now: () => NOW });
  const run = (url: string, init: { cookie?: string; ip?: string } = {}) =>
    judgeProxy(new Request(url, { headers: { "x-forwarded-for": init.ip ?? "203.0.113.9", ...(init.cookie ? { cookie: init.cookie } : {}) } }), {
      config: options.config === undefined ? config : options.config,
      store: options.store ?? (() => store),
      now: () => NOW,
    });
  return { store, run };
}

const cookiesOf = (response: Response) => response.headers.getSetCookie();
const valueOf = (setCookie: string) => setCookie.split(";")[0].split("=").slice(1).join("=");

describe("the judge link proxy", () => {
  it("sets the pass and its hint for the right code, then 303s to the same URL without the code", async () => {
    const { run } = setup();
    const response = await run(`https://stoop.example/examples/food-hot-sauce?ref=devpost&judge=${CODE}#reality`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://stoop.example/examples/food-hot-sauce?ref=devpost");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const [pass, hint] = cookiesOf(response);
    const maxAge = passMaxAge(config, NOW);
    expect(pass).toBe(`${JUDGE_COOKIE}=${valueOf(pass)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly; Secure`);
    expect(hint).toBe(`${JUDGE_HINT_COOKIE}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`);
    expect(verifyPass(config, valueOf(pass), NOW)).not.toBeNull();
    expect(pass).not.toContain(CODE);
  });

  it("leaves Secure off on plain http (local dev) and never uses SameSite=None", async () => {
    const { run } = setup();
    const cookies = cookiesOf(await run(`http://localhost:3000/?judge=${CODE}`));
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).not.toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
    }
  });

  it("answers a wrong code with the same redirect and no cookie", async () => {
    const { run } = setup();
    const response = await run("https://stoop.example/judges?judge=not-the-code-at-all");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://stoop.example/judges");
    expect(cookiesOf(response)).toEqual([]);
  });

  it("never redirects to another host, even for a path that starts with two slashes", async () => {
    const { run } = setup();
    for (const path of ["//evil.example/x", "/\\evil.example/x", "///evil.example", "/a//b"]) {
      const response = await run(`https://stoop.example${path}?judge=${path.length > 3 ? "wrong-code" : CODE}`);
      const location = response.headers.get("location") ?? "";
      expect(new URL(location).host, path).toBe("stoop.example");
      // What Next's proxy adapter turns a same-host Location into.
      const relative = getRelativeURL(location, `https://stoop.example${path}`);
      expect(relative.startsWith("//"), relative).toBe(false);
      expect(relative.startsWith("/")).toBe(true);
    }
  });

  it("only strips the code while the pass is off (no JUDGE_CODE or no signing secret)", async () => {
    const { run } = setup({ config: null });
    const response = await run(`https://stoop.example/?judge=${CODE}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://stoop.example/");
    expect(cookiesOf(response)).toEqual([]);
  });

  it("keeps a still-valid pass, so reopening the link never resets a judge's renders", async () => {
    const { run } = setup();
    const earlier = issuePass(config, NOW - 86_400_000, "c".repeat(24))!;
    const [pass] = cookiesOf(await run(`https://stoop.example/?judge=${CODE}`, { cookie: `${JUDGE_COOKIE}=${earlier.value}` }));
    expect(valueOf(pass)).toBe(earlier.value);
    // A pass from another code (or forged) is replaced with a fresh one.
    const [fresh] = cookiesOf(await run(`https://stoop.example/?judge=${CODE}`, { cookie: `${JUDGE_COOKIE}=v1.${"c".repeat(24)}.1.AAAAAAAAAAAAAAAA.${"A".repeat(43)}` }));
    expect(verifyPass(config, valueOf(fresh), NOW)?.passId).not.toBe("c".repeat(24));
  });

  it("ends every older pass when the code rotates", async () => {
    const { run } = setup();
    const [pass] = cookiesOf(await run(`https://stoop.example/?judge=${CODE}`));
    const rotated = { ...config, code: "the-next-judge-code-42" };
    expect(verifyPass(rotated, valueOf(pass), NOW)).toBeNull();
  });

  it("issues nothing once judging has ended", async () => {
    const { run } = setup({ config: { ...config, until: NOW } });
    expect(cookiesOf(await run(`https://stoop.example/?judge=${CODE}`))).toEqual([]);
  });

  it("counts wrong codes per IP per hour; past the limit even the right code gets no cookie", async () => {
    const { run } = setup();
    for (let i = 0; i < JUDGE_CODE_ATTEMPTS_PER_HOUR; i++) await run(`https://stoop.example/?judge=guess-${i}`);
    expect(cookiesOf(await run(`https://stoop.example/?judge=${CODE}`))).toEqual([]);
    // Another network is not affected.
    expect(cookiesOf(await run(`https://stoop.example/?judge=${CODE}`, { ip: "198.51.100.4" }))).toHaveLength(2);
  });

  it("fails open when the store throws or stalls: the code's randomness is the defense", async () => {
    const broken = setup({
      store: () => {
        throw new Error("no store");
      },
    });
    expect(cookiesOf(await broken.run(`https://stoop.example/?judge=${CODE}`))).toHaveLength(2);
    const hanging = new MemoryStore();
    hanging.get = () => new Promise(() => {});
    const stalled = setup({ store: () => hanging });
    const started = Date.now();
    expect(cookiesOf(await stalled.run(`https://stoop.example/?judge=${CODE}`))).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("the proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, url });

  it("runs only on page requests that carry ?judge=", () => {
    expect(matches(`/?judge=${CODE}`)).toBe(true);
    expect(matches(`/examples/food-hot-sauce?judge=${CODE}`)).toBe(true);
    expect(matches(`/byok?reportId=example-food-hot-sauce&segment=control&judge=${CODE}`)).toBe(true);
    expect(matches("/")).toBe(false);
    expect(matches("/examples/food-hot-sauce")).toBe(false);
  });

  it("skips API routes, Next's own files and anything with a file extension", () => {
    expect(matches(`/api/render?judge=${CODE}`)).toBe(false);
    expect(matches(`/api?judge=${CODE}`)).toBe(false);
    expect(matches(`/_next/static/chunk.js?judge=${CODE}`)).toBe(false);
    expect(matches(`/demo/clip.mp4?judge=${CODE}`)).toBe(false);
    expect(matches(`/byok/app.js?judge=${CODE}`)).toBe(false);
  });
});
