import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORE_STORY, TABLE_PHOTO, storyLines } from "./pilot";

const DASH = String.fromCharCode(0x2014);

describe("the story band", () => {
  it("builds the big line and the story from the same numbers, so a correction is one edit", () => {
    const { headline, body } = storyLines({ bought: 60, item: "slices of pizza", came: "About 12", lesson: "The rest stays.", credit: "Someone" });
    expect(headline).toBe("60 slices of pizza. About 12 people.");
    expect(body).toBe("A few weeks ago, our store bought 60 slices of pizza for an event. About 12 people came all day. The rest stays.");
  });

  it("tells the founder's story in plain words: the community, never a shopper's identity, a carrier or a dash", () => {
    expect(STORE_STORY).not.toBeNull();
    const { headline, body } = storyLines(STORE_STORY!);
    expect(headline).toBe("100 ice creams. About 5 people.");
    expect(body).toContain("Knowing what the community wants");
    for (const text of [headline, body, STORE_STORY!.credit]) {
      expect(text).not.toMatch(/\bblock\b|your customers/i);
      expect(text.includes(DASH)).toBe(false);
    }
  });

  it("captions the real photo with the not-affiliated line, and the file it names is in public/", () => {
    expect(TABLE_PHOTO).not.toBeNull();
    expect(TABLE_PHOTO!.caption).toMatch(/Stoop is independent and isn't affiliated with T-Mobile\.$/);
    expect(TABLE_PHOTO!.alt.length).toBeGreaterThan(20);
    // The public mirror leaves pilot media out, so the file is checked only where it ships.
    if (existsSync("public/pilot/README.md") && existsSync("data/plans")) expect(existsSync(`public${TABLE_PHOTO!.src}`)).toBe(true);
  });
});
