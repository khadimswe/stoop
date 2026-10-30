import { describe, expect, it } from "vitest";
import { safeTitle } from "./concepts";
import { textIssues } from "./guard";
import { mostPlayedMix } from "./prompt";
import type { PlanInputs } from "./schema";
import { genreOrSlang, titleGenre, VOLUME_FRAMING } from "./words";

const ctx = { offers: [], budgetUsd: 50, known: new Set<string>() };

describe("genres and slang in plan copy", () => {
  it.each(["Trap Friday Wheel Spin", "Southern hip-hop on the sidewalk", "A drill set", "Hood block party"])("flags %s", (text) => {
    expect(genreOrSlang(text)).not.toBeNull();
    expect(textIssues(text, ctx).join(" ")).toMatch(/never names a music genre/);
  });
  it("leaves plain words alone", () => {
    expect(genreOrSlang("Wrap up at four; the neighborhood park is close")).toBeNull();
    expect(genreOrSlang("A playlist of the city's most-played artists on Qloo")).toBeNull();
  });
  it("keeps any genre out of a title or hook", () => {
    expect(titleGenre("Soul Saturday Table")).toBe("soul");
    expect(titleGenre("Country Night at the Booth")).toBe("country");
    expect(titleGenre("Halloween Friday Wheel Spin")).toBeNull();
  });
  it("never frames music by how far it carries", () => {
    expect(VOLUME_FRAMING.test("Bass you can hear from down the block")).toBe(true);
    expect(VOLUME_FRAMING.test("loud enough to carry across the fair")).toBe(true);
    expect(textIssues("Southern beats you can hear from down the block", ctx).join(" ")).toMatch(/ingredient, not a volume pitch/);
    expect(VOLUME_FRAMING.test("A playlist at talking volume")).toBe(false);
  });
});

describe("a safe title", () => {
  const inputs = (date: string) => ({ date } as PlanInputs);
  it("comes from the occasion and the activity", () => {
    expect(safeTitle(inputs("2026-10-30"), 0).title).toBe("Friday Wheel Spin");
    expect(safeTitle(inputs("2026-10-31"), 0).title).toBe("Halloween Saturday Wheel Spin");
    expect(safeTitle(inputs("2026-11-07"), 1).title).toBe("Saturday Snack Stop");
    expect(titleGenre(safeTitle(inputs("2026-11-07"), 2).hook)).toBeNull();
  });
});

describe("the most-played mix", () => {
  it("keeps Qloo's order with no main genre more than twice", () => {
    const artist = (id: string, genre: string) => ({ id, genres: [genre] });
    const mix = mostPlayedMix([artist("a", "Rap"), artist("b", "Rap"), artist("c", "Rap"), artist("d", "Pop"), artist("e", "R&B")], 4);
    expect(mix.map((a) => a.id)).toEqual(["a", "b", "d", "e"]);
  });
});
