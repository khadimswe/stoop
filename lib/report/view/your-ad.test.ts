import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { outputViews } from "./output";
import { leadScript, yourAdView } from "./your-ad";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("Your ad for %s", (slug) => {
  const report = read(slug);
  const world = report.worlds[0];
  const outputs = outputViews(report, { renderAccess: { kind: "off" } });
  const view = yourAdView(world, outputs[0])!;

  it("shows the top world's kept concept", () => {
    expect(view).toMatchObject({
      segmentId: world.segmentId,
      worldLabel: world.label,
      conceptTitle: world.pack!.concept.title,
      hook: world.pack!.concept.hook,
      emotion: world.pack!.concept.emotion,
    });
  });

  it("copies the same prompt and shows the same storyboard as the Output section", () => {
    expect(view.prompt).toEqual(outputs[0].export?.multiShot);
    expect(view.storyboard).toEqual(outputs[0].storyboard);
  });

  it("copies the Meta creator script, spoken as the brand", () => {
    const script = world.kit!.ugc.find((s) => s.tool === "creator" && s.platform === "meta")!;
    expect(view.script).toMatchObject({ tool: "creator", platform: "meta", script: script.script, cta: script.cta });
    expect(view.script?.formatLabel).toMatch(/^[A-Z]/);
  });
});

describe("Your ad", () => {
  it("waits for a world with a concept", () => {
    const report = read("food-hot-sauce");
    const outputs = outputViews(report, { renderAccess: { kind: "off" } });
    expect(yourAdView(undefined, undefined)).toBeNull();
    expect(yourAdView({ ...report.worlds[0], concepts: null, pack: null }, outputs[0])).toBeNull();
  });

  it("falls back to the first script when there is no Meta creator script", () => {
    const kit = read("food-hot-sauce").worlds[0].kit!;
    const tiktokOnly = { ...kit, ugc: kit.ugc.filter((s) => s.platform === "tiktok") };
    expect(leadScript(tiktokOnly)?.script).toBe(tiktokOnly.ugc[0].script);
    expect(leadScript({ ...kit, ugc: [] })).toBeNull();
    expect(leadScript(null)).toBeNull();
  });
});
