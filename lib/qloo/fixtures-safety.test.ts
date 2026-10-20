// Gitleaks cannot read inside .json.gz files, so every fixture (plain or gzipped) is checked here
// for anything key-like before it can be committed. The recorder also refuses to write a file that
// contains the live key; this test needs no key.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { RATE_LIMIT_HEADERS } from "./constants";
import { FIXTURES_DIR, loadFixtures } from "./fixtures";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const texts = ifRecorded(() => readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json") || f.endsWith(".json.gz"))
  .map((f) => {
    const raw = readFileSync(path.join(FIXTURES_DIR, f));
    return { file: f, text: f.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8") };
  }));

// The same patterns as .gitleaks.toml, plus the header name itself.
const SECRET_PATTERNS = [
  /qloo[_-]?api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i,
  /["']x-api-key["']\s*:\s*["'][A-Za-z0-9_-]{16,}["']/i,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /x-api-key/i,
];

describeRecorded("committed fixtures", () => {
  it("exist", () => {
    expect(texts.length).toBeGreaterThan(5);
  });

  it.each(texts.map((t) => [t.file, t.text] as const))("%s holds nothing key-like", (_file, text) => {
    for (const pattern of SECRET_PATTERNS) expect(pattern.test(text)).toBe(false);
  });

  it("keep only Qloo's rate-limit headers", () => {
    const allowed = new Set<string>(RATE_LIMIT_HEADERS);
    for (const fixture of loadFixtures()) {
      for (const request of fixture.requests) {
        for (const name of Object.keys(request.headers ?? {})) expect(allowed.has(name)).toBe(true);
      }
    }
  });
});
