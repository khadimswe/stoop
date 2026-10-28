import { describe, expect, it } from "vitest";
import { eventUrl, facebookShareUrl, instagramCopy, posterUrl, shareLinks, whatsappMessage, whatsappShareUrl } from "./share";

describe("share links", () => {
  it("points at the public event page, encoding the id", () => {
    expect(eventUrl("https://stoop.test/", "ex-chicago-pilsen")).toBe("https://stoop.test/e/ex-chicago-pilsen");
    expect(eventUrl("https://stoop.test", "a/b?c")).toBe("https://stoop.test/e/a%2Fb%3Fc");
  });

  it("builds the Facebook sharer with the event URL as one encoded parameter", () => {
    const url = facebookShareUrl("https://stoop.test/e/run_1?x=1&y=2");
    expect(url).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fstoop.test%2Fe%2Frun_1%3Fx%3D1%26y%3D2");
    expect(new URL(url).searchParams.get("u")).toBe("https://stoop.test/e/run_1?x=1&y=2");
  });

  it("builds wa.me with the message plus the URL, every character encoded", () => {
    const text = "Tacos & music at the table! $25/mo unlimited. 100% #local? Yes: see you\nSaturday";
    const url = whatsappShareUrl(text, "https://stoop.test/e/run_1");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url.slice("https://wa.me/?text=".length)).not.toMatch(/[\s&#?$/:]/);
    const decoded = new URL(url).searchParams.get("text");
    expect(decoded).toBe(`${text}\n\nhttps://stoop.test/e/run_1`);
    expect(decoded).toBe(whatsappMessage(text, "https://stoop.test/e/run_1"));
    // The text parameter is the only one: an ampersand or hash in the message cannot split it.
    expect([...new URL(url).searchParams.keys()]).toEqual(["text"]);
    expect(new URL(url).hash).toBe("");
  });

  it("gives both links from the page origin", () => {
    const links = shareLinks("https://stoop.test", "run_1", { whatsapp: { text: "See you there." } });
    expect(new URL(links.facebook!).searchParams.get("u")).toBe("https://stoop.test/e/run_1");
    expect(new URL(links.whatsapp!).searchParams.get("text")).toBe("See you there.\n\nhttps://stoop.test/e/run_1");
  });

  it("points variant B at its own event page and poster", () => {
    expect(eventUrl("https://stoop.test", "plan_1", "b")).toBe("https://stoop.test/e/plan_1?variant=b");
    expect(posterUrl("https://stoop.test", "plan_1", "og", "b")).toBe("https://stoop.test/api/plan/plan_1/marketing/poster.png?size=og&variant=b");
    const links = shareLinks("https://stoop.test", "plan_1", { whatsapp: { text: "B." } }, "b");
    expect(new URL(links.facebook!).searchParams.get("u")).toBe("https://stoop.test/e/plan_1?variant=b");
  });

  it("serves the poster at its two sizes", () => {
    expect(posterUrl("https://stoop.test", "ex-a")).toBe("https://stoop.test/api/plan/ex-a/marketing/poster.png");
    expect(posterUrl("https://stoop.test", "ex-a", "og")).toBe("https://stoop.test/api/plan/ex-a/marketing/poster.png?size=og");
  });

  it("copies the Instagram caption with its hashtags, since Instagram has no web share", () => {
    expect(instagramCopy({ instagram: { caption: "Saturday at the table.", hashtags: ["Testville", "#ShopLocal"] } })).toBe("Saturday at the table.\n\n#Testville #ShopLocal");
    expect(instagramCopy({ instagram: { caption: "Saturday.", hashtags: [] } })).toBe("Saturday.");
  });
});
