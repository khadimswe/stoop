import { describe, expect, it } from "vitest";
import { noticeCopy, parsePlanNotice, splitMessage } from "./notice";

const MESSAGE = "Live plans are off right now. Here is a full example plan instead.";

describe("parsePlanNotice", () => {
  it("reads the Create step's note", () => {
    const raw = JSON.stringify({ message: MESSAGE, slug: "atlanta-west-end", from: { name: "Corner Wireless", city: "Macon, GA" }, back: "/start" });
    expect(parsePlanNotice(raw)).toEqual({ message: MESSAGE, slug: "atlanta-west-end", from: { name: "Corner Wireless", city: "Macon, GA" }, back: "/start" });
  });

  it("reads an older plain message, and nothing else", () => {
    expect(parsePlanNotice(MESSAGE)).toEqual({ message: MESSAGE, slug: null, from: null, back: "/start" });
    expect(parsePlanNotice(null)).toBeNull();
    expect(parsePlanNotice("{broken")).toBeNull();
    expect(parsePlanNotice(JSON.stringify({ message: "x", slug: "a", back: "https://elsewhere.example" }))?.back).toBe("/start");
  });
});

describe("noticeCopy", () => {
  it("names the example store and city, and the store that asked", () => {
    expect(noticeCopy({ message: MESSAGE, from: { name: "Corner Wireless", city: "Macon, GA" } }, { storeName: "West End Wireless", cityLine: "Atlanta, GA" })).toEqual({
      title: "Live plans are off right now.",
      body: "So this is a full example plan for West End Wireless, a store in Atlanta, GA. It was not planned for Corner Wireless.",
    });
  });

  it("says so plainly when the example is the store that asked", () => {
    expect(noticeCopy({ message: MESSAGE, from: { name: "West End Wireless", city: "Atlanta, GA" } }, { storeName: "West End Wireless", cityLine: "Atlanta, GA" }).body).toMatch(/recorded for West End Wireless/);
  });
});

describe("splitMessage", () => {
  it("splits at the first sentence", () => {
    expect(splitMessage("Live maps are off right now. Here's an example community to look around.")).toEqual({ title: "Live maps are off right now.", rest: "Here's an example community to look around." });
    expect(splitMessage("One line")).toEqual({ title: "One line", rest: null });
  });
});
