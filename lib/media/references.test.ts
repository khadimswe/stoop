import { describe, expect, it } from "vitest";
import { assetKind, fitPrompt, mapReferences, orderReferences } from "./references";

const PROMPT = [
  "CHARACTERS",
  "@talent_seg_55_and_older_sheet (talent_seg_55_and_older_sheet.png): An original fictional adult.",
  "@product_sheet (product_sheet.png): the small-batch hot sauce, identical in every shot.",
  "",
  "LOCATION",
  "@loc_seg_55_and_older_sandwich_counter (loc_seg_55_and_older_sandwich_counter.png): A casual sandwich counter.",
  "",
  "SHOTS",
  "0.0s to 3.0s (hook): A slow pour, at @loc_seg_55_and_older_sandwich_counter (loc_seg_55_and_older_sandwich_counter.png). @product_sheet (product_sheet.png) is clearly visible. Hard cut.",
].join("\n");

const product = { role: "product" as const, scene: null, url: "https://stoop.example/demo/packshot.webp" };
const frame = (scene: number) => ({ role: "frame" as const, scene, url: `https://blob.example/frames/${scene}.png` });

describe("reference mapping", () => {
  it("knows the pack's fixed filenames", () => {
    expect(assetKind("product_sheet.png")).toBe("product");
    expect(assetKind("packshot.png")).toBe("product");
    expect(assetKind("product_photo_2.jpg")).toBe("product");
    expect(assetKind("talent_seg_30_to_34_sheet.png")).toBe("talent");
    expect(assetKind("loc_control_home_kitchen_counter.png")).toBe("location");
    expect(assetKind("notes.png")).toBe("other");
  });

  it("numbers the product first, then the storyboard frames by shot", () => {
    expect(orderReferences([frame(2), frame(0), product, frame(1)]).map((r) => r.url)).toEqual([product.url, frame(0).url, frame(1).url, frame(2).url]);
    const mapped = mapReferences(PROMPT, [frame(1), product, frame(0)], { productName: "small-batch hot sauce" });
    expect(mapped.imageUrls).toEqual([product.url, frame(0).url, frame(1).url]);
    expect(mapped.images.map((i) => i.handle)).toEqual(["@Image1", "@Image2", "@Image3"]);
    expect(mapped.prompt.startsWith("REFERENCES\n@Image1: the small-batch hot sauce, the same shape, colors and label in every shot.\n@Image2 to @Image3: storyboard frames for shots 1 to 2, in order.")).toBe(true);
    expect(mapReferences(PROMPT, [frame(0), frame(3)], { productName: "x" }).prompt).toContain("Storyboard frames: @Image1 for shot 1, @Image2 for shot 4. Match their framing, setting and light.");
  });

  it("points the product's files at @Image1 and rewrites sheets that were never rendered into words", () => {
    const { prompt } = mapReferences(PROMPT, [product, frame(0)], { productName: "small-batch hot sauce" });
    expect(prompt).toContain("\nThe character: An original fictional adult.");
    expect(prompt).toContain("\n@Image1: the small-batch hot sauce, identical in every shot.");
    expect(prompt).toContain("\nThe location: A casual sandwich counter.");
    expect(prompt).toContain("A slow pour, at the location. @Image1 is clearly visible. Hard cut.");
    expect(prompt).not.toMatch(/@(?!Image\d)/);
    expect(prompt).not.toMatch(/\.(png|jpe?g|webp)\b/);
  });

  it("names the product in words when there is no product image", () => {
    const { prompt, imageUrls } = mapReferences(PROMPT, [frame(0)], { productName: "small-batch hot sauce" });
    expect(imageUrls).toEqual([frame(0).url]);
    expect(prompt).toContain("@Image1: the storyboard frame for shot 1.");
    expect(prompt).toContain("\nThe product: the small-batch hot sauce, identical in every shot.");
    expect(prompt).toContain("The product is clearly visible.");
  });

  it("numbers several locations by first mention, the same in the LOCATION block and the shots", () => {
    const text = "LOCATION\n@loc_a_window (loc_a_window.png): A window seat.\n@loc_a_lawn (loc_a_lawn.png): A lawn.\nShot 2 at @loc_a_lawn (loc_a_lawn.png), then @loc_a_window (loc_a_window.png).";
    const { prompt } = mapReferences(text, [frame(0)], { productName: "pet hat" });
    expect(prompt).toContain("\nLocation 1: A window seat.\nLocation 2: A lawn.\nShot 2 at location 2, then location 1.");
  });

  it("fits fal's limit by dropping only the fixed camera and physics boilerplate, and only when it must", () => {
    const text = ["GLOBAL STYLE\nVertical.", "SHOTS\nShot 1.", "OPTICS/CAMERA\nCamera moves as listed.", "PHYSICS\nReal weight.", "AUDIO\nMusic."].join("\n\n");
    expect(fitPrompt(text, 1_000)).toBe(text);
    expect(fitPrompt(text, text.length - 10)).toBe(["GLOBAL STYLE\nVertical.", "SHOTS\nShot 1.", "PHYSICS\nReal weight.", "AUDIO\nMusic."].join("\n\n"));
    expect(fitPrompt(text, 40)).toBe(["GLOBAL STYLE\nVertical.", "SHOTS\nShot 1.", "AUDIO\nMusic."].join("\n\n"));
  });

  it("is deterministic, and leaves prompts without handles as they are", () => {
    expect(mapReferences(PROMPT, [product, frame(0)], { productName: "x" })).toEqual(mapReferences(PROMPT, [product, frame(0)], { productName: "x" }));
    expect(mapReferences("Plain words. Email me @ noon.", [frame(0)], { productName: "x" }).prompt.endsWith("Plain words. Email me @ noon.")).toBe(true);
  });
});
