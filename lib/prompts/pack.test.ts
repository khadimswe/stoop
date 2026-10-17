import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conceptSchema, defaultPackSettings, productSpecSchema, type BriefSlots, type Concept, type ProductSpec } from "./brief";
import { MODELS } from "./models.config";
import { buildProductAssets, buildProductionPack, checkPack, packHashes, productionPackSchema } from "./pack";
import { estimateTokens } from "./veo";

// Hand-written inputs use only the creative origin: no fake Qloo data.
const cue = (text: string) => ({ text, origin: "creative" as const, evidenceIds: [] });
const none = { richSlots: [] };

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

  it("renders one multi-shot job for the whole ad and one job per scene for each per-scene tool", () => {
    const pack = build();
    const scenes = (family: string) => [1, 2, 3, 4].map((n) => `${family}-scene-${n}`);
    expect(pack.renders.map((r) => r.id)).toEqual(["seedance-15s", ...scenes("veo"), ...scenes("kling"), ...scenes("runway")]);
    const [multi] = pack.renders;
    expect(multi.trimTo).toBe(15);
    expect(multi.renderSeconds).toBe(15);
    const lengths = (family: string) => pack.renders.filter((r) => r.id.startsWith(`${family}-scene`)).map((s) => [s.renderSeconds, s.trimTo]);
    // Veo clips with reference images are requested at 8 s and trimmed in the edit; Kling and Runway take any length in range.
    expect(lengths("veo")).toEqual([[8, 3], [8, 4], [8, 5], [8, 3]]);
    expect(lengths("kling")).toEqual([[3, 3], [4, 4], [5, 5], [3, 3]]);
    expect(lengths("runway")).toEqual([[3, 3], [4, 4], [5, 5], [3, 3]]);
  });

  it("keeps every Seedance and Veo hash it had before the Kling and Runway jobs", () => {
    // Recorded from main (55f3205) for these exact inputs: new jobs never move an approved hash.
    const hashes = Object.fromEntries(packHashes(build()).map((h) => [h.id.split("/").pop(), h.promptHash]));
    expect(hashes).toMatchObject({
      "packshot.png": "31ce4493b149b6bc46fc1ba2c0059e217d22bac1b3df4ac03e32624d6ae71433",
      "product_sheet.png": "d34880ef46396ba5f63617f482bbf1d377f0d24f91c16efe197d81c1e361e471",
      "talent_control_sheet.png": "8748899f2970d70f2e0bddc837cec0c0ade8cc15cd11c2a3e4ee79e41a148c2d",
      "loc_control_kitchen_counter.png": "63ce61078f7cd91ee4ac71fa69cdc39d79a6f0ac850213443cceac514b66c7c0",
      "loc_control_picnic_table.png": "29b5bec6b15c22469e70b6913054987fec13e76b2a852c547c2c9290a2e9769b",
      "seedance-15s": "9e110bc55fa6f3a45dcac1e6700d9118af84af4a774a001853e82d572de69fac",
      "veo-scene-1": "fb16ebf0b45e6f06ede3263b5fa6747f22fa2ed885e4b0ae618928f4259cea44",
      "veo-scene-2": "fb16ebf0b45e6f06ede3263b5fa6747f22fa2ed885e4b0ae618928f4259cea44",
      "veo-scene-3": "b1af4aa9cbc4093c5be890e2831e133e1fbd4c187e30ba422b81516ccddaa125",
      "veo-scene-4": "2cab7c53b502ea59ba00254c985d709f352cd73d8d37a48d02da66d2754255e5",
    });
  });

  it("parses with the report's pack schema, unchanged", () => {
    const pack = build();
    expect(productionPackSchema.parse(pack)).toEqual(pack);
  });

  it("passes every deterministic check on a clean brief", () => {
    const pack = build();
    expect(checkPack(pack, brief(), product(), [], none)).toEqual([]);
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
    const capped = build().renders.filter((r) => r.kind === "scene" && MODELS[r.modelId].maxPromptTokens !== null);
    expect(capped.length).toBeGreaterThan(0);
    for (const render of capped) expect(estimateTokens(render.prompt)).toBeLessThanOrEqual(MODELS[render.modelId].maxPromptTokens as number);
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
    expect(checkPack(productOnly, brief({ talent: null }), product(), [], none)).toEqual([]);
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
    expect(checkPack(pack, brief(), withImages, [], none)).toEqual([]);
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
    const problems = checkPack(pack, brief(), product(), ["Fly By Jing"], none);
    expect(problems).toContainEqual({ where: "veo-scene-1", message: "drops the brief's mood cue" });
    expect(problems.some((p) => p.where === "seedance-15s" && p.message.includes("references"))).toBe(true);

    const placed = build({ concept: concept({ locations: [
      { slug: "kitchen-counter", description: "a Brooklyn kitchen counter", timeOfDay: "late morning", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ] }) });
    expect(checkPack(placed, brief(), product(), [], none).some((p) => p.message.includes("Brooklyn"))).toBe(true);
    // A place Qloo returned (allowedPlaces) is fine.
    const allowed = brief({ allowedPlaces: ["Brooklyn"] });
    expect(checkPack(build({ brief: allowed, concept: concept({ locations: [
      { slug: "kitchen-counter", description: "a Brooklyn kitchen counter", timeOfDay: "late morning", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ] }) }), allowed, product(), [], none)).toEqual([]);

    const named = build({ brief: brief({ setting: [cue("a counter stocked with Fly By Jing bottles")] }) });
    expect(checkPack(named, brief({ setting: [cue("a counter stocked with Fly By Jing bottles")] }), product(), ["Fly By Jing"], none).length).toBeGreaterThan(0);
  });
});

