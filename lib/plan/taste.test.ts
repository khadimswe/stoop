import { describe, expect, it } from "vitest";
import { readFixtureFile } from "../qloo/fixtures";
import { insightsEntitiesResponse, insightsTagsResponse, type QlooEntity, type QlooTag } from "../qloo/types";
import { describeRecorded, ifRecorded } from "../testing/recorded";
import { placesResponse } from "./requests";
import { artistGenres, droppedTag, explicitName, identityTag, isAlcoholPlace, isChain, musicStyles, noiseTag, placeKind, placeLeftOut, toArtists, toPlace } from "./taste";

const tag = (id: string, name: string, type: string | null = "urn:tag:genre:music"): QlooTag => ({ id, name, type, popularity: null, affinity: null });
const entity = (over: Partial<QlooEntity>): QlooEntity => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Somewhere",
  type: "urn:entity:place",
  popularity: null,
  affinity: null,
  disambiguation: null,
  location: null,
  tags: [],
  explainability: null,
  properties: null,
  ...over,
});

describe("the identity filter", () => {
  it.each(["Drag Race", "drag queen", "drag queens", "trans", "queer", "female singer", "Gospel", "LGBTQ"])("drops %s", (name) => {
    expect(identityTag(name)).not.toBeNull();
  });
  it.each(["Drill", "trap rap", "Southern Hip Hop", "contemporary rnb", "jersey club", "Trap Soul", "Transcendental Jazz"])("keeps %s", (name) => {
    expect(identityTag(name)).toBeNull();
  });
  it("drops ethnicity and minors through the shared guardrails", () => {
    expect(identityTag("Latino pop")).not.toBeNull();
    expect(identityTag("teen pop")).not.toBeNull();
  });
});

describe("the noise filter", () => {
  it.each(["tuga", "kawaii", "south carolina", "Philly", "New Zealand", "nyckelharpa", "Gangsta Rap"])("drops %s", (name) => {
    expect(noiseTag(name)).not.toBeNull();
  });
  it("drops the store's own city as a style", () => {
    expect(noiseTag("Houston", "Houston")).not.toBeNull();
    expect(droppedTag("bounce", "Chicago")).toBeNull();
  });
});

describe("artists", () => {
  it("keeps Qloo's genre property, primary first, without repeats or identity words", () => {
    const artist = entity({ type: "urn:entity:artist", properties: { primary_genres: ["Hip Hop", "Rap"], secondary_genres: ["Rap", "Trap", "Female Rap"] } });
    expect(artistGenres(artist)).toEqual(["Hip Hop", "Rap", "Trap"]);
  });
  it("leaves out names not fit for a sidewalk and ranks the rest in Qloo's order", () => {
    const artists = toArtists([entity({ id: "a", name: "Lil Pimp Zevrin" }), entity({ id: "b", name: "Zevrin" }), entity({ id: "c", name: "Quilla" })], "ev_000000000001");
    expect(artists.map((a) => [a.name, a.rank])).toEqual([["Zevrin", 1], ["Quilla", 2]]);
    expect(explicitName("Young Zevrin")).toBe(false);
  });
});

describe("music styles", () => {
  const artist = (id: string, genres: string[]) =>
    entity({ id, type: "urn:entity:artist", properties: { primary_genres: genres }, tags: genres.map((g) => tag(`urn:tag:genre:qloo:${g.toLowerCase().replace(/\W+/g, "_")}`, g, "urn:tag:genre:qloo")) });
  const input = {
    city: "Chicago",
    cityTagsEvidenceId: "ev_00000000000c",
    artistsEvidenceId: "ev_00000000000a",
    artistEntities: [artist("1", ["Hip Hop", "Drill"]), artist("2", ["Hip Hop", "Drill"]), artist("3", ["Hip Hop", "Indie Pop"])],
    cityTags: [tag("urn:tag:genre:music:drag_race", "Drag Race"), tag("urn:tag:genre:music:tuga", "tuga"), tag("urn:tag:genre:music:drill", "drill"), tag("urn:tag:genre:music:french_touch", "French-touch")],
  };
  it("comes from the genres two or more top artists share, most shared first, with the artists call as receipt", () => {
    const { styles } = musicStyles(input);
    expect(styles.map((s) => s.name)).toEqual(["Hip Hop", "Drill"]);
    expect(styles[0]?.evidenceIds).toEqual(["ev_00000000000a"]);
  });
  it("keeps a city tag only when it agrees with those genres, and drops identity and noise with a reason", () => {
    const { styles, dropped } = musicStyles({ ...input, artistEntities: [...input.artistEntities, artist("4", ["Trap", "Rap"]), artist("5", ["Trap"])], cityTags: [...input.cityTags, tag("urn:tag:genre:music:trap_rap", "trap rap")] });
    expect(styles.find((s) => s.name === "trap rap")?.evidenceIds).toEqual(["ev_00000000000c", "ev_00000000000a"]);
    expect(dropped.map((d) => d.name)).toEqual(expect.arrayContaining(["Drag Race", "tuga", "French-touch"]));
    expect(styles.some((s) => identityTag(s.name))).toBe(false);
  });
});

