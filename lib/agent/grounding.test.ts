// The grounding guard and craft, on real recorded candidates: the hot sauce example's 35 to 44 world
// (data/runs/food-hot-sauce/run.report.json), whose sources are what Qloo returned for it. The one
// below-median pick is real too: the generic brief's "Soul - Funk", which beats 0 of 19 reference
// music tags for this world.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Report } from "../report/schema";
import { craftWorld, signalOf } from "../stages/craft";
import type { CultureCandidate } from "../stages/culture";
import { CANDIDATES } from "../demo/candidates";
import { sellerText } from "../prompts/brief";
import { candidateProduct } from "./baseline-brief";
import { guardBrief, type BriefSubmission } from "./grounding";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const report = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report);
const world = ifRecorded(() => report.worlds.find((w) => w.segmentId === "seg-35-to-44")!);
const fieldOf = { music: "music", visual: "visual", wardrobe: "wardrobe", setting: "setting", mood: "mood", voice: "mood", creators: "creators" } as const;
const candidates: CultureCandidate[] = ifRecorded(() => world.culture!.flatMap((f) =>
  f.field === "voice" ? [] : f.sources.map((s) => ({ ...s, field: fieldOf[f.field], details: [], why: s.why })),
));
const soulFunk = ifRecorded(() => world.check!.picks.find((p) => p.from === "control" && p.name === "Soul - Funk")!);
const belowMedian: CultureCandidate = ifRecorded(() => ({ kind: "tag", id: soulFunk.id, name: soulFunk.name, type: soulFunk.type, field: "music", rank: 1, position: soulFunk.position, why: [], details: [], evidenceIds: soulFunk.evidenceIds }));
const ids = (field: CultureCandidate["field"]) => candidates.filter((c) => c.field === field).map((c) => c.id);
const names = ifRecorded(() => candidates.filter((c) => c.kind === "entity").map((c) => c.name));
// The founder's own words about the hot sauce, the only product facts wording may state.
const seller = sellerText(candidateProduct(CANDIDATES.find((c) => c.slug === "food-hot-sauce")!));
const ctx = ifRecorded(() => ({ candidates: [...candidates, belowMedian], names, allowedPlaces: ["Baton Rouge, LA"], talent: true, sellerText: seller }));

const submission = (overrides: Partial<BriefSubmission> = {}): BriefSubmission => ({
  music: { text: "Roots americana with a soulful edge, brushed drums, mid tempo.", cites: ids("music").slice(0, 3) },
  visual: { text: "Warm naturalistic grade, light grain, steady handheld close-ups.", cites: ids("visual").slice(0, 3) },
  wardrobe: { text: "Worn-in chambray and a canvas apron, no logos.", cites: ids("wardrobe").slice(0, 2) },
  setting: [{ text: "A neighborhood coffee counter in Baton Rouge at breakfast.", cites: ids("setting").slice(0, 1) }],
  mood: { text: "Fresh, thoughtful and a little wry.", cites: ids("mood").slice(0, 2) },
  voice: { tone: { text: "Dry and conversational, short lines.", cites: ids("mood").slice(0, 1) }, use: ["small batch"], avoid: ["insane heat"] },
  talent: { text: "A fictional adult with an easygoing, unfussy look.", cites: ids("wardrobe").slice(0, 1) },
  productRole: "The bottle finishes the plate.",
  hooks: ["This goes first."],
  creators: { text: "Dry-humored food storytellers.", cites: ids("creators").slice(0, 2) },
  ...overrides,
});