describe("chained scene jobs", () => {
  // The test concept: hook and product at the kitchen counter, cultural and payoff at the picnic table.
  const pack = build();
  const jobs = (family: string) => pack.renders.filter((r) => r.id.startsWith(`${family}-scene`));

  it("start from the location plate, then the previous scene's last frame while the location holds", () => {
    for (const family of ["kling", "runway"]) {
      expect(jobs(family).map((r) => r.startFrame)).toEqual([
        { kind: "asset", file: "loc_control_kitchen_counter.png" },
        { kind: "last-frame", job: `${family}-scene-1` },
        { kind: "asset", file: "loc_control_picnic_table.png" },
        { kind: "last-frame", job: `${family}-scene-3` },
      ]);
    }
    // Veo scenes start from the prompt, as before.
    expect(jobs("veo").every((r) => r.startFrame === null)).toBe(true);
  });

  it("hash what the start frame shows, so a changed plate or earlier take changes the job", () => {
    const moved = build({ concept: concept({ locations: [
      { slug: "kitchen-counter", description: "a sunny home kitchen counter", timeOfDay: "early evening", lighting: "soft window light" },
      { slug: "picnic-table", description: "a backyard picnic table", timeOfDay: "golden hour", lighting: "low warm sun" },
    ] }) });
    const hash = (p: typeof pack, id: string) => p.renders.find((r) => r.id === id)?.promptHash;
    expect(hash(moved, "runway-scene-1")).not.toBe(hash(pack, "runway-scene-1"));
    // Scene 2's own prompt is the same, but it starts from scene 1's last frame.
    expect(moved.renders.find((r) => r.id === "runway-scene-2")?.prompt).toBe(pack.renders.find((r) => r.id === "runway-scene-2")?.prompt);
    expect(hash(moved, "runway-scene-2")).not.toBe(hash(pack, "runway-scene-2"));
    // The picnic scenes never see the kitchen plate.
    expect(hash(moved, "runway-scene-3")).toBe(hash(pack, "runway-scene-3"));
  });

  it("lock the product and talent with Elements on Kling, and give Runway no references", () => {
    expect(jobs("kling").every((r) => r.refs.join() === "product_sheet.png,talent_control_sheet.png")).toBe(true);
    expect(jobs("runway").every((r) => r.refs.length === 0)).toBe(true);
  });

  it("write each Kling shot as action, setting, camera move and mood, then the whole brief", () => {
    const [first, , , last] = jobs("kling");
    expect(first.prompt.split("\n")[0]).toBe(
      "Shot 1 of 4, 3 seconds: the cook lifts the bottle into the light, in a sunny home kitchen counter, late morning, smooth dolly in toward the subject; mood: warm, proud weekend energy.",
    );
    expect(first.prompt).toContain("locked as the product Element from product_sheet.png");
    expect(first.prompt).toContain("locked as the character Element from talent_control_sheet.png");
    expect(first.prompt).toContain("It opens on its start frame, the empty location as in loc_control_kitchen_counter.png");
    expect(last.prompt).toContain('[The character]: "Your eggs called."');
    expect(jobs("kling")[1].prompt).toContain("the last frame of the previous shot");
  });

  it("lead each Runway prompt with the camera motion and introduce what the start frame lacks", () => {
    const [first, second] = jobs("runway");
    expect(first.prompt.split("\n")[0]).toBe("The camera dollies in toward the subject as the cook lifts the bottle into the light.");
    expect(first.prompt).toContain("The start frame shows a sunny home kitchen counter, late morning, empty, and the action enters it.");
    expect(first.prompt).toContain("Product: the small-batch hot sauce, clearly visible. It looks like this: A slim glass bottle with a red cap");
    expect(first.prompt).toContain("Pacing follows the music added in the edit: laid-back funk");
    expect(first.prompt).not.toContain(".png");
    expect(second.prompt).toContain("carries straight on from its start frame");
  });

  it("pick each renderer by template family, one job set per family", () => {
    const turbo = build({ settings: { ...defaultPackSettings(), models: { ...defaultPackSettings().models, perScene: "kling-3-turbo" } } });
    const ids = turbo.renders.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(turbo.renders.filter((r) => r.id.startsWith("kling-scene")).every((r) => r.modelId === "kling-3-turbo")).toBe(true);
    expect(ids.some((id) => id.startsWith("veo"))).toBe(false);
    expect(checkPack(turbo, brief(), product(), [], none)).toEqual([]);

    const klingAd = build({ settings: { ...defaultPackSettings(), models: { ...defaultPackSettings().models, multiShot: "kling-3" } } });
    expect(klingAd.renders[0].id).toBe("kling-15s");
    expect(klingAd.renders[0].prompt).toMatch(/^Multi-shot video, 4 custom shots, 15 seconds/);
    expect(klingAd.renders[0].prompt).toContain("Shot 3 (5 s, cultural): The cook lifts the bottle into the light, in a backyard picnic table");
    expect(checkPack(klingAd, brief(), product(), [], none)).toEqual([]);

    const settings = defaultPackSettings();
    expect(() => build({ settings: { ...settings, models: { ...settings.models, multiShot: "veo-3-1" } } })).toThrow(/no multi-shot template/);
    expect(() => build({ settings: { ...settings, models: { ...settings.models, perScene: "seedance-2-5" } } })).toThrow(/no per-scene template/);
  });

  it("list the extra scene models in the Director's Guide, with the start-frame rules", () => {
    expect(pack.directorGuide).toContain(`scene prompts for ${MODELS["kling-3"].displayName}`);
    expect(pack.directorGuide).toContain(`scene prompts for ${MODELS["runway-gen-4-5"].displayName}`);
    expect(pack.directorGuide).toMatch(/take the next scene.s start frame from the last frame you keep \(at the cut\)/);
  });
});

