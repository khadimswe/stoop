// What Qloo measured for one store, turned into the plan's own shapes: the city's artists and music
// styles, and the places on its block. Everything here is deterministic and runs on Qloo's answers
// only, so the same answers always give the same city and block.
//
// Two filters stand between Qloo's tags and the plan. The identity filter drops tags that describe
// who people are instead of what they listen to (Oct 28 tests returned "Drag Race", "trans" and
// "queer" as Chicago music genres). The noise filter drops tags that are not styles at all (places,
// nationalities, instruments, novelty words). The block drops national chains (local independents
// make the partners) and places built around alcohol or tobacco (a public sidewalk event).
import { checkText } from "../guardrails";
import { normalizeName, tagSimilarity } from "../qloo/match";
import type { QlooEntity, QlooTag } from "../qloo/types";
import type { ArtistRef, MusicStyle, Place } from "./schema";

// --- Tag filters ------------------------------------------------------------------------------

/**
 * Words that make a tag describe people (gender, sexuality, religion) rather than a sound. Whole
 * words, case-insensitive. Ethnicity and minors come from the shared guardrails (checkText).
 */
export const IDENTITY_TAG_TERMS = [
  "drag",
  "drag race",
  "drag queen",
  "drag queens",
  "trans",
  "transgender",
  "queer",
  "gay",
  "lesbian",
  "lgbt",
  "lgbtq",
  "lgbtqia",
  "bisexual",
  "nonbinary",
  "non-binary",
  "pride",
  "female",
  "male",
  "women",
  "woman",
  "men",
  "feminist",
  "christian",
  "worship",
  "gospel",
  "religious",
  "islamic",
  "muslim",
  "jewish",
  "catholic",
] as const;

/** Tag names that are places or nationalities, not styles ("south carolina", "philly", "tuga"). */
const PLACE_WORDS = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts",
  "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
  "wisconsin", "wyoming", "chicago", "atlanta", "houston", "dallas", "detroit", "memphis", "miami", "philly", "philadelphia",
  "baltimore", "brooklyn", "bronx", "harlem", "los angeles", "la", "oakland", "bay area", "seattle", "boston", "nyc", "dc",
  "new orleans", "nola", "st louis", "milwaukee", "minneapolis", "phoenix", "san antonio", "austin", "uk", "british",
  "english", "german", "french", "swedish", "norwegian", "danish", "finnish", "dutch", "italian", "spanish", "portuguese",
  "tuga", "brazilian", "japanese", "korean", "chinese", "russian", "polish", "irish", "scottish", "canadian", "australian",
  "new zealand", "nigerian", "ghanaian", "south african", "jamaican", "puerto rican", "mexican", "colombian", "cuban",
  "american", "usa",
] as const;

/** Tag names that are instruments, voices or novelty words rather than a style to play. */
const NOT_A_STYLE = [
  "nyckelharpa", "kawaii", "singer", "female singer", "male singer", "singer-songwriter", "vocals", "vocalist", "piano", "guitar",
  "drums", "violin", "saxophone", "instrumental", "soundtrack", "musical", "broadway", "christmas", "holiday", "children's music",
  "kids", "comedy", "spoken word", "asmr", "meme", "anime", "video game music", "tiktok", "viral", "unknown", "other", "seen live",
] as const;

const phrase = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s_-]+")}(?![\\p{L}\\p{N}])`, "iu");
const IDENTITY_PATTERNS = IDENTITY_TAG_TERMS.map(phrase);
const plainName = (name: string) => normalizeName(name).replace(/\s+/g, " ").trim();
const PLACE_SET = new Set<string>(PLACE_WORDS.map(plainName));
const NOT_A_STYLE_SET = new Set<string>(NOT_A_STYLE.map(plainName));

/** Why a tag describes people rather than taste, or null when it is a taste. */
export function identityTag(name: string): string | null {
  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(name))) return "it describes who people are, not what they listen to";
  const guarded = checkText(name).filter((issue) => issue.rule === "minor" || issue.rule === "ethnicity");
  if (guarded.length > 0) return "it describes people by ethnicity or age";
  return null;
}

/** Why a tag is not a music style to play (a place, a nationality, an instrument), or null when it is one. */
export function noiseTag(name: string, city?: string): string | null {
  const plain = plainName(name);
  if (!plain) return "it has no name";
  if (PLACE_SET.has(plain) || (city && plain === plainName(city))) return "it names a place, not a sound";
  if (NOT_A_STYLE_SET.has(plain)) return "it is not a style to play";
  return null;
}

/** Why a tag is left out of the plan (identity first), or null when it stays. */
export function droppedTag(name: string, city?: string): string | null {
  return identityTag(name) ?? noiseTag(name, city);
}

