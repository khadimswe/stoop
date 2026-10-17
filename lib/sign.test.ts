import { describe, expect, it } from "vitest";
import { randomHex, safeEqual, sign, signingSecret, verifySignature } from "./sign";
import { mintVisitorCookie, readVisitorCookie } from "./visitor-cookie";

const SECRET = "s".repeat(32);

describe("signing", () => {
  it("needs a secret of 32 or more characters", () => {
    expect(signingSecret({})).toBeNull();
    expect(signingSecret({ STOOP_SIGNING_SECRET: "short" })).toBeNull();
    expect(signingSecret({ STOOP_SIGNING_SECRET: ` ${SECRET} ` })).toBe(SECRET);
  });

  it("verifies only the same message, purpose and secret", () => {
    const mac = sign(SECRET, "visitor", "c_1");
    expect(verifySignature(SECRET, "visitor", "c_1", mac)).toBe(true);
    expect(verifySignature(SECRET, "visitor", "c_2", mac)).toBe(false);
    expect(verifySignature(SECRET, "judge-pass", "c_1", mac)).toBe(false);
    expect(verifySignature("t".repeat(32), "visitor", "c_1", mac)).toBe(false);
  });

  it("compares strings of any length safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(randomHex(12)).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("visitor cookie", () => {
  it("round-trips an id this server signed", () => {
    const { id, value } = mintVisitorCookie(SECRET);
    expect(id).toMatch(/^c_[0-9a-f]{24}$/);
    expect(readVisitorCookie(SECRET, value)).toBe(id);
  });

  it("refuses forged, altered or unsigned values, and everything without a secret", () => {
    const { value } = mintVisitorCookie(SECRET, `c_${"a".repeat(24)}`);
    expect(readVisitorCookie(SECRET, value.replace("c_a", "c_b"))).toBeNull();
    expect(readVisitorCookie(SECRET, `c_${"a".repeat(24)}`)).toBeNull();
    expect(readVisitorCookie("t".repeat(32), value)).toBeNull();
    expect(readVisitorCookie(null, value)).toBeNull();
    expect(readVisitorCookie(SECRET, "")).toBeNull();
    expect(() => mintVisitorCookie(SECRET, "c_short")).toThrow();
  });
});