describe("rich slots", () => {
  it("fail a render prompt that drops one, naming the prompt and the slot", () => {
    const pack = build();
    const at = pack.renders.findIndex((r) => r.id === "kling-scene-2");
    pack.renders[at] = { ...pack.renders[at], prompt: pack.renders[at].prompt.replace(brief().music.text, "upbeat music") };
    const problems = checkPack(pack, brief(), product(), [], { richSlots: ["music", "setting.1"] });
    expect(problems).toContainEqual({ where: "kling-scene-2", message: `the ${MODELS["kling-3"].displayName} scene 2 prompt drops the music cue Qloo backed richly` });
    // The coverage check still reports the same drop in its own words.
    expect(problems).toContainEqual({ where: "kling-scene-2", message: "drops the brief's music cue" });
    expect(problems.filter((p) => p.message.includes("richly"))).toHaveLength(1);
    expect(checkPack(build(), brief(), product(), [], { richSlots: ["music", "setting.1", "visual"] })).toEqual([]);
  });

  it("name the multi-shot prompt and the setting by its place in the brief", () => {
    const pack = build();
    pack.renders[0] = { ...pack.renders[0], prompt: pack.renders[0].prompt.replace(/a backyard picnic table/gi, "a yard") };
    const rich = checkPack(pack, brief(), product(), [], { richSlots: ["setting.1"] }).filter((p) => p.message.includes("richly"));
    expect(rich).toEqual([{ where: "seedance-15s", message: `the ${MODELS["seedance-2-5"].displayName} multi-shot prompt drops the second setting cue Qloo backed richly` }]);
  });

  it("flag a rich slot the brief does not carry, and skip talent when no talent is cast", () => {
    expect(checkPack(build(), brief(), product(), [], { richSlots: ["setting.2"] })).toEqual([
      { where: "brief", message: "Qloo backed the third setting richly, but the brief carries no third setting cue" },
    ]);
    const productOnly = build({ settings: defaultPackSettings({ cast: "product_only" }) });
    expect(checkPack(productOnly, brief(), product(), [], { richSlots: ["talent"] })).toEqual([]);
  });
});

