import { describe, expect, it } from "vitest";
import { AA, contrastRatio } from "../design/contrast";
import { CARRIER_PALETTES, fitHeadline, MAX_DEAL_CARDS, portraitLayout, posterImage, POSTER_SIZES, where } from "./poster-image";
import type { PosterText } from "./poster-text";

const text = (patch: Partial<PosterText> = {}): PosterText => {
  const offers = patch.offers ?? ["$25/mo unlimited when you switch", "Free screen protector with any accessory"];
  return {
    title: "Taco Table Saturday",
    date: "Saturday, November 7",
    time: "12 to 4 pm",
    store: "Corner Wireless on Fifth",
    address: "1200 Fifth Ave, Testville, IL 60000",
    phone: null,
    location: null,
    wheel: null,
    wheelWhat: null,
    carrier: "metro",
    disclaimer: "Fictional store. Not affiliated with T-Mobile.",
    ...patch,
    offers,
    deals: patch.deals ?? offers.map((o) => ({ label: o.split(" ").slice(0, 2).join(" "), text: o })),
  };
};

const pngSize = async (response: Response) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe("the carrier palettes", () => {
  it("keeps every text color at AA on the ground and on the cards", () => {
    for (const [carrier, p] of Object.entries(CARRIER_PALETTES)) {
      for (const fg of [p.text, p.muted, p.primary, p.accent, p.accent2, p.hot]) {
        for (const bg of [p.ground, p.ground2, p.card]) expect(contrastRatio(fg, bg), `${carrier}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(AA.text);
      }
    }
  });

  it("leads with purple for Metro, green for Cricket and orange for Boost", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return { r: r!, g: g!, b: b! };
    };
    const metro = hue(CARRIER_PALETTES.metro.primary);
    expect(metro.b > metro.g && metro.r > metro.g).toBe(true);
    const cricket = hue(CARRIER_PALETTES.cricket.primary);
    expect(cricket.g > cricket.r && cricket.g > cricket.b).toBe(true);
    const boost = hue(CARRIER_PALETTES.boost.primary);
    expect(boost.r > boost.g && boost.g > boost.b).toBe(true);
  });
});

describe("fitHeadline", () => {
  it("keeps the title whole at the largest size that fits", () => {
    expect(fitHeadline("Taco Table Saturday", 960, [150, 120])).toEqual({ text: "Taco Table Saturday", size: 150 });
  });

  it("shortens only when even the smallest size cannot hold it: before a colon first, else whole words", () => {
    const long = "Warm Plate Saturday: Smoked Brisket Sliders Next Door With Music And Cider All Afternoon Long";
    expect(fitHeadline(long, 960, [150, 120, 88]).text).toBe("Warm Plate Saturday");
    const noColon = "Smoked Brisket Sliders Next Door With Hot Cider Hand Warmers And Music All Afternoon Long";
    const short = fitHeadline(noColon, 960, [150, 120, 88]);
    expect(noColon.startsWith(short.text)).toBe(true);
    expect(short.text.length).toBeLessThan(noColon.length);
  });
});

describe("portraitLayout", () => {
  it("shows up to 4 deal cards and counts the rest", () => {
    const six = ["$25/mo unlimited", "Free 5G phone", "Free tablet with a new line", "2 lines for $50/mo", "First month free", "$100 off with a trade-in"];
    const layout = portraitLayout(text({ offers: six, wheel: "Spin the prize wheel: store deals. Free to spin, no purchase needed.", wheelWhat: "Store deals" }));
    expect(layout.shown).toBe(MAX_DEAL_CARDS);
    expect(layout.headline.text).toBe("Taco Table Saturday");
  });

  it("draws no cards without offers", () => {
    expect(portraitLayout(text({ offers: [] })).shown).toBe(0);
  });
});

describe("posterImage", () => {
  it("draws every carrier, with a logo, a phone and an event away from the store, at both sizes", async () => {
    const logo = { dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", width: 600, height: 160 };
    for (const carrier of ["metro", "cricket", "boost", "other"] as const) {
      const t = text({ carrier, phone: "(312) 555-0142", location: carrier === "boost" ? "East End Fair" : null, wheel: "Spin the prize wheel: store deals. Free to spin, no purchase needed.", wheelWhat: "Store deals" });
      expect(await pngSize(posterImage(t, null, "portrait", {}, carrier === "metro" ? logo : null))).toEqual(POSTER_SIZES.portrait);
      expect(await pngSize(posterImage(t, null, "og"))).toEqual(POSTER_SIZES.og);
    }
  });
});

describe("where", () => {
  it("prints the phone next to the address, and names the store as host when the event is away from it", () => {
    expect(where(text())).toEqual({ main: "Corner Wireless on Fifth", sub: "1200 Fifth Ave, Testville, IL 60000" });
    expect(where(text({ phone: "(312) 555-0142" })).sub).toBe("1200 Fifth Ave, Testville, IL 60000 · (312) 555-0142");
    expect(where(text({ location: "Testville Fall Fair" }))).toEqual({ main: "Testville Fall Fair", sub: "Hosted by Corner Wireless on Fifth" });
  });
});