// --- Artists and styles -------------------------------------------------------------------------

const MUSIC_GENRE = "urn:tag:genre:music";
/** Styles shown per city. */
export const MAX_STYLES = 8;
/** An artist-derived style needs at least this many of the city's top artists behind it. */
export const STYLE_MIN_ARTISTS = 2;
/** Generic umbrella genres that say nothing about a city ("Hip - Hop", "Pop", "Rap"). */
const UMBRELLA = new Set(["hip hop", "hip - hop", "rap", "pop", "rock", "electronic", "indie", "r and b", "rnb", "alternative", "dance", "music"].map(plainName));

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : []);

/** Qloo's genre property for an artist: its primary genres, then its secondary ones, without repeats or identity words. */
export function artistGenres(entity: QlooEntity): string[] {
  const all = [...strings(entity.properties?.primary_genres), ...strings(entity.properties?.secondary_genres)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const genre of all) {
    const key = plainName(genre);
    if (seen.has(key) || identityTag(genre)) continue;
    seen.add(key);
    out.push(genre);
  }
  return out;
}

/** The city's artists, in Qloo's order, each with its genres and the call behind it. */
export function toArtists(entities: readonly QlooEntity[], evidenceId: string): ArtistRef[] {
  const out: ArtistRef[] = [];
  for (const entity of entities) {
    if (out.some((a) => a.id === entity.id) || !entity.name.trim()) continue;
    out.push({ id: entity.id, name: entity.name.trim(), rank: out.length + 1, genres: artistGenres(entity), evidenceIds: [evidenceId] });
  }
  return out;
}

export interface StyleInput {
  city: string;
  /** Qloo's music-genre tags for the city's adults (the urn:tag call), in Qloo's order. */
  cityTags: readonly QlooTag[];
  cityTagsEvidenceId: string;
  /** The city's top artists as Qloo returned them (their music-genre tags count as votes). */
  artistEntities: readonly QlooEntity[];
  artistsEvidenceId: string;
}

export interface StyleResult {
  styles: MusicStyle[];
  /** Tags left out, with why, for the trace. */
  dropped: { name: string; reason: string }[];
}

/**
 * The city's music styles. Qloo's raw city genre list is noisy, so styles the city's own top artists
 * also carry come first (both calls are the receipt), then genres two or more of those artists share,
 * then the rest of the city list. Identity and noise tags never make it in.
 */
export function musicStyles(input: StyleInput): StyleResult {
  const dropped: StyleResult["dropped"] = [];
  const droppedNames = new Set<string>();
  const drop = (name: string, reason: string) => {
    const key = plainName(name);
    if (droppedNames.has(key)) return;
    droppedNames.add(key);
    dropped.push({ name, reason });
  };

  // Votes: how many of the city's top artists carry each music-genre tag.
  const votes = new Map<string, { tag: QlooTag; count: number }>();
  for (const entity of input.artistEntities) {
    const seen = new Set<string>();
    for (const tag of entity.tags) {
      if (tag.type !== MUSIC_GENRE || seen.has(tag.id)) continue;
      seen.add(tag.id);
      const entry = votes.get(tag.id) ?? { tag, count: 0 };
      entry.count++;
      votes.set(tag.id, entry);
    }
  }

  const keep = (name: string): boolean => {
    const reason = droppedTag(name, input.city);
    if (reason) {
      drop(name, reason);
      return false;
    }
    return true;
  };

  const cityTags = input.cityTags.filter((t) => t.type === null || t.type === MUSIC_GENRE).filter((t) => keep(t.name));
  const confirmedBy = (tag: QlooTag) => [...votes.values()].find((v) => v.tag.id === tag.id || tagSimilarity(v.tag.name, tag.name) >= 0.99);

  const styles: MusicStyle[] = [];
  const taken = new Set<string>();
  const add = (tagId: string, name: string, evidenceIds: string[]) => {
    const key = plainName(name);
    if (styles.length >= MAX_STYLES || taken.has(key) || taken.has(tagId)) return;
    taken.add(key);
    taken.add(tagId);
    styles.push({ tagId, name: name.trim(), evidenceIds });
  };

  for (const tag of cityTags) if (confirmedBy(tag)) add(tag.id, tag.name, [input.cityTagsEvidenceId, input.artistsEvidenceId]);
  const shared = [...votes.values()]
    .filter((v) => v.count >= STYLE_MIN_ARTISTS && !UMBRELLA.has(plainName(v.tag.name)))
    .sort((a, b) => b.count - a.count)
    .filter((v) => keep(v.tag.name));
  for (const v of shared) add(v.tag.id, v.tag.name, [input.artistsEvidenceId]);
  for (const tag of cityTags) add(tag.id, tag.name, [input.cityTagsEvidenceId]);
  return { styles, dropped };
}

