import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conceptSchema, defaultPackSettings, productSpecSchema, type BriefSlots, type Concept, type ProductSpec } from "./brief";
import { MODELS } from "./models.config";
import { buildProductAssets, buildProductionPack, checkPack, packHashes, productionPackSchema } from "./pack";
import { estimateTokens } from "./veo";

// Hand-written inputs use only the creative origin: no fake Qloo data.
const cue = (text: string) => ({ text, origin: "creative" as const, evidenceIds: [] });

const product = (overrides: Partial<ProductSpec> = {}): ProductSpec =>
  productSpecSchema.parse({
    slug: "test-sauce",
    name: "small-batch hot sauce",
    brandName: null,
    oneLine: "A bright, smoky hot sauce made in small batches.",
    source: { kind: "description", lookDescription: "A slim glass bottle with a red cap and a cream paper label showing a simple flame symbol." },
    ...overrides,
  });

const brief = (overrides: Partial<BriefSlots> = {}): BriefSlots => ({
  segment: { id: "control", label: "LLM-only brief", ageBands: ["30_to_34"] },
  productRole: cue("drizzled over eggs at the counter, then tasted straight from the spoon"),
  mood: cue("warm, proud weekend energy"),
  music: cue("laid-back funk with a dusty drum break, about 92 bpm"),
  visual: cue("warm golden grade, 35mm look, light film grain, handheld close-ups"),
  wardrobe: cue("relaxed denim and a rolled-sleeve work shirt"),
  setting: [cue("a sunny home kitchen counter"), cue("a backyard picnic table")],
  voice: { tone: cue("confident and playful"), use: ["bold"], avoid: ["extreme"] },
  talent: cue("an adult home cook in their thirties with an easy smile"),
  hooks: [cue("The bottle tips and the room goes quiet")],
  allowedPlaces: [],
  ...overrides,
});

const scene = (beat: Concept["scenes"][number]["beat"], seconds: number, location = "kitchen-counter") => ({
  beat,
  seconds,
  action: "The cook lifts the bottle into the light",
  camera: "dolly_in" as const,
  framing: "tight medium close-up",
  motion: "a slow, deliberate pour",
  lighting: "late morning sun through the window",
  productVisible: true,
  location,
  overlayText: beat === "hook" ? "Wait for it" : null,
  dialogue: beat === "payoff" ? "Your eggs called." : null,
  sound: "sizzling pan and a soft room tone",
});

