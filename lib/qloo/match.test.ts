import { describe, expect, it } from "vitest";
import { findFixture, readFixtureFile, recorded } from "./fixtures";
import { acceptMatch, bestTag, matchResult, normalizeName, sameName, tagSimilarity } from "./match";
import { searchResponse } from "./types";
import { describeRecorded } from "../testing/recorded";

describe("sameName", () => {
  it("ignores case, accents, punctuation, '&' and a leading 'the'", () => {
    expect(sameName("Tyler, the Creator", "Tyler, The Creator")).toBe(true);
    expect(sameName("Bath & Body Works", "Bath and Body Works")).toBe(true);
    expect(sameName("Trader Joe's", "Trader Joe’s")).toBe(true);
    expect(sameName("The Ordinary", "Ordinary")).toBe(true);
    expect(sameName("Beyoncé", "Beyonce")).toBe(true);
  });

  it("rejects near misses", () => {
    expect(sameName("Porch Light Trio", "Porch Light Trio & Friends")).toBe(false);
    expect(sameName("Kettle", "The Kettle 2")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });

  it("normalizes to plain words", () => {
    expect(normalizeName("  Night Kitchen: Québec ")).toBe("night kitchen quebec");
  });
});

describeRecorded("acceptMatch on recorded searches", () => {
  const search = readFixtureFile(findFixture("probe-search") as string);
  const results = (id: string) => searchResponse.parse(recorded(search, id).body);

  it("takes the matching result, not filler", () => {
    expect(acceptMatch("Tyler, the Creator", results("search-artist-tyler"))?.name).toBe("Tyler, the Creator");
    expect(acceptMatch("Radiolab", results("search-podcast-radiolab"))?.name).toBe("Radiolab");
  });

  it("drops a query whose name never comes back", () => {
    expect(acceptMatch("Bonnie Raitt", results("search-artist-tyler"))).toBeUndefined();
  });
});

describe("acceptMatch on longer Qloo names", () => {
  // Made-up names in the shapes Qloo answers with: a host's name before a show's title, a product
  // line after a brand's name, a collaboration after an artist's name.
  const top = (...names: string[]) => names.map((name) => ({ name }));

  it("takes the top hit when it starts or ends with the whole query", () => {
    expect(acceptMatch("Field Notes", top("Jane Doe: Field Notes", "We Are Field Hands"))?.name).toBe("Jane Doe: Field Notes");
    expect(acceptMatch("Sole Saver", top("Sole Saver Premium Shoe Care", "Sole Mates"))?.name).toBe("Sole Saver Premium Shoe Care");
  });

  it("prefers an exact match anywhere over an affix match", () => {
    expect(acceptMatch("Porch Light Trio", top("Porch Light Trio & Friends", "Porch Light Trio"))?.name).toBe("Porch Light Trio");
  });

  it("never affix-matches a one-word query, so short names cannot grab a longer one", () => {
    expect(acceptMatch("The Badger", top("Badger Ridge: Trail Days"))).toBeUndefined();
    expect(acceptMatch("Kettle", top("Kettle SB"))).toBeUndefined();
    expect(matchResult("Field Notes", top("Jane Doe: Field Notes"))?.match).toBe("affix");
    expect(matchResult("Radiolab", top("Radiolab"))?.match).toBe("exact");
  });

  it("never takes filler below the top hit, or a partial word", () => {
    expect(acceptMatch("Sole Saver", top("Sole Mates", "Sole Saver Premium Shoe Care"))).toBeUndefined();
    expect(acceptMatch("Quiet Hours", top("QH Records"))).toBeUndefined();
    expect(acceptMatch("Doe", top("Jane Doe: Field Notes"))).toBeUndefined();
  });
});

describe("tag mapping", () => {
  it("scores 1 for the same words, spaces ignored", () => {
    expect(tagSimilarity("lo fi hip hop", "Lo Fi Hip Hop")).toBe(1);
    expect(tagSimilarity("acoustic indie folk", "Acousticindiefolk")).toBe(1);
    expect(tagSimilarity("indie folk", "Indie - Folk")).toBe(1);
  });

  it("maps to the most similar tag at or above the threshold, keeping Qloo's order on ties", () => {
    const tags = [{ name: "Indie Pop" }, { name: "Spanish Indie Pop" }, { name: "Indie Electronic" }];
    expect(bestTag("indie electronic pop", tags)).toEqual({ tag: { name: "Indie Pop" }, similarity: 2 / 3 });
  });

  it("calls anything looser unverifiable", () => {
    expect(bestTag("funk soul groove", [{ name: "Soul" }])).toBeUndefined();
    expect(bestTag("calm", [])).toBeUndefined();
  });
});
