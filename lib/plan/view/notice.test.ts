import { describe, expect, it } from "vitest";
import { noticeCopy, parsePlanNotice, splitMessage, standInBar } from "./notice";

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
      body: "So this is a full example plan for West End Wireless, a store in Atlanta, GA. It was not planned for Corner Wireless. The steps above (Community, Create, Poster and Promote) open West End Wireless's pages.",
    });
  });

  it("says so plainly when the example is the store that asked", () => {
    expect(noticeCopy({ message: MESSAGE, from: { name: "West End Wireless", city: "Atlanta, GA" } }, { storeName: "West End Wireless", cityLine: "Atlanta, GA" }).body).toMatch(/recorded for West End Wireless/);
  });
});

describe("standInBar", () => {
  const notice = { slug: "atlanta-west-end", from: { name: "Corner Wireless", city: "Macon, GA" }, back: "/start?resume=1" };
  it("keeps the way back to the store that asked, on every page of the example that stood in", () => {
    expect(standInBar(notice, { slug: "atlanta-west-end", storeName: "West End Wireless" })).toEqual({ text: "West End Wireless is an example store. Your store: Corner Wireless.", back: "/start?resume=1", yours: "Corner Wireless" });
  });
  it("stays away from other examples, and from an example's own plan", () => {
    expect(standInBar(notice, { slug: "chicago-18th-street", storeName: "18th Street Wireless" })).toBeNull();
    expect(standInBar({ ...notice, from: { name: "west end wireless ", city: "Atlanta, GA" } }, { slug: "atlanta-west-end", storeName: "West End Wireless" })).toBeNull();
    expect(standInBar(null, { slug: "atlanta-west-end", storeName: "West End Wireless" })).toBeNull();
  });
  it("keeps a dismissed note, and never a way back off the site", () => {
    expect(parsePlanNotice(JSON.stringify({ ...notice, message: MESSAGE, dismissed: true }))?.dismissed).toBe(true);
    expect(parsePlanNotice(JSON.stringify({ ...notice, message: MESSAGE, back: "//elsewhere.example" }))?.back).toBe("/start");
  });
});

describe("splitMessage", () => {
  it("splits at the first sentence", () => {
    expect(splitMessage("Live maps are off right now. Here's an example community to look around.")).toEqual({ title: "Live maps are off right now.", rest: "Here's an example community to look around." });
    expect(splitMessage("One line")).toEqual({ title: "One line", rest: null });
  });
});
