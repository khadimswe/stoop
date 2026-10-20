import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashOf, sha256, stableStringify } from "./hash";

describe("stableStringify", () => {
  it("ignores key order at every depth", () => {
    const a = { z: 1, a: { y: [1, { d: 4, c: 3 }], b: 2 }, m: { q: { s: 1, r: 2 } } };
    const b = { m: { q: { r: 2, s: 1 } }, a: { b: 2, y: [1, { c: 3, d: 4 }] }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"a":{"b":2,"y":[1,{"c":3,"d":4}]},"m":{"q":{"r":2,"s":1}},"z":1}');
  });

  it("keeps array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(stableStringify([3, 1, 2])).not.toBe(stableStringify([1, 2, 3]));
    expect(stableStringify([{ b: 1 }, { a: 1 }])).toBe('[{"b":1},{"a":1}]');
  });

  it("drops undefined object values at every depth", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: { b: undefined, c: [{ d: undefined }] } })).toBe('{"a":{"c":[{}]}}');
    expect(hashOf({ a: 1, b: undefined })).toBe(hashOf({ a: 1 }));
  });

  it("turns undefined array items into null", () => {
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
    expect(stableStringify({ list: [undefined] })).toBe('{"list":[null]}');
  });

  it("keeps null, booleans, strings and nested empties", () => {
    expect(stableStringify({ n: null, t: true, f: false, s: "", e: {}, l: [] })).toBe('{"e":{},"f":false,"l":[],"n":null,"s":"","t":true}');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("throws on %s at any depth", (bad) => {
    expect(() => stableStringify(bad)).toThrow(/non-finite/);
    expect(() => stableStringify({ a: { b: bad } })).toThrow(/non-finite/);
    expect(() => stableStringify([1, [bad]])).toThrow(/non-finite/);
  });

  it("sorts keys of objects without a prototype too", () => {
    const bare = Object.assign(Object.create(null) as Record<string, number>, { b: 2, a: 1 });
    expect(stableStringify(bare)).toBe('{"a":1,"b":2}');
    expect(stableStringify({ x: bare })).toBe('{"x":{"a":1,"b":2}}');
  });

  it("throws when the value has no JSON form instead of returning undefined", () => {
    expect(() => stableStringify(undefined)).toThrow();
    expect(() => stableStringify(() => 1)).toThrow();
  });

  it("does not mutate its input", () => {
    const input = { b: [2, 1], a: 1 };
    stableStringify(input);
    expect(Object.keys(input)).toEqual(["b", "a"]);
    expect(input.b).toEqual([2, 1]);
  });
});

describe("sha256", () => {
  it("matches the standard test vectors", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes text as UTF-8", () => {
    expect(sha256("café")).not.toBe(sha256("cafe"));
    expect(sha256("café")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashOf", () => {
  it("is the sha256 of the stable JSON form", () => {
    expect(hashOf({ b: 1, a: 2 })).toBe(sha256('{"a":2,"b":1}'));
  });

  it("gives the same hash whatever the key order", () => {
    expect(hashOf({ prompt: "x", settings: { seconds: 15, ratio: "9:16" } })).toBe(
      hashOf({ settings: { ratio: "9:16", seconds: 15 }, prompt: "x" }),
    );
  });

  it("gives different hashes for different values", () => {
    const values: unknown[] = [
      { a: 1 },
      { a: 2 },
      { a: "1" },
      { b: 1 },
      { a: [1, 2] },
      { a: [2, 1] },
      { a: null },
      { a: {} },
      [1],
      "1",
      1,
      null,
      "",
      "prompt",
      "prompt ",
    ];
    const hashes = values.map(hashOf);
    expect(new Set(hashes).size).toBe(values.length);
  });
});

describe("sha256", () => {
  const reference = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  it("matches node:crypto on the standard vectors and on padding edges", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const text = "a".repeat(length);
      expect(sha256(text), String(length)).toBe(reference(text));
    }
  });

  it("matches node:crypto on multi-byte text and real cache keys", () => {
    for (const text of ["Crème Brûlée Corner Café", "café, naïve, 東京, \u{1F336}", "/v2/insights?filter.type=urn%3Aentity%3Aartist&take=50"]) {
      expect(sha256(text)).toBe(reference(text));
    }
  });
});
