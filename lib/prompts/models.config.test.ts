import { describe, expect, it } from "vitest";
import { ENERGIES, LOOKS } from "../types";
import {
  CAMERA_PRESET_IDS,
  CAMERA_PRESETS,
  ENERGY_PRESETS,
  getModel,
  LOOK_PRESETS,
  MODEL_IDS,
  MODELS,
  modelConfigSchema,
  renderLength,
  ROLE_DEFAULTS,
  TEMPLATE_FAMILIES,
  type ModelConfig,
} from "./models.config";

const EM_DASH = String.fromCharCode(0x2014);
const rows = () => Object.values(MODELS);
const withRow = (patch: Partial<ModelConfig>) => ({ ...getModel("veo-3-1"), ...patch });

describe("model rows", () => {
  it("parses every row with the schema", () => {
    for (const row of rows()) expect(modelConfigSchema.safeParse(row).success, row.id).toBe(true);
  });

  it("has one row per id, keyed by its own id", () => {
    expect(Object.keys(MODELS).sort()).toEqual([...MODEL_IDS].sort());
    for (const [key, row] of Object.entries(MODELS)) expect(row.id).toBe(key);
    expect(new Set(rows().map((r) => r.id)).size).toBe(MODEL_IDS.length);
  });

  it("uses every template family", () => {
    const used = new Set(rows().map((r) => r.template));
    for (const family of TEMPLATE_FAMILIES) expect(used.has(family), family).toBe(true);
  });

  it("cites only https sources", () => {
    for (const row of rows()) {
      expect(row.sourceUrls.length).toBeGreaterThan(0);
      for (const url of row.sourceUrls) expect(new URL(url).protocol, `${row.id}: ${url}`).toBe("https:");
    }
  });

  it("contains no em dash", () => {
    expect(JSON.stringify(MODELS)).not.toContain(EM_DASH);
    expect(JSON.stringify(CAMERA_PRESETS)).not.toContain(EM_DASH);
  });

  it("rejects inconsistent rows", () => {
    expect(modelConfigSchema.safeParse(withRow({ kind: "image" })).success).toBe(false);
    expect(modelConfigSchema.safeParse(withRow({ supportsImageRefs: false })).success).toBe(false);
    expect(modelConfigSchema.safeParse(withRow({ refsRequireDuration: 5 })).success).toBe(false);
    expect(modelConfigSchema.safeParse(withRow({ sourceUrls: ["http://example.com"] })).success).toBe(false);
    expect(modelConfigSchema.safeParse({ ...withRow({}), extra: true }).success).toBe(false);
  });

  it("returns rows by id", () => {
    expect(getModel("seedance-2-5").displayName).toBe(MODELS["seedance-2-5"].displayName);
  });
});

describe("renderLength", () => {
  const veo = getModel("veo-3-1");
  const seedance = getModel("seedance-2-5");

  it("picks the shortest fixed Veo length that holds the scene", () => {
    expect(renderLength(veo, 5, { hasRefs: false })).toBe(6);
    expect(renderLength(veo, 4, { hasRefs: false })).toBe(4);
  });

  it("forces 8 s when Veo gets reference images", () => {
    expect(renderLength(veo, 5, { hasRefs: true })).toBe(8);
  });

  it("throws past the model maximum", () => {
    expect(() => renderLength(veo, 9, { hasRefs: false })).toThrow(/at most 8 s/);
  });

  it("rounds up and clamps range models", () => {
    expect(renderLength(seedance, 15, { hasRefs: false })).toBe(15);
    expect(renderLength(seedance, 3, { hasRefs: false })).toBe(4);
    expect(renderLength(seedance, 7.2, { hasRefs: true })).toBe(8);
  });

  it("throws for image models and for references a model cannot take", () => {
    expect(() => renderLength(getModel("nano-banana-pro"), 5, { hasRefs: false })).toThrow(/image model/);
    expect(() => renderLength(getModel("veo-3-1-fast"), 5, { hasRefs: true })).toThrow(/reference/);
  });
});

describe("presets", () => {
  it("gives every camera preset a phrasing for every template family", () => {
    expect(Object.keys(CAMERA_PRESETS).sort()).toEqual([...CAMERA_PRESET_IDS].sort());
    for (const id of CAMERA_PRESET_IDS) {
      const preset = CAMERA_PRESETS[id];
      expect(preset.label.trim(), id).not.toBe("");
      expect(preset.description.trim(), id).not.toBe("");
      for (const family of TEMPLATE_FAMILIES) {
        const phrase = preset.phrasing[family];
        expect(phrase.trim(), `${id}/${family}`).not.toBe("");
        expect(phrase.endsWith("."), `${id}/${family} ends with a period`).toBe(false);
      }
    }
  });

  it("covers every look, with lens and grain only for camera looks", () => {
    expect(Object.keys(LOOK_PRESETS).sort()).toEqual([...LOOKS].sort());
    expect(LOOK_PRESETS.auto.globalStyle).toBe("");
    for (const look of LOOKS.filter((l) => l !== "auto")) expect(LOOK_PRESETS[look].globalStyle, look).not.toBe("");
    expect(LOOK_PRESETS.live_action.keepsLensAndGrain).toBe(true);
    for (const look of ["animation_2d", "animation_3d", "stop_motion", "illustrated"] as const) {
      expect(LOOK_PRESETS[look].keepsLensAndGrain, look).toBe(false);
    }
  });

  it("covers every energy", () => {
    expect(Object.keys(ENERGY_PRESETS).sort()).toEqual([...ENERGIES].sort());
    expect(ENERGY_PRESETS.auto.pacing).toBe("");
    for (const energy of ENERGIES.filter((e) => e !== "auto")) expect(ENERGY_PRESETS[energy].pacing, energy).not.toBe("");
  });
});

describe("role defaults", () => {
  it("points each role at a model of the right kind", () => {
    expect(getModel(ROLE_DEFAULTS.image).kind).toBe("image");
    expect(getModel(ROLE_DEFAULTS.multiShotVideo).kind).toBe("video");
    expect(getModel(ROLE_DEFAULTS.perSceneVideo).kind).toBe("video");
  });

  it("renders the 15 s ad as one multi-shot clip", () => {
    const model = getModel(ROLE_DEFAULTS.multiShotVideo);
    expect(model.multiShot).toBe(true);
    expect(model.durations?.max ?? 0).toBeGreaterThanOrEqual(15);
    expect(model.aspectRatios).toContain("9:16");
  });
});
