import { describe, expect, it } from "vitest";
import { codeMatches, issuePass, judgeConfig, passMaxAge, verifyPass, withoutJudgeParam, type JudgeConfig } from "./pass";

const CODE = "judge-code-0123456789";
const SECRET = "s".repeat(32);
const NOW = Date.parse("2026-11-03T12:00:00Z");
const config: JudgeConfig = { code: CODE, secret: SECRET, until: Date.parse("2026-11-17T00:00:00Z") };

describe("judge config", () => {
  it("stays off without a 16+ character code and a signing secret", () => {
    expect(judgeConfig({})).toBeNull();
    expect(judgeConfig({ JUDGE_CODE: CODE })).toBeNull();
    expect(judgeConfig({ JUDGE_CODE: "short", STOOP_SIGNING_SECRET: SECRET })).toBeNull();
    expect(judgeConfig({ JUDGE_CODE: CODE, STOOP_SIGNING_SECRET: SECRET })).toEqual(config);
  });

  it("reads the end date, and refuses one that is not a date", () => {
    expect(judgeConfig({ JUDGE_CODE: CODE, STOOP_SIGNING_SECRET: SECRET, JUDGE_PASS_UNTIL: "2026-12-01T00:00:00Z" })?.until).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(() => judgeConfig({ JUDGE_CODE: CODE, STOOP_SIGNING_SECRET: SECRET, JUDGE_PASS_UNTIL: "soon" })).toThrow(/ISO date/);
  });
});

describe("judge pass", () => {
  it("matches only the exact code", () => {
    expect(codeMatches(config, CODE)).toBe(true);
    expect(codeMatches(config, ` ${CODE} `)).toBe(true);
    expect(codeMatches(config, `${CODE}x`)).toBe(false);
    expect(codeMatches(config, "")).toBe(false);
    expect(codeMatches(null, CODE)).toBe(false);
  });

  it("issues a pass that verifies, without the code inside it", () => {
    const issued = issuePass(config, NOW, "a".repeat(24));
    expect(issued?.value).toMatch(/^v1\.a{24}\.\d+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(issued?.value).not.toContain(CODE);
    expect(verifyPass(config, issued?.value, NOW + 60_000)).toEqual({ passId: "a".repeat(24), issuedAt: Math.floor(NOW / 1000) });
  });

  it("ends every pass when the code rotates or the secret changes", () => {
    const issued = issuePass(config, NOW)!;
    expect(verifyPass({ ...config, code: "another-judge-code-987" }, issued.value, NOW)).toBeNull();
    expect(verifyPass({ ...config, secret: "t".repeat(32) }, issued.value, NOW)).toBeNull();
  });

  it("refuses altered, future-dated and expired passes", () => {
    const issued = issuePass(config, NOW, "a".repeat(24))!;
    expect(verifyPass(config, issued.value.replace("v1.a", "v1.b"), NOW)).toBeNull();
    expect(verifyPass(config, `${issued.value}x`, NOW)).toBeNull();
    expect(verifyPass(config, issued.value, config.until)).toBeNull();
    const future = issuePass(config, NOW + 3_600_000)!;
    expect(verifyPass(config, future.value, NOW)).toBeNull();
    expect(verifyPass(null, issued.value, NOW)).toBeNull();
    expect(issuePass(config, config.until)).toBeNull();
  });

  it("lives until the end date and strips only the code from the URL", () => {
    expect(passMaxAge(config, NOW)).toBe((config.until - NOW) / 1000);
    expect(withoutJudgeParam(new URL("https://stoop.app/examples/food-hot-sauce?judge=x&ref=dp#reality")).href).toBe("https://stoop.app/examples/food-hot-sauce?ref=dp#reality");
  });
});
