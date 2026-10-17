import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EXAMPLES } from "../demo/examples";
import { approvalsSchema, demoMediaFor, manifestSchema } from "../demo/manifest";

// load.ts is server only (the reports must never reach a client bundle); the guard itself throws
// outside a React Server Components build, so the test stubs it.
vi.mock("server-only", () => ({}));
const { isExampleSlug, loadExampleMedia, loadExampleReport } = await import("./load");

const onDisk = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as unknown;
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown;

describe("the example loader", () => {
  it.each(EXAMPLES.map((e) => e.slug))("loads %s from its static import, parsed once", (slug) => {
    const report = loadExampleReport(slug);
    expect(report.meta).toMatchObject({ id: `example-${slug}`, kind: "example", provenance: "recorded" });
    // The same report the API routes read from disk (lib/runtime/examples.ts).
    expect(report).toEqual(onDisk(slug));
    expect(loadExampleReport(slug)).toBe(report);
  });

  it("knows only the shipped examples", () => {
    for (const { slug } of EXAMPLES) expect(isExampleSlug(slug)).toBe(true);
    for (const slug of ["", "food", "example-food-hot-sauce", "../food-hot-sauce"]) expect(isExampleSlug(slug)).toBe(false);
  });

  it("shows only the media the founder approved", () => {
    const manifest = manifestSchema.parse(json("public/demo/manifest.json"));
    const approvals = approvalsSchema.parse(json("public/demo/approvals.json"));
    for (const { slug } of EXAMPLES) expect(loadExampleMedia(slug)).toEqual(demoMediaFor(manifest, approvals, slug));
  });
});