const concept = (overrides: Partial<Concept> = {}): Concept =>
  conceptSchema.parse({
    title: "The quiet pour",
    hook: "A single drop lands on a fried egg in extreme close-up; on-screen line: Wait for it",
    emotion: "pride",
    surpriseBeat: "the whole table leans in at once",
    locations: [
      { slug: "kitchen-counter", description: "a sunny home kitchen counter", timeOfDay: "late morning", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ],
    scenes: [scene("hook", 3), scene("product", 4), scene("cultural", 5, "picnic-table"), scene("payoff", 3, "picnic-table")],
    ...overrides,
  });

const build = (overrides: { product?: ProductSpec; brief?: BriefSlots; concept?: Concept; settings?: ReturnType<typeof defaultPackSettings> } = {}) =>
  buildProductionPack({
    product: overrides.product ?? product(),
    brief: overrides.brief ?? brief(),
    concept: overrides.concept ?? concept(),
    settings: overrides.settings ?? defaultPackSettings(),
  });

describe("buildProductionPack", () => {
  it("names assets with the fixed filenames", () => {
    const pack = build();
    expect(pack.assets.map((a) => a.file)).toEqual([
      "packshot.png",
      "product_sheet.png",
      "talent_control_sheet.png",
      "loc_control_kitchen_counter.png",
      "loc_control_picnic_table.png",
    ]);
  });

  it("renders one multi-shot job for the whole ad and one job per scene", () => {
    const pack = build();
    expect(pack.renders.map((r) => r.id)).toEqual(["seedance-15s", "veo-scene-1", "veo-scene-2", "veo-scene-3", "veo-scene-4"]);
    const [multi, ...scenes] = pack.renders;
    expect(multi.trimTo).toBe(15);
    expect(multi.renderSeconds).toBe(15);
    // Per-scene clips with reference images are requested at 8 s and trimmed in the edit.
    expect(scenes.map((s) => [s.renderSeconds, s.trimTo])).toEqual([
      [8, 3],
      [8, 4],
      [8, 5],
      [8, 3],
    ]);
  });

  it("parses with the report's pack schema, unchanged", () => {
    const pack = build();
    expect(productionPackSchema.parse(pack)).toEqual(pack);
  });

  it("passes every deterministic check on a clean brief", () => {
    const pack = build();
    expect(checkPack(pack, brief(), product(), [])).toEqual([]);
  });

  it("keeps the multi-shot sections in the guide's order", () => {
    const prompt = build().renders[0].prompt;
    const order = ["GLOBAL STYLE", "SCENE", "CHARACTERS", "LOCATION", "FIRST FRAME AND BLOCKING", "SHOTS", "OPTICS/CAMERA", "PHYSICS", "LIGHTING", "AUDIO"];
    const positions = order.map((title) => prompt.indexOf(`${title}\n`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(prompt).toMatch(/0\.0s to 3\.0s \(hook\)/);
    expect(prompt).toMatch(/Hard cut\./);
    expect(prompt).toContain("@product_sheet (product_sheet.png)");
    expect(prompt).toContain("No logos except the product's own.");
  });

  it("writes positive-style prompts without negations", () => {
    const pack = build();
    const positive = [
      ...pack.renders.filter((r) => MODELS[r.modelId].exclusionStyle === "positive").map((r) => r.prompt),
      ...pack.assets.filter((a) => MODELS[a.modelId].exclusionStyle === "positive").map((a) => a.prompt),
    ];
    expect(positive.length).toBeGreaterThan(0);
    for (const prompt of positive) expect(prompt).not.toMatch(/\b(?:no|not|never|without|avoid)\b/i);
  });

  it("keeps per-scene prompts under the model's token cap", () => {
    for (const render of build().renders.filter((r) => r.kind === "scene")) {
      const cap = MODELS[render.modelId].maxPromptTokens as number;
      expect(estimateTokens(render.prompt)).toBeLessThanOrEqual(cap);
    }
  });

  it("carries the location rule on every plate", () => {
    for (const plate of build().assets.filter((a) => a.kind === "location")) {
      expect(plate.prompt).toMatch(/Empty of people, text and logos|No people, no text, no logos/);
    }
  });

  it("skips the talent sheet for product-only and pet ads", () => {
    const petPack = build({ settings: defaultPackSettings({ cast: "pet" }) });
    expect(petPack.assets.some((a) => a.kind === "talent_sheet")).toBe(false);
    expect(petPack.renders[0].prompt).toContain("A real pet that behaves like a real animal and never talks.");
    expect(petPack.checklist.some((item) => item.when === "pet")).toBe(true);

    const productOnly = build({ brief: brief({ talent: null }) });
    expect(productOnly.cast).toBe("product_only");
    expect(productOnly.assets.some((a) => a.kind === "talent_sheet")).toBe(false);
    expect(checkPack(productOnly, brief({ talent: null }), product(), [])).toEqual([]);
  });

  it("puts look and energy into GLOBAL STYLE and hashes them", () => {
    const plain = build();
    const animated = build({ settings: defaultPackSettings({ look: "animation_3d", energy: "upbeat" }) });
    const style = animated.renders[0].prompt.split("\n\nSCENE")[0];
    expect(style).toContain("Stylized 3D animation");
    expect(style).toContain("Palette, grade and pacing taken from this visual language");
    expect(style).toContain("Brisk pacing");
    expect(animated.renders[0].promptHash).not.toBe(plain.renders[0].promptHash);
    expect(animated.settingsHash).not.toBe(plain.settingsHash);
  });

  it("shares product assets and settings between the Control and a culture pack", () => {
    const control = build();
    const culture = build({
      brief: brief({
        segment: { id: "segment-a", label: "Segment A", ageBands: ["25_to_29"] },
        mood: cue("quiet, focused late-night energy"),
      }),
    });
    const productAssets = (pack: typeof control) => pack.assets.filter((a) => a.kind === "packshot" || a.kind === "product_sheet");
    expect(productAssets(culture)).toEqual(productAssets(control));
    expect(culture.settingsHash).toBe(control.settingsHash);
    expect(culture.renders[0].promptHash).not.toBe(control.renders[0].promptHash);
  });

  it("is deterministic", () => {
    expect(packHashes(build())).toEqual(packHashes(build()));
  });
});

describe("source images", () => {
  const withImages = product({
    source: {
      kind: "images",
      images: [
        { url: "https://shop.example.com/cdn/bottle-front.jpg", showsPerson: false },
        { url: "https://shop.example.com/cdn/model-holding-bottle.jpg", showsPerson: true },
      ],
    },
  });

  it("uses the brand's own product-only photos directly for a photo-real look", () => {
    expect(buildProductAssets(withImages, defaultPackSettings())).toEqual([]);
    const pack = build({ product: withImages });
    expect(pack.sourcePhotos).toEqual([{ file: "product_photo_1.jpg", url: "https://shop.example.com/cdn/bottle-front.jpg" }]);
    expect(pack.renders[0].refs[0]).toBe("product_photo_1.jpg");
    expect(pack.renders[0].prompt).toContain("@product_photo_1 (product_photo_1.jpg)");
    expect(pack.renders[1].prompt).toContain("product_photo_1.jpg");
    expect(checkPack(pack, brief(), withImages, [])).toEqual([]);
  });

  it("redraws the exact product from product-only photos only for an animated look", () => {
    const assets = buildProductAssets(withImages, defaultPackSettings({ look: "animation_2d" }));
    expect(assets.map((a) => a.file)).toEqual(["product_sheet.png"]);
    expect(assets[0].prompt).toContain("Redraw this exact small-batch hot sauce");
    expect(assets[0].refs).toEqual(["https://shop.example.com/cdn/bottle-front.jpg"]);
  });

  it("adds the source-photo checklist item and never uses a photo of a person", () => {
    const pack = build({ product: withImages });
    expect(pack.checklist.some((item) => item.when === "source-images")).toBe(true);
    expect(JSON.stringify(pack)).not.toContain("model-holding-bottle");
  });

  it("rejects a product whose photos all show a person", () => {
    expect(() =>
      product({ source: { kind: "images", images: [{ url: "https://shop.example.com/cdn/model.jpg", showsPerson: true }] } }),
    ).toThrow(/product-only photo/);
  });
});

describe("segment-scoped assets", () => {
  it("gives two segments that pick the same location their own plates and approval ids", () => {
    const control = build();
    const culture = build({ brief: brief({ segment: { id: "segment-a", label: "Segment A", ageBands: ["25_to_29"] } }) });
    const plates = (pack: typeof control) => pack.assets.filter((a) => a.kind === "location").map((a) => a.file);
    expect(plates(control)).toEqual(["loc_control_kitchen_counter.png", "loc_control_picnic_table.png"]);
    expect(plates(culture)).toEqual(["loc_segment_a_kitchen_counter.png", "loc_segment_a_picnic_table.png"]);
    const ids = new Set([...packHashes(control), ...packHashes(culture)].map((h) => h.id));
    // Shared product assets appear once; everything else is distinct.
    expect(ids.size).toBe(packHashes(control).length + packHashes(culture).length - 2);
  });
});

describe("avoid lists", () => {
  it("never reach a render or asset prompt", () => {
    const avoiding = brief({ voice: { tone: cue("confident and playful"), use: ["bold"], avoid: ["fake urgency countdowns"] } });
    const pack = build({ brief: avoiding });
    for (const text of [...pack.renders.map((r) => r.prompt), ...pack.assets.map((a) => a.prompt)]) {
      expect(text).not.toContain("fake urgency countdowns");
    }
    expect(pack.shotList).toContain("fake urgency countdowns");
  });
});

describe("checkPack", () => {
  it("flags a dropped cue, a real name and too many references", () => {
    const pack = build();
    pack.renders[1] = { ...pack.renders[1], prompt: pack.renders[1].prompt.replace(brief().mood.text, "moody") };
    pack.renders[0] = { ...pack.renders[0], refs: Array.from({ length: 40 }, (_, i) => `ref_${i}.png`).concat("product_sheet.png") };
    const problems = checkPack(pack, brief(), product(), ["Fly By Jing"]);
    expect(problems).toContainEqual({ where: "veo-scene-1", message: "drops the brief's mood cue" });
    expect(problems.some((p) => p.where === "seedance-15s" && p.message.includes("references"))).toBe(true);

    const placed = build({ concept: concept({ locations: [
      { slug: "kitchen-counter", description: "a Brooklyn kitchen counter", timeOfDay: "late morning", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ] }) });
    expect(checkPack(placed, brief(), product(), []).some((p) => p.message.includes("Brooklyn"))).toBe(true);
    // A place Qloo returned (allowedPlaces) is fine.
    const allowed = brief({ allowedPlaces: ["Brooklyn"] });
    expect(checkPack(build({ brief: allowed, concept: concept({ locations: [
      { slug: "kitchen-counter", description: "a Brooklyn kitchen counter", timeOfDay: "late morning", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ] }) }), allowed, product(), [])).toEqual([]);

    const named = build({ brief: brief({ setting: [cue("a counter stocked with Fly By Jing bottles")] }) });
    expect(checkPack(named, brief({ setting: [cue("a counter stocked with Fly By Jing bottles")] }), product(), ["Fly By Jing"]).length).toBeGreaterThan(0);
  });
});

describe("templates", () => {
  it("never name a model outside models.config.ts", () => {
    const dir = path.join(process.cwd(), "lib/prompts");
    const names = Object.values(MODELS).map((m) => m.displayName);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file === "models.config.ts") continue;
      // Header comments may cite a vendor's guide; code and prompt text may not name a model.
      const code = readFileSync(path.join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const name of names) expect(code, `${file} names ${name}`).not.toContain(name);
    }
  });
});
