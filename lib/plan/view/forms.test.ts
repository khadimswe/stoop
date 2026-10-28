import { describe, expect, it } from "vitest";
import { inputsSchema } from "../schema";
import { ageBandsText, distanceText, eventDate, fictionalNotice, timeOfDay, timeRange, usd } from "./format";
import { parseResults } from "./results-form";
import { emptyStoreForm, firstError, nextSaturday, parseStoreForm, storeSlug, type StoreFormValues } from "./start-form";

function filled(overrides: Partial<StoreFormValues> = {}): StoreFormValues {
  return {
    ...emptyStoreForm(),
    storeName: "Corner Wireless",
    address: "1800 W 18th St",
    city: "Chicago",
    region: "IL",
    lat: "41.8576",
    lon: "-87.6566",
    date: "2026-11-07",
    ...overrides,
  };
}

describe("the store form", () => {
  it("builds plan inputs the contract accepts, offers word for word", () => {
    const result = parseStoreForm(filled({ offers: ["  $25 unlimited with port-in ", "", "Free case with any phone"], notes: " Saturday crowd is families " }), "2026-10-28");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(inputsSchema.parse(result.inputs)).toEqual(result.inputs);
    expect(result.inputs.store).toEqual({
      id: "corner-wireless-chicago",
      name: "Corner Wireless",
      carrier: "metro",
      address: "1800 W 18th St",
      city: "Chicago",
      region: "IL",
      point: { lat: 41.8576, lon: -87.6566 },
    });
    expect(result.inputs.offers).toEqual([{ text: "$25 unlimited with port-in" }, { text: "Free case with any phone" }]);
    expect(result.inputs.notes).toBe("Saturday crowd is families");
    expect(result.inputs).toMatchObject({ durationMinutes: 240, budgetUsd: 50, setting: "sidewalk_table", ageBands: ["25_to_29", "30_to_34"] });
  });

  it("says what is missing in plain words, and the first error leads", () => {
    const result = parseStoreForm({ ...emptyStoreForm(), date: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.storeName).toBe("Enter the store name.");
    expect(result.errors.point).toMatch(/Use my location/);
    expect(result.errors.date).toBe("Pick the event day.");
    expect(firstError(result.errors)).toBe("storeName");
  });

  it("rejects bad coordinates, past dates, budgets over the cap and too many age bands", () => {
    const result = parseStoreForm(
      filled({ lat: "141", lon: "abc", date: "2026-10-01", budgetUsd: "9000", ageBands: ["24_and_younger", "25_to_29", "30_to_34", "35_to_44"] }),
      "2026-10-28",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["ageBands", "budgetUsd", "date", "lat", "lon"]);
  });

  it("takes up to 8 promos, the store's whole list", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `Promo ${i + 1}`);
    const result = parseStoreForm(filled({ offers: eight }));
    expect(result.ok && result.inputs.offers.map((o) => o.text)).toEqual(eight);
  });

  it("keeps notes and offers inside their limits", () => {
    const result = parseStoreForm(filled({ notes: "x".repeat(281), offers: ["y".repeat(141), "", ""] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.notes).toBe("Keep notes to 280 characters.");
    expect(result.errors.offer0).toBe("Keep each promo to 140 characters.");
  });

  it("finds the next Saturday and makes a clean store id", () => {
    expect(nextSaturday(new Date(2026, 9, 28))).toBe("2026-10-31");
    expect(nextSaturday(new Date(2026, 9, 31))).toBe("2026-10-31");
    expect(storeSlug("Café Móvil #2", "San José")).toBe("cafe-movil-2-san-jose");
    expect(storeSlug("!!!", "")).toBe("store");
  });
});

describe("the results form", () => {
  const base = { walkIns: "", sales: "", facebook: false, instagram: false, whatsapp: false, notes: "" };

  it("sends counts, channels and a note", () => {
    expect(parseResults({ ...base, walkIns: "42", sales: "3", facebook: true, notes: " busy at 2 " })).toEqual({
      ok: true,
      body: { walkIns: 42, sales: 3, posted: { facebook: true, instagram: false, whatsapp: false }, notes: "busy at 2" },
    });
  });

  it("asks for something before saving, and whole numbers only", () => {
    expect(parseResults(base)).toMatchObject({ ok: false, errors: { walkIns: expect.stringMatching(/at least one/) } });
    expect(parseResults({ ...base, walkIns: "4.5", sales: "-1" })).toMatchObject({ ok: false, errors: { walkIns: expect.any(String), sales: expect.any(String) } });
  });
});

describe("plan formatters", () => {
  it("prints the day, times, money and distance the same everywhere", () => {
    expect(eventDate("2026-11-07")).toBe("Saturday, Nov 7");
    expect(eventDate("2026-11-07", "short")).toBe("Sat, Nov 7");
    expect(timeRange("12:00", 240)).toBe("12 to 4 pm");
    expect(timeRange("11:30", 150)).toBe("11:30 am to 2 pm");
    expect(timeOfDay("09:05")).toBe("9:05 am");
    expect(usd(150)).toBe("$150");
    expect(distanceText(347)).toBe("350 m");
    expect(distanceText(1500)).toBe("1.5 km");
    expect(distanceText(2000)).toBe("2 km");
  });

  it("shows adult age bands, the youngest as 18 to 24", () => {
    expect(ageBandsText(["24_and_younger", "25_to_29"])).toBe("18 to 24 and 25 to 29");
    expect(ageBandsText(["24_and_younger", "25_to_29", "30_to_34"])).toBe("18 to 24, 25 to 29 and 30 to 34");
  });

  it("says every example store is fictional and not endorsed", () => {
    expect(fictionalNotice("metro")).toBe("Fictional store. Not affiliated with or endorsed by T-Mobile.");
  });
});