// --- The block ------------------------------------------------------------------------------------

/**
 * Place categories near the store, each one Qloo call with these tag ids (union). Every id appears in
 * recorded Qloo answers (fixtures/store-area-probe.json.gz, fixtures/store-city-tags-probe.json).
 */
export const BLOCK_CATEGORIES = {
  food: { kind: "food", label: "food spots", take: 15, tags: ["urn:tag:genre:place:restaurant", "urn:tag:genre:place:restaurant:takeout"] },
  treats: {
    kind: "food",
    label: "cafes, bakeries and dessert shops",
    take: 10,
    tags: [
      "urn:tag:genre:place:restaurant:cafe",
      "urn:tag:genre:place:restaurant:coffee_shop",
      "urn:tag:genre:place:restaurant:bakery",
      "urn:tag:genre:place:restaurant:dessert_shop",
      "urn:tag:genre:place:restaurant:ice_cream_shop",
      "urn:tag:genre:place:restaurant:donut_shop",
      "urn:tag:genre:place:restaurant:juice_shop",
    ],
  },
  venues: {
    kind: "venue",
    label: "music venues and theaters",
    take: 10,
    tags: ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:performing_arts_theater", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:event_venue"],
  },
  parks: { kind: "park", label: "parks", take: 6, tags: ["urn:tag:genre:place:park", "urn:tag:genre:place:city_park"] },
} as const satisfies Record<string, { kind: Place["kind"]; label: string; take: number; tags: readonly string[] }>;
export type BlockCategory = keyof typeof BLOCK_CATEGORIES;
export const BLOCK_ORDER: readonly BlockCategory[] = ["food", "treats", "venues", "parks"];

/** National chains: a block partner should be a local independent. Matched on the start of the name. */
export const NATIONAL_CHAINS = [
  "7-eleven", "aldi", "amc", "applebee's", "arby's", "auntie anne's", "autozone", "baskin-robbins", "best buy", "buffalo wild wings",
  "burger king", "chick-fil-a", "chili's", "chipotle", "cold stone", "costco", "cvs", "dairy queen", "denny's", "domino's",
  "dunkin", "dutch bros", "five guys", "foot locker", "gamestop", "great clips", "home depot", "ihop", "jack in the box",
  "jamba", "jersey mike's", "jimmy john's", "kfc", "krispy kreme", "kroger", "la fitness", "little caesars", "lowe's",
  "mcdonald's", "olive garden", "panda express", "panera", "papa john's", "papa johns", "planet fitness", "popeyes",
  "potbelly", "qdoba", "raising cane's", "regal", "shake shack", "smoothie king", "sonic drive-in", "sport clips", "starbucks",
  "subway", "supercuts", "taco bell", "target", "tim hortons", "trader joe's", "tropical smoothie", "walgreens", "walmart",
  "wendy's", "whataburger", "whole foods", "wingstop", "pizza hut", "white castle", "culver's", "dave's hot chicken",
  "crumbl", "insomnia cookies", "nothing bundt", "sweetgreen", "cava", "dollar tree", "dollar general", "family dollar",
  "t-mobile", "metro by t-mobile", "cricket wireless", "boost mobile", "at&t", "verizon",
] as const;
const CHAIN_KEYS = NATIONAL_CHAINS.map(plainName);

/** True for a national chain (or a wireless store), by the start of its name. */
export function isChain(name: string): boolean {
  const plain = plainName(name);
  return CHAIN_KEYS.some((chain) => plain === chain || plain.startsWith(`${chain} `));
}

/** Place genres built around alcohol or tobacco: never a partner for a public sidewalk table. */
const ALCOHOL_GENRES = ["bar", "cocktail_bar", "pub", "brewery", "brewpub", "night_club", "lounge", "hookah_bar", "wine_bar", "liquor_store", "beer", "beer_garden", "sports_bar", "dive_bar", "tavern", "winery", "distillery", "cigar", "vape", "smoke_shop", "tobacco", "bar_&_grill", "gay_bar"];
const ALCOHOL_NAME = /\b(bar|pub|tavern|brewery|brewing|taproom|saloon|lounge|cantina|liquor|wine|winery|distillery|hookah|cigar|vape|smoke shop|tobacco)\b/i;

const genreTail = (id: string) => id.replace(/^urn:tag:genre:place:/, "").replace(/^restaurant:/, "");
const primaryGenre = (entity: QlooEntity): string | null => {
  const genre = entity.properties?.primary_genre;
  return genre && typeof genre === "object" && typeof (genre as { id?: unknown }).id === "string" ? (genre as { id: string }).id : null;
};