describe("the block", () => {
  it("marks national chains and leaves out wireless stores, alcohol and adults-only spots", () => {
    expect(isChain("costco")).toBe(true);
    expect(isChain("jewel-osco")).toBe(true);
    expect(isChain("Quillon Coffee House")).toBe(false);
    expect(placeLeftOut(entity({ name: "Metro by T-Mobile" }))).not.toBeNull();
    expect(placeLeftOut(entity({ name: "costco" }))).toBeNull();
    expect(isAlcoholPlace(entity({ name: "Casa Quillon Margarita Bar" }))).toBe(true);
    expect(isAlcoholPlace(entity({ name: "Corner Spot", properties: { primary_genre: { id: "urn:tag:genre:place:pub" } } }))).toBe(true);
    expect(placeLeftOut(entity({ name: "Color Studio", tags: [tag("urn:tag:genre:place:adult_entertainment_club", "Adult entertainment club", "urn:tag:genre:place")] }))).not.toBeNull();
  });
  it("reads the kind from the main Qloo genre", () => {
    expect(placeKind(entity({ properties: { primary_genre: { id: "urn:tag:genre:place:live_music_venue" } } }), "food")).toBe("venue");
    expect(placeKind(entity({ properties: { primary_genre: { id: "urn:tag:genre:place:restaurant:mexican" } } }), "venue")).toBe("food");
    expect(placeKind(entity({ properties: { primary_genre: { id: "urn:tag:genre:place:city_park" } } }), "food")).toBe("park");
    expect(placeKind(entity({}), "park")).toBe("park");
  });
});

// Recorded Qloo answers: the Oct 28 data check (fixtures/store-area-probe.json.gz).
const probe = ifRecorded(() => readFixtureFile("fixtures/store-area-probe.json.gz"));

describeRecorded("mapping recorded Qloo answers", () => {
  const body = (id: string) => probe.requests.find((r) => r.id === id)?.body;

  it("maps places near a store with distance, tags, address and Qloo's own description as why", () => {
    const places = placesResponse.parse(body("places-near-pilsen"));
    const venue = places.find((p) => (p.properties?.primary_genre as { id?: string } | undefined)?.id === "urn:tag:genre:place:live_music_venue");
    expect(venue).toBeDefined();
    const place = toPlace(venue!, { rank: 1, evidenceId: "ev_000000000001", fallback: "food" });
    expect(place.kind).toBe("venue");
    expect(place.distanceM).toBe(Math.round(venue!.distance!));
    expect(place.point).toEqual({ lat: venue!.location!.lat, lon: venue!.location!.lon });
    expect(place.address).toBeTruthy();
    expect(place.why).toBeTruthy();
    expect(place.tags).toContain("Live music venue");
    expect(place.tags).not.toContain("Place");
    expect(places.some((p) => isChain(p.name))).toBe(true);
  });

  it("drops identity tags from a recorded city genre list", () => {
    const tags = insightsTagsResponse.parse(readFixtureFile("fixtures/store-city-tags-probe.json").requests.find((r) => r.id === "music-genres-chicago")?.body);
    const artists = insightsEntitiesResponse.parse(body("artists-chicago-city"));
    const { styles, dropped } = musicStyles({ city: "Chicago", cityTags: tags, cityTagsEvidenceId: "ev_00000000000c", artistEntities: artists, artistsEvidenceId: "ev_00000000000a" });
    expect(dropped.map((d) => d.name)).toEqual(expect.arrayContaining(["Drag Race", "trans", "queer"]));
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) expect(droppedTag(style.name, "Chicago")).toBeNull();
  });
});