describe("start frames", () => {
  it("must name an asset of the pack or an earlier job, and Runway always needs one", () => {
    const pack = build();
    const index = (id: string) => pack.renders.findIndex((r) => r.id === id);
    pack.renders[index("runway-scene-1")] = { ...pack.renders[index("runway-scene-1")], startFrame: null };
    pack.renders[index("kling-scene-2")] = { ...pack.renders[index("kling-scene-2")], startFrame: { kind: "last-frame", job: "kling-scene-3" } };
    pack.renders[index("kling-scene-3")] = { ...pack.renders[index("kling-scene-3")], startFrame: { kind: "asset", file: "loc_control_beach.png" } };
    expect(checkPack(pack, brief(), product(), [], none)).toEqual([
      { where: "kling-scene-2", message: "starts from the last frame of kling-scene-3, which does not come before it" },
      { where: "kling-scene-3", message: "starts from loc_control_beach.png, which the pack does not have" },
      { where: "runway-scene-1", message: "needs a start frame: text-to-video renders 16:9 only" },
    ]);
  });

  it("parse with the report's pack schema", () => {
    const pack = build({ product: product({ source: { kind: "images", images: [{ url: "https://shop.example.com/cdn/bottle-front.jpg", showsPerson: false }] } }) });
    expect(productionPackSchema.parse(pack)).toEqual(pack);
    expect(pack.renders.find((r) => r.id === "kling-scene-1")?.refs).toEqual(["product_photo_1.jpg", "talent_control_sheet.png"]);
    expect(checkPack(pack, brief(), product({ source: { kind: "images", images: [{ url: "https://shop.example.com/cdn/bottle-front.jpg", showsPerson: false }] } }), [], none)).toEqual([]);
  });
});

describe("a product known only from the brand's photos", () => {
  const photos = product({ source: { kind: "images", images: [{ url: "https://shop.example.com/cdn/bottle-front.jpg", showsPerson: false }] } });

  it("gets no Runway scene prompts, since Runway would invent the product, and the guide says why", () => {
    const pack = build({ product: photos });
    expect(pack.renders.some((r) => r.id.startsWith("runway"))).toBe(false);
    expect(pack.renders.some((r) => r.id.startsWith("kling-scene"))).toBe(true);
    expect(pack.directorGuide).toContain(`No scene prompts for ${MODELS["runway-gen-4-5"].displayName}: it takes no reference images`);
  });

  it("fails the check when a model without references is chosen for it anyway", () => {
    const settings = defaultPackSettings();
    const pack = build({ product: photos, settings: { ...settings, models: { ...settings.models, perScene: "runway-gen-4-5" } } });
    const problems = checkPack(pack, brief(), photos, [], none);
    expect(problems.filter((p) => p.where.startsWith("runway"))).toHaveLength(4);
    expect(problems[0].message).toMatch(/known only from the brand's photos, so the model would invent its look/);
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