/** True when a place is built around alcohol or tobacco: its main genre, or its name ("... Margarita Bar"). */
export function isAlcoholPlace(entity: QlooEntity): boolean {
  const primary = primaryGenre(entity);
  if (primary && ALCOHOL_GENRES.includes(genreTail(primary))) return true;
  return ALCOHOL_NAME.test(entity.name);
}

const VENUE_GENRES = new Set(["live_music_venue", "performing_arts_theater", "concert_hall", "event_venue", "theater", "movie_theater", "amphitheater", "music_venue", "opera_house", "dance_hall", "art_center", "cultural_center"]);
const PARK_GENRES = new Set(["park", "city_park", "plaza", "garden", "botanical_garden", "playground_park", "public_square"]);
const FOOD_GENRES = /^(restaurant|cafe|coffee|bakery|dessert|ice_cream|donut|juice|tea|taqueria|food|bbq|barbecue|pizza|deli|sandwich|burger|hot_dog|fast_food|takeout|chicken|seafood|mexican|soul_food|breakfast|brunch|lunch)/;
const SHOP_GENRES = /(store|shop|market|mall|shopping|boutique|salon|barber)/;

/** What kind of place this is, by its main Qloo genre, falling back to the category that found it. */
export function placeKind(entity: QlooEntity, fallback: Place["kind"]): Place["kind"] {
  const primary = primaryGenre(entity);
  if (!primary) return fallback;
  const tail = genreTail(primary);
  if (VENUE_GENRES.has(tail)) return "venue";
  if (PARK_GENRES.has(tail)) return "park";
  if (primary.startsWith("urn:tag:genre:place:restaurant") || FOOD_GENRES.test(tail)) return "food";
  if (SHOP_GENRES.test(tail)) return "shop";
  return fallback;
}

/** Tag names kept on a place: its genres (not the bare "Place"), then its specialty dishes, then its ambience. */
export const MAX_PLACE_TAGS = 8;
export function placeTags(entity: QlooEntity): string[] {
  const genres = entity.tags.filter((t) => t.type === "urn:tag:genre:place" && t.id !== "urn:tag:genre:place" && !ALCOHOL_GENRES.includes(genreTail(t.id)));
  const dishes = entity.tags.filter((t) => t.type === "urn:tag:specialty_dish:place");
  const ambience = entity.tags.filter((t) => t.type === "urn:tag:ambience:qloo" || t.type === "urn:tag:setting:qloo");
  const out: string[] = [];
  for (const tag of [...genres, ...dishes.slice(0, 3), ...ambience.slice(0, 3)]) {
    const name = tag.name.trim();
    if (!name || out.some((n) => plainName(n) === plainName(name)) || identityTag(name) || ALCOHOL_NAME.test(name)) continue;
    out.push(name);
    if (out.length >= MAX_PLACE_TAGS) break;
  }
  return out;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Why Qloo returned the place: its explainability when Qloo sends one (it does only for entity
 * signals; with the age signal alone it answers "Could not calculate explainability"), else Qloo's
 * own short description of the place, shown as is.
 */
export function placeWhy(entity: QlooEntity, artistNames: ReadonlyMap<string, string> = new Map()): string | null {
  const explained = Object.values(entity.explainability ?? {})
    .flat()
    .sort((a, b) => b.score - a.score)
    .map((item) => artistNames.get(item.entityId))
    .filter((name): name is string => !!name);
  if (explained.length > 0) return `Qloo links it to fans of ${[...new Set(explained)].slice(0, 2).join(" and ")}.`;
  return text(entity.properties?.short_description);
}

export function toPlace(entity: QlooEntity, input: { rank: number; evidenceId: string; fallback: Place["kind"] }): Place {
  const distance = (entity as QlooEntity & { distance?: unknown }).distance;
  return {
    id: entity.id,
    name: entity.name.trim(),
    kind: placeKind(entity, input.fallback),
    tags: placeTags(entity),
    address: text(entity.properties?.address) ?? entity.disambiguation,
    distanceM: typeof distance === "number" && Number.isFinite(distance) ? Math.round(distance) : null,
    why: placeWhy(entity),
    rank: input.rank,
    affinity: entity.affinity,
    popularity: entity.popularity,
    evidenceIds: [input.evidenceId],
  };
}

/** Why a place is left off the block, or null when it can be a partner or a spot. */
export function placeLeftOut(entity: QlooEntity): string | null {
  if (isChain(entity.name)) return "a national chain; local independents make better partners";
  if (isAlcoholPlace(entity)) return "it is built around alcohol, and the table is on a public sidewalk";
  if (checkText(entity.name).some((issue) => issue.rule === "minor")) return "it is aimed at kids";
  return null;
}
