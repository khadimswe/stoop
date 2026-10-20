import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { outputViews, type BriefCueView } from "./output";
import { cuesReceipt, leadScript, listWords, whyItFits, yourAdView } from "./your-ad";
import { describeRecorded, itRecorded } from "../../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describeRecorded.each(EXAMPLES.map((e) => e.slug))("Your ad for %s", (slug) => {
  const report = read(slug);
  const world = report.worlds[0];
  const outputs = outputViews(report);
  const view = yourAdView(world, outputs[0])!;
  const concept = world.pack!.concept;

  it("shows the top world's kept concept, its on-screen hook line and its first shot", () => {
    expect(view).toMatchObject({
      segmentId: world.segmentId,
      worldLabel: world.label,
      conceptTitle: concept.title,
      hook: concept.hook,
      emotion: concept.emotion,
      hookLine: concept.scenes[0].overlayText,
      opening: concept.scenes[0].action,
      clip: null,
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

  it("shows only the cues the concept uses, Qloo-backed first, music style among them", () => {
    expect(view.cues.map((c) => c.slot).sort()).toEqual([...world.concepts!.best.verifiedUses].sort());
    const backed = view.cues.filter((c) => c.receipt !== null);
    expect(view.cues.slice(0, backed.length)).toEqual(backed);
    expect(backed.find((c) => c.slot === "music")).toMatchObject({ label: "Music style", origin: "interpreted" });
    for (const cue of view.cues.filter((c) => c.receipt === null)) expect(cue.origin).not.toMatch(/^(qloo|interpreted)$/);
  });

  it("says why it fits from the Qloo-backed cues it uses and the setting city's rank", () => {
    const city = world.settingCity!;
    // The city's rank is among the whole taste neighborhood's cities (Prove), not this world's own.
    expect(view.whyItFits).toMatch(
      new RegExp(`^Music style, .* come from what Qloo measured for this world, set in ${city.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, #${city.audienceRank} of the taste neighborhood's cities by lift\\.$`),
    );
    // Creative slots (product role, talent) are never named as Qloo's.
    expect(view.whyItFits).not.toMatch(/product role|talent/i);
  });

  it("sums the receipts: one row per Qloo-backed cue, with the calls behind it", () => {
    const backed = view.cues.filter((c) => c.receipt !== null);
    expect(view.receipt).toMatchObject({ cue: "Your ad", calls: backed.reduce((n, c) => n + c.receipt!.calls, 0) });
    expect(view.receipt!.rows.map((r) => r.label)).toEqual(backed.map((c) => c.label));
    expect(view.receipt!.rows[0].value).toMatch(/ · \d+ Qloo calls?$/);
  });
});

describe("Your ad", () => {
  itRecorded("waits for a world with a concept", () => {
    const report = read("food-hot-sauce");
    const outputs = outputViews(report);
    expect(yourAdView(undefined, undefined)).toBeNull();
    expect(yourAdView({ ...report.worlds[0], concepts: null, pack: null }, outputs[0])).toBeNull();
  });

  itRecorded("falls back to the first script when there is no Meta creator script", () => {
    const kit = read("food-hot-sauce").worlds[0].kit!;
    const tiktokOnly = { ...kit, ugc: kit.ugc.filter((s) => s.platform === "tiktok") };
    expect(leadScript(tiktokOnly)?.script).toBe(tiktokOnly.ugc[0].script);
    expect(leadScript({ ...kit, ugc: [] })).toBeNull();
    expect(leadScript(null)).toBeNull();
  });

  it("joins words plainly", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["music"])).toBe("music");
    expect(listWords(["music", "look"])).toBe("music and look");
    expect(listWords(["music", "look", "setting"])).toBe("music, look and setting");
  });

  it("claims nothing without a Qloo-backed cue in use", () => {
    const cue = (over: Partial<BriefCueView>): BriefCueView => ({ slot: "music", label: "Music style", text: "x", origin: "interpreted", receipt: null, picks: [], used: true, ...over });
    const receipt = { cue: "Music style", title: "x", rows: [], calls: 2 };
    expect(whyItFits([cue({ origin: "creative" })], { label: "Slidell, LA", audienceRank: 1 })).toBeNull();
    expect(whyItFits([cue({ receipt, used: false })], null)).toBeNull();
    expect(whyItFits([cue({ receipt })], null)).toBe("Music style comes from what Qloo measured for this world.");
    expect(whyItFits([cue({ receipt }), cue({ slot: "setting.1", label: "Setting 2", receipt })], null)).toBe("Music style and setting come from what Qloo measured for this world.");
    expect(cuesReceipt([cue({ origin: "creative" })], "t")).toBeNull();
  });
});
