// The recorded Qloo data, and the data built from it, that a build and the end-to-end tests need.
// Qloo's hackathon developer guide asks that Qloo response data stay out of public repositories, so
// the public mirror of this repository leaves these files out (public-mirror.exclude lists every
// excluded path). There, `next build` and `npm run e2e` stop at once with one message instead of
// failing halfway, and README.md ("Data and the Qloo API") explains how to record your own.
// Node built-ins and the example list only: next.config.ts and playwright.config.ts load this module.
import { existsSync } from "node:fs";
import path from "node:path";
import { EXAMPLES } from "./demo/examples";

/** What the pages and API routes read: the stored examples, the frozen panels, the reference audiences, the /mcp session. */
export const BUILD_DATA_FILES: readonly string[] = [
  ...EXAMPLES.flatMap(({ slug }) => [`data/runs/${slug}/run.report.json`, `data/runs/${slug}/run.events.json`]),
  "data/culture/panels.json",
  "data/geo/reference-heatmap.json",
  "data/marketing/mcp-session.json",
];

/** The end-to-end tests also replay two recorded Qloo fixtures (the /start seed search). */
export const E2E_DATA_FILES: readonly string[] = [...BUILD_DATA_FILES, "fixtures/pool-resolve.json", "fixtures/probe-search.json"];

export const RECORDED_DATA_HELP = 'Qloo response data is not stored in the public repository. See "Data and the Qloo API" in README.md to record your own with a Qloo API key.';

/** The listed files missing under `root`. */
export function missingFiles(files: readonly string[], root = process.cwd()): string[] {
  return files.filter((file) => !existsSync(path.join(root, file)));
}

/** One message naming what stopped and why. */
export function missingDataMessage(what: string, missing: readonly string[]): string {
  return [`${what} needs Stoop's recorded Qloo data, and ${missing.length} of its files are missing:`, ...missing.map((file) => `  ${file}`), RECORDED_DATA_HELP].join("\n");
}