describeRecorded("guardBrief", () => {
  it("passes a brief that cites this world's candidates and names nothing", () => {
    const result = guardBrief(submission(), ctx);
    expect(result.problems).toEqual([]);
    expect(result.brief.music?.cites.map((c) => c.id)).toEqual(ids("music").slice(0, 3));
  });

  it("drops a pick below the panel median and says so (the self-critique)", () => {
    const result = guardBrief(submission({ music: { text: "Funk with a tight drum break.", cites: [soulFunk.id, ids("music")[0]] } }), ctx);
    expect(result.belowMedian.map((c) => c.name)).toEqual(["Soul - Funk"]);
    expect(result.problems[0]).toMatch(/Soul - Funk ranks below the panel median for this world \(beats 0 of 19\)/);
    expect(result.brief.music?.cites.map((c) => c.id)).toEqual([ids("music")[0]]);
  });

  it("refuses an id that is not this world's, or one that backs another field", () => {
    const result = guardBrief(submission({ music: { text: "Roots americana.", cites: ["NOT-A-CANDIDATE", ids("visual")[0]] } }), ctx);
    expect(result.problems).toEqual([
      "music: cites an id that is not one of this world's candidates",
      expect.stringMatching(/^music: cites .+, which backs visual, not music$/),
    ]);
    expect(result.brief.music?.cites).toEqual([]);
  });

  it("refuses wording that names a real artist, film or brand, and keeps the setting city", () => {
    const artist = candidates.find((c) => c.field === "music" && c.kind === "entity")!.name;
    const result = guardBrief(submission({ music: { text: `Music like ${artist}, warm and loose.`, cites: ids("music").slice(0, 2) } }), ctx);
    expect(result.problems.some((p) => p.startsWith("music:") && p.includes(artist))).toBe(true);
    expect(result.brief.music).toBeNull();
    expect(result.brief.setting[0].text).toContain("Baton Rouge");
  });

  it("refuses notes about labels, which would reach the prompts", () => {
    const result = guardBrief(submission({ visual: { text: "Handheld, 35mm feel (lens is interpretation).", cites: ids("visual").slice(0, 2) } }), ctx);
    expect(result.problems).toEqual(["visual: leave out notes about labels or interpretation; write only the direction itself"]);
  });

  it("drops talent for product-only and pet ads, and strips quotes the model wraps around a line", () => {
    const result = guardBrief(submission({ productRole: '"The bottle finishes the plate."' }), { ...ctx, talent: false });
    expect(result.brief.talent).toBeNull();
    expect(result.problems).toContain("talent: this ad has no on-screen person (product-only or pet), so leave talent null");
    expect(result.brief.productRole).toBe("The bottle finishes the plate.");
  });

  it("refuses a product fact the seller never gave, and keeps the ones they did", () => {
    const invented = guardBrief(submission({ productRole: "The bottle finishes the plate, and it is gluten free with a 12-month shelf life." }), ctx);
    expect(invented.problems).toEqual(expect.arrayContaining([expect.stringContaining("\"gluten free\" is a product fact"), expect.stringContaining("\"12-month\" is a product fact")]));
    const given = guardBrief(submission({ productRole: "A 5 oz bottle, made in small batches, at $14." }), ctx);
    expect(given.problems).toEqual([]);
  });

  it("refuses a setting that invites children into frame", () => {
    const result = guardBrief(submission({ setting: [{ text: "A family friendly park in Baton Rouge.", cites: ids("setting").slice(0, 1) }] }), ctx);
    expect(result.problems).toEqual([expect.stringContaining("\"family friendly\" invites children into frame")]);
  });

  it("lets an avoid list name banned claims in order to forbid them", () => {
    const result = guardBrief(submission({ voice: { tone: submission().voice.tone, use: [], avoid: ["best seller", "sold out"] } }), ctx);
    expect(result.problems).toEqual([]);
    expect(result.brief.voice.avoid).toEqual(["best seller", "sold out"]);
  });
});

describeRecorded("craftWorld", () => {
  const craft = (overrides: Partial<BriefSubmission> = {}) =>
    craftWorld({ segmentId: world.segmentId, label: world.label, bucket: "35_to_44", brief: guardBrief(submission(overrides), ctx).brief, settingCity: world.settingCity, productLine: "A fermented red chile hot sauce." });

  it("labels Qloo-backed wording interpreted, with the receipts of what it cites", () => {
    const { brief } = craft();
    expect(brief.music.origin).toBe("interpreted");
    expect(brief.music.evidenceIds.length).toBeGreaterThan(0);
    expect(brief.productRole.origin).toBe("creative");
    expect(brief.hooks.every((h) => h.origin === "creative")).toBe(true);
    expect(brief.allowedPlaces).toEqual(["Baton Rouge, LA"]);
  });

  it("shows a field with nothing cited as no signal, carrying only a creative suggestion", () => {
    const { brief, culture } = craft({ wardrobe: { text: "Worn-in chambray.", cites: [] } });
    expect(brief.wardrobe?.origin).toBe("creative");
    expect(culture.find((f) => f.field === "wardrobe")).toMatchObject({ signal: "none", sources: [] });
  });

  it("marks a slot rich only when 3 strong Qloo picks back it, and only then requires it in every prompt", () => {
    const { culture, richSlots } = craft();
    expect(culture.find((f) => f.field === "music")?.signal).toBe("rich");
    expect(richSlots).toContain("music");
    expect(culture.find((f) => f.field === "wardrobe")?.signal).not.toBe("none");
    const thin = craft({ music: { text: "Roots americana.", cites: ids("music").slice(0, 1) } });
    expect(thin.culture.find((f) => f.field === "music")?.signal).toBe("thin");
    expect(thin.richSlots).not.toContain("music");
  });

  it("counts a place as strong only when Qloo explained it", () => {
    const places = candidates.filter((c) => c.field === "setting");
    expect(signalOf(places.slice(0, 3).map((p) => ({ ...p, why: [] })))).toBe("thin");
    expect(signalOf([])).toBe("none");
  });
});
