import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PILOT_RESULT, PILOT_RESULT_LABEL, STORE_STORY, STORY_PHOTO, TABLE_PHOTO, storyLines } from "./pilot";

const DASH = String.fromCharCode(0x2014);

describe("the story band", () => {
  it("fills the numbers into the story, so a correction is one edit", () => {
    const { headline, body } = storyLines({ headline: "Big line.", before: "It was slow, and", bought: 60, item: "slices of pizza", came: "about 12", after: "The rest stays.", credit: "Someone" });
    expect(headline).toBe("Big line.");
    expect(body).toBe("It was slow, and 60 slices of pizza drew about 12 people. The rest stays.");
  });

  it("tells the founder's story in plain words: the community, never a shopper's identity or a dash", () => {
    expect(STORE_STORY).not.toBeNull();
    const { headline, body } = storyLines(STORE_STORY!);
    expect(headline).toBe("Going outside works. Guessing doesn't.");
    expect(body).toContain("In Kennesaw the same table got walked past, and 100 ice creams drew about 5 people. The budget wasn't the problem. Knowing the community was.");
    for (const text of [headline, body, STORE_STORY!.credit]) {
      expect(text).not.toMatch(/\bblock\b|your customers/i);
      expect(text.includes(DASH)).toBe(false);
    }
  });

  it("states the first table's result as what was seen that day, never as Stoop's doing, and always with its label", () => {
    if (!PILOT_RESULT) return;
    expect(PILOT_RESULT.line).not.toMatch(/stoop|because|thanks to|drove|caused/i);
    // Percentages only: no device counts.
    expect(PILOT_RESULT.line).not.toMatch(/\b\d+\s+(phones|devices|lines|sales)\b/i);
    expect(PILOT_RESULT_LABEL).toMatch(/One day: a first look, not proof\.$/);
    for (const text of [PILOT_RESULT.line, PILOT_RESULT_LABEL]) expect(text.includes(DASH)).toBe(false);
  });

  it("captions the ice cream day snapshot in the founder's words, and its file is in public/", () => {
    expect(STORY_PHOTO).not.toBeNull();
    expect(STORY_PHOTO!.caption).toBe("The ice cream day, a few weeks ago. The truck was great. Our guess about the community wasn't.");
    expect(STORY_PHOTO!.caption.includes(DASH)).toBe(false);
    if (existsSync("data/plans")) expect(existsSync(`public${STORY_PHOTO!.src}`)).toBe(true);
  });

  it("captions the real photo as the table Stoop planned, with the not-affiliated line, and the file it names is in public/", () => {
    expect(TABLE_PHOTO).not.toBeNull();
    expect(TABLE_PHOTO!.caption).toMatch(/^Kennesaw, GA, Oct 30, 2026: the table Stoop planned, outside our store\. Stoop is independent and isn't affiliated with T-Mobile\.$/);
    expect(TABLE_PHOTO!.alt.length).toBeGreaterThan(20);
    // The public mirror leaves pilot media and the recorded data out, so the file is checked only where it ships.
    if (existsSync("data/plans")) expect(existsSync(`public${TABLE_PHOTO!.src}`)).toBe(true);
  });
});
