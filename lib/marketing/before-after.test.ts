import { describe, expect, it } from "vitest";
import { AI_PREVIEW_LABEL, beforeAfterItems } from "./before-after";
import { BEFORE_AFTER } from "./pilot";

const photos = {
  before: { src: "/pilot/before.jpg", alt: "A folding table with balloons", caption: "A usual Friday table" },
  after: { src: "/pilot/after.jpg", alt: "The table with hot drinks and a prize wheel", caption: "The table Stoop planned" },
};

describe("the before and after slot", () => {
  it("renders nothing until the founder sets it", () => {
    expect(beforeAfterItems(null)).toEqual([]);
    // Shipped off: no photos are on the site until he has them.
    expect(BEFORE_AFTER).toBeNull();
  });

  it("labels the two photos Before and After, with their captions", () => {
    const items = beforeAfterItems(photos);
    expect(items.map((i) => [i.label, i.caption])).toEqual([
      ["Before", "A usual Friday table"],
      ["After", "The table Stoop planned"],
    ]);
  });

  it("always shows an AI preview's label, in the picture's tag and its text alternative", () => {
    for (const alt of ["The planned table at dusk", "AI preview of the table", "ai preview: the table"]) {
      const preview = beforeAfterItems({ ...photos, preview: { src: "/pilot/preview.jpg", alt } }).at(-1)!;
      expect(preview.key).toBe("preview");
      expect(preview.label).toBe(AI_PREVIEW_LABEL);
      expect(preview.alt.toLowerCase().startsWith("ai preview")).toBe(true);
      expect(preview.caption).toMatch(/not a photo/);
    }
  });
});
