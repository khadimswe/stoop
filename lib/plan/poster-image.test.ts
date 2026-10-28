import { describe, expect, it } from "vitest";
import { portraitLayout, where } from "./poster-image";
import type { PosterText } from "./poster-text";

const text = (patch: Partial<PosterText> = {}): PosterText => ({
  title: "Taco Table Saturday",
  date: "Saturday, November 7",
  time: "12 to 4 pm",
  store: "Corner Wireless on Fifth",
  address: "1200 Fifth Ave, Testville, IL 60000",
  location: null,
  offers: ["$25/mo unlimited when you switch", "Free screen protector with any accessory"],
  wheel: null,
  disclaimer: "Fictional store. Not affiliated with T-Mobile.",
  ...patch,
});

describe("portraitLayout", () => {
  it("sets a few offers large, every one shown", () => {
    const layout = portraitLayout(text());
    expect(layout.shown).toBe(2);
    expect(layout.offer).toBe(36);
  });

  it("packs eight short offers and the wheel line without dropping one", () => {
    const offers = ["$25/mo unlimited when you switch", "Free 5G phone when you port in", "Free tablet with a new line", "2 lines for $50/mo", "First month free, bring your phone", "$100 off with a trade-in", "Free screen protector", "Free case with any phone"];
    const layout = portraitLayout(text({ offers, wheel: "Spin the prize wheel: store deals and free gift cards. Free to spin, no purchase needed." }));
    expect(layout.shown).toBe(8);
    expect(layout.offer).toBeLessThan(36);
  });

  it("drops whole offers from the end only when even the smallest set cannot hold them all", () => {
    const offers = Array.from({ length: 8 }, (_, i) => `Promo ${i + 1}: ${"select models, taxes and fees extra, see the store for details ".repeat(2)}`.slice(0, 140));
    const layout = portraitLayout(text({ offers, title: "Warm Plate Saturday: Smoked Brisket Sliders Next Door Now Ok", wheel: "Spin the prize wheel: store deals. Free to spin, no purchase needed." }));
    expect(layout.shown).toBeGreaterThan(0);
    expect(layout.shown).toBeLessThan(8);
    expect(layout.offer).toBe(18);
  });
});

describe("where", () => {
  it("names the store as host when the event is away from it", () => {
    expect(where(text())).toEqual({ main: "Corner Wireless on Fifth", sub: "1200 Fifth Ave, Testville, IL 60000" });
    expect(where(text({ location: "Testville Fall Fair" }))).toEqual({ main: "Testville Fall Fair", sub: "Hosted by Corner Wireless on Fifth" });
  });
});
