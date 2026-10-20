// The public mirror's guard: its path rules must match exactly what git filter-repo removes (a
// literal path or directory, a glob over the whole path, a regex searched in the path), and the id
// check must catch Qloo-like ids while allowing the made-up test ids.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { idsIn, pathRule, readExclude, SYNTHETIC_IDS } from "./public-mirror.mjs";

const matches = (line: string, file: string) => pathRule(line).test(file);

describe("path rules, as git filter-repo reads them", () => {
  it("match a literal path itself, or everything under it as a directory, never a longer name", () => {
    expect(matches("data/runs/", "data/runs/food/run.report.json")).toBe(true);
    expect(matches("data/runs", "data/runs/food/run.report.json")).toBe(true);
    expect(matches("data/runs", "data/runs")).toBe(true);
    expect(matches("data/runs", "data/runs-old/x.json")).toBe(false);
    expect(matches("MIRROR.md", "MIRROR.md")).toBe(true);
    expect(matches("MIRROR.md", "docs/MIRROR.md")).toBe(false);
    expect(matches("literal:docs/a.md", "docs/a.md")).toBe(true);
  });

  it("match a glob against the whole path, with * crossing slashes, and a plain glob as a directory too", () => {
    expect(matches("glob:fixtures/*.json", "fixtures/pool.json")).toBe(true);
    expect(matches("glob:fixtures/*.json", "fixtures/recipes/pool.json")).toBe(true);
    expect(matches("glob:fixtures/*.json", "fixtures/pool.json.gz")).toBe(false);
    expect(matches("glob:docs/?.md", "docs/a.md")).toBe(true);
    expect(matches("glob:docs/?.md", "docs/ab.md")).toBe(false);
    expect(matches("glob:data/runs", "data/runs/food/run.report.json")).toBe(true);
    expect(matches("glob:a.b", "axb")).toBe(false);
  });

  it("refuse glob character sets, which fnmatch reads differently", () => {
    expect(() => pathRule("glob:a[^b]c")).toThrow(/regex:/);
    expect(() => pathRule("glob:x[!]]y")).toThrow(/regex:/);
  });

  it("search a regex anywhere in the path", () => {
    const recipes = "regex:^fixtures/recipes/(?!(smoke|probe-search|pool-resolve|pool-refresh-2)\\.json$)";
    for (const kept of ["smoke", "probe-search", "pool-resolve", "pool-refresh-2"]) expect(matches(recipes, `fixtures/recipes/${kept}.json`)).toBe(false);
    for (const gone of ["pool-scoring", "pool-refresh-3", "smoke-2", "audience-segments"]) expect(matches(recipes, `fixtures/recipes/${gone}.json`)).toBe(true);
    expect(matches("regex:(^|/)\\.DS_Store$", ".DS_Store")).toBe(true);
    expect(matches("regex:(^|/)\\.DS_Store$", "app/.DS_Store")).toBe(true);
    expect(matches("regex:(^|/)\\.DS_Store$", "app/x.DS_Store")).toBe(false);
  });
});

describe("the exclude file", () => {
  const exclude = readExclude();

  it("leaves out every kind of recorded Qloo data and keeps the code, the inputs and the request lists", () => {
    for (const gone of [
      "fixtures/smoke.json",
      "fixtures/pool-audience.json.gz",
      "fixtures/llm/food-hot-sauce.json",
      "fixtures/recipes/pool-scoring.json",
      "data/runs/food-hot-sauce/run.report.json",
      "data/culture/panels.json",
      "data/geo/reference-heatmap.json",
      "data/data-check/summary.json",
      "data/marketing/mcp-session.json",
      "docs/data-check-details.md",
      "MIRROR.md",
    ]) {
      expect(exclude.excluded(gone), gone).toBe(true);
    }
    for (const kept of [
      "fixtures/README.md",
      "fixtures/recipes/smoke.json",
      "fixtures/recipes/pool-resolve.json",
      "data/candidates.json",
      "data/baselines/food-hot-sauce/run-1.json",
      "data/geo/us-metros.json",
      "docs/data-check.md",
      "lib/culture/panels.ts",
      "public-mirror.exclude",
      "README.md",
    ]) {
      expect(exclude.excluded(kept), kept).toBe(false);
    }
  });

  it("lists old versions by full blob id", () => {
    expect(exclude.blobs.size).toBeGreaterThan(0);
    for (const sha of exclude.blobs.keys()) expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses a short blob id and a rename", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stoop-exclude-"));
    try {
      const file = path.join(dir, "test.exclude");
      writeFileSync(file, "blob:abc123 lib/x.ts\n");
      expect(() => readExclude(file)).toThrow(/40-character/);
      writeFileSync(file, "data/runs/==>data/kept/\n");
      expect(() => readExclude(file)).toThrow(/renames/);
      writeFileSync(file, "# a comment\n\nallow-name: Some Town\ndata/runs/\n");
      expect(readExclude(file).allowNames.has("Some Town")).toBe(true);
      expect(readExclude(file).excluded("data/runs/x.json")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the id check", () => {
  // Built from parts, so this file holds no UUID-shaped string the check itself would flag.
  const fake = ["1A2B3C4D", "1111", "2222", "3333", "444455556666"].join("-");

  it("finds Qloo-like ids in any case and allows the made-up test ids", () => {
    const made = [...SYNTHETIC_IDS][0];
    expect(idsIn(`ok ${made} and ${made.toLowerCase()}`)).toEqual([]);
    expect(idsIn(`an id ${fake} here`)).toEqual([fake]);
    expect(idsIn(`lower ${fake.toLowerCase()}`)).toHaveLength(1);
    expect(idsIn("run_0123456789abcdef01234567 and a sha 2cd04929b9024e83e65db571cbe36aec65ead0cb")).toEqual([]);
  });
});
