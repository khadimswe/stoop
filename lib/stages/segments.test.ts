import { describe, expect, it } from "vitest";
import { findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { insightsEntitiesResponse } from "../qloo/types";
import { MERGE_BELOW, segmentLabel, shouldMerge, topGenres } from "./segments";

const segments = readFixtureFile(findFixture("pool-segments") as string);
const artists = (id: string) => insightsEntitiesResponse.parse(recorded(segments, id).body);
const young = artists("pets-outfits--seg-24_and_younger--artist");
const older = artists("pets-outfits--seg-35_to_44--artist");

describe("segment labels", () => {
  it("come from Qloo's own artist genres, adult band first", () => {
    expect(segmentLabel("24_and_younger", ["pop", "country pop"])).toBe("18 to 24 · pop and country pop");
    expect(segmentLabel("55_and_older", [])).toBe("55 and older");
  });

  it("name each of two worlds by what sets it apart, so they never share a label", () => {
    const alone = [topGenres(young), topGenres(older)];
    const apart = [topGenres(young, older), topGenres(older, young)];
    // On their own both pet-hat worlds read as "pop and country".
    expect(alone[0]).toEqual(alone[1]);
    expect(apart[0]).not.toEqual(apart[1]);
  });

  it("merge two worlds only when they share most of their tastes", () => {
    expect(MERGE_BELOW).toBe(0.3);
    expect(shouldMerge(0.29)).toBe(true);
    expect(shouldMerge(0.42)).toBe(false);
  });
});
