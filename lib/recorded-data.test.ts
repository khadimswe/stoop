// What a build and e2e say when the recorded Qloo data is absent (the public mirror), checked against
// an empty folder so it runs here too, where the data is present.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_DATA_FILES, E2E_DATA_FILES, missingDataMessage, missingFiles } from "./recorded-data";

describe("the recorded data a build needs", () => {
  it("lists the stored examples, the panels, the reference audiences and the /mcp session, and e2e adds two recordings", () => {
    expect(BUILD_DATA_FILES).toContain("data/runs/food-hot-sauce/run.report.json");
    expect(BUILD_DATA_FILES).toContain("data/culture/panels.json");
    expect(BUILD_DATA_FILES).toContain("data/geo/reference-heatmap.json");
    expect(BUILD_DATA_FILES).toContain("data/marketing/mcp-session.json");
    expect(E2E_DATA_FILES.filter((f) => !BUILD_DATA_FILES.includes(f))).toEqual(["fixtures/pool-resolve.json", "fixtures/probe-search.json"]);
  });

  it("names every missing file and points to the README", () => {
    const root = mkdtempSync(path.join(tmpdir(), "stoop-no-data-"));
    try {
      expect(missingFiles(BUILD_DATA_FILES, root)).toEqual(BUILD_DATA_FILES);
      mkdirSync(path.join(root, "data", "culture"), { recursive: true });
      writeFileSync(path.join(root, "data", "culture", "panels.json"), "{}");
      const missing = missingFiles(BUILD_DATA_FILES, root);
      expect(missing).not.toContain("data/culture/panels.json");
      const message = missingDataMessage("next build", missing);
      expect(message.split("\n")[0]).toBe(`next build needs Stoop's recorded Qloo data, and ${missing.length} of its files are missing:`);
      for (const file of missing) expect(message).toContain(`  ${file}`);
      expect(message).toContain('"Data and the Qloo API" in README.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
