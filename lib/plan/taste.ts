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
  // Not for a public sidewalk in front of a store.
  "gangsta rap", "gangsta", "horrorcore", "explicit", "dirty rap", "porn", "stripper",
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
export const MAX_STYLES = 6;
/** Slots kept for broad styles the city's own list carries beyond its top artists' sound. */
export const MAX_BROAD = 2;
/** A style needs at least this many of the city's top artists behind it. */
export const STYLE_MIN_ARTISTS = 2;
/** A city tag counts as agreeing with the artists' genres at this name similarity (lib/qloo/match.ts). */
export const AGREES_AT = 0.5;
/** Broad style families a city list may carry beyond its top artists' sound. */
export const BROAD_STYLE = /\b(country|bluegrass|americana|latin|reggaeton|regional mexican|mexican regional|corridos|cumbia|banda|norte(n|ñ)o|tejano|salsa|bachata|merengue|reggae|dancehall|soca|afrobeats?|amapiano|k-?pop|blues|jazz|zydeco|rock|metal|punk|folk|house|techno|edm)\b/i;

/** Tag types whose ids can stand for an artist genre ("Hip Hop" is urn:tag:genre:qloo:hip_hop). */
const GENRE_TAG_TYPES = new Set(["urn:tag:genre:qloo", "urn:tag:subgenre:qloo", "urn:tag:genre:music", "urn:tag:style:qloo"]);

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

/** Artist names that do not belong on a sign or a playlist line on a public sidewalk. */
const EXPLICIT_NAME = /\b(pimp|pimpin|hoes?|bitch\w*|f+u+c+k\w*|shit\w*|dick|pussy|thot|nigg\w*|cocaine|crack|kush)\b/i;

/** True when an artist's name is not fit for a public sidewalk event. */
export const explicitName = (name: string) => EXPLICIT_NAME.test(name);

/** The city's artists, in Qloo's order (explicit names left out), each with its genres and the call behind it. */
export function toArtists(entities: readonly QlooEntity[], evidenceId: string): ArtistRef[] {
  const out: ArtistRef[] = [];
  for (const entity of entities) {
    if (out.some((a) => a.id === entity.id) || !entity.name.trim() || explicitName(entity.name)) continue;
    out.push({ id: entity.id, name: entity.name.trim(), rank: out.length + 1, genres: artistGenres(entity), evidenceIds: [evidenceId] });
  }
  return out;
}

export interface StyleInput {
  city: string;
  /** Qloo's music-genre tags for the city's adults (the urn:tag call), in Qloo's order. */
  cityTags: readonly QlooTag[];
  cityTagsEvidenceId: string;
  /** The city's top artists as Qloo returned them, with their genre property and tags. */
  artistEntities: readonly QlooEntity[];
  artistsEvidenceId: string;
}

export interface StyleResult {
  styles: MusicStyle[];
  /** Tags and genres left out, with why, for the trace. */
  dropped: { name: string; reason: string }[];
}

/**
 * The city's music styles, from the top artists' own Qloo genre property (primary and secondary
 * genres): each genre two or more of them share, most shared first, with the artists call as its
 * receipt. Qloo's raw city genre list is noisy, so a city tag joins only when it agrees with those
 * genres (then it cites both calls). Identity and noise labels never make it in.
 */
export function musicStyles(input: StyleInput): StyleResult {
  const dropped: StyleResult["dropped"] = [];
  const seenDrop = new Set<string>();
  const note = (name: string, reason: string) => {
    const key = plainName(name);
    if (seenDrop.has(key)) return;
    seenDrop.add(key);
    dropped.push({ name, reason });
  };
  const keep = (name: string): boolean => {
    const reason = droppedTag(name, input.city);
    if (reason) note(name, reason);
    return !reason;
  };

  // Genre votes: how many top artists list each genre, and a Qloo tag id that names it.
  const votes = new Map<string, { name: string; count: number; tagId: string | null }>();
  for (const entity of input.artistEntities) {
    const listed = [...strings(entity.properties?.primary_genres), ...strings(entity.properties?.secondary_genres)];
    const counted = new Set<string>();
    for (const genre of listed) {
      const key = plainName(genre);
      if (!key || counted.has(key)) continue;
      counted.add(key);
      const tag = entity.tags.find((t) => t.type !== null && GENRE_TAG_TYPES.has(t.type) && plainName(t.name) === key);
      const entry = votes.get(key) ?? { name: genre, count: 0, tagId: null };
      entry.count++;
      entry.tagId ??= tag?.id ?? null;
      votes.set(key, entry);
    }
  }

  const styles: MusicStyle[] = [];
  const taken = new Set<string>();
  const add = (style: MusicStyle) => {
    const key = plainName(style.name);
    if (styles.length >= MAX_STYLES || taken.has(key) || taken.has(style.tagId)) return;
    taken.add(key);
    taken.add(style.tagId);
    styles.push(style);
  };

  const genres = [...votes.values()].filter((v) => v.count >= STYLE_MIN_ARTISTS && v.tagId).sort((a, b) => b.count - a.count);
  const kept = genres.filter((v) => keep(v.name));
  // Broad styles on the city's own list stay even when its top artists do not play them: the top 20
  // lean toward the most popular sound, and a city's second sound (country, Latin) shows up only here.
  // They get up to MAX_BROAD of the slots, so the artists' genres cannot crowd them out.
  // A broad style that is really a branch of the artists' own sound ("country rap" next to Rap) is not a second sound.
  const branch = (name: string) => kept.some((v) => tagSimilarity(v.name, name) >= AGREES_AT);
  const broad = input.cityTags.filter((tag) => (tag.type === null || tag.type === MUSIC_GENRE) && BROAD_STYLE.test(tag.name) && !branch(tag.name) && keep(tag.name)).slice(0, MAX_BROAD);
  for (const v of kept.slice(0, MAX_STYLES - broad.length)) add({ tagId: v.tagId as string, name: v.name.trim(), evidenceIds: [input.artistsEvidenceId] });
  for (const tag of broad) add({ tagId: tag.id, name: tag.name.trim(), evidenceIds: [input.cityTagsEvidenceId] });

  // City tags that agree with the artists' genres ("trap rap" with Trap), after the filters.
  for (const tag of input.cityTags) {
    if (tag.type !== null && tag.type !== MUSIC_GENRE) continue;
    if (!keep(tag.name)) continue;
    if (!kept.some((v) => tagSimilarity(v.name, tag.name) >= AGREES_AT)) {
      note(tag.name, "none of the city's top artists play it");
      continue;
    }
    add({ tagId: tag.id, name: tag.name.trim(), evidenceIds: [input.cityTagsEvidenceId, input.artistsEvidenceId] });
  }
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

/**
 * National chains. They stay on the block (a gift card people want, or a snack run, is often a
 * chain) and are marked in the prompt, so a co-promo partnership goes to a local independent.
 * Matched on the start of the name. Wireless stores are left out entirely.
 */
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
  // Grocery and drugstore chains: a partner is a local independent.
  "jewel-osco", "jewel osco", "mariano's", "safeway", "albertsons", "publix", "food lion", "meijer", "ralphs", "vons", "h-e-b",
  "heb", "fiesta mart", "food 4 less", "winco", "sprouts", "wegmans", "giant eagle", "rite aid", "family fare", "save a lot",
  "save-a-lot", "dollar general", "big lots", "ross dress for less", "marshalls", "tj maxx", "burlington", "foot locker",
  // Fast food chains seen in recorded blocks and their peers.
  "captain d's", "church's", "church's texas chicken", "zaxby's", "bojangles", "golden corral", "waffle house", "checkers",
  "rally's", "krystal", "hardee's", "carl's jr", "el pollo loco", "del taco", "firehouse subs", "marco's pizza", "hungry howie's",
  "papa murphy's", "cinnabon", "jollibee", "wingstop", "pollo campero", "tropical smoothie cafe", "smoothie king", "freddy's",
  "steak 'n shake", "steak n shake", "long john silver's", "american deli", "hooters", "twin peaks",
  // Regional chains (the Oct 28 proof lab picked several the list missed).
  "sonny's bbq", "sonny's bar-b-q", "cook out", "cracker barrel", "corner bakery", "corner bakery cafe", "huddle house", "bruster's",
  "rita's italian ice", "marble slab", "willy's mexicana grill", "moe's southwest grill", "chuy's", "torchy's tacos", "taco cabana",
  "pappadeaux", "pappasito's", "shipley do-nuts", "mellow mushroom", "taco mac", "j. christopher's", "mcalister's deli",
  "jason's deli", "newk's", "zoes kitchen", "schlotzsky's", "which wich", "longhorn steakhouse", "texas roadhouse", "outback steakhouse",
  "red lobster", "cheddar's", "ruby tuesday", "tgi fridays", "first watch", "another broken egg", "tropical smoothie", "dave & buster's",
  "portillo's", "lou malnati's", "giordano's", "harold's chicken", "jim 'n nick's", "dickey's barbecue", "golden krust",
] as const;
const CHAIN_KEYS = NATIONAL_CHAINS.map(plainName);

/**
 * True for a national or regional chain (or a wireless store), by the start of its name, or for a name
 * the recorded runs found on more than one store's block (`known`, from repeatedPlaceNames).
 */
export function isChain(name: string, known: ReadonlySet<string> = new Set()): boolean {
  const plain = plainName(name);
  return known.has(plain) || CHAIN_KEYS.some((chain) => plain === chain || plain.startsWith(`${chain} `));
}

/** The normalized names found on more than one store's block: a business with several branches is a chain. */
export function repeatedPlaceNames(blocks: readonly { places: readonly { name: string }[] }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const block of blocks) for (const name of new Set(block.places.map((p) => plainName(p.name)))) seen.set(name, (seen.get(name) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name));
}

/** Place genres built around alcohol or tobacco: never a partner for a public sidewalk table. */
const ALCOHOL_GENRES = ["bar", "cocktail_bar", "pub", "brewery", "brewpub", "night_club", "lounge", "hookah_bar", "wine_bar", "liquor_store", "beer", "beer_garden", "sports_bar", "dive_bar", "tavern", "winery", "distillery", "cigar", "vape", "smoke_shop", "tobacco", "bar_&_grill", "gay_bar"];
const ALCOHOL_NAME = /\b(bar|pub|tavern|brewery|brewing|taproom|saloon|lounge|cantina|liquor|wine|winery|distillery|hookah|cigar|vape|smoke shop|tobacco|cocktails?|margaritas?|byob|beer|tequila|mezcal|cidercade|cidery|ice house)\b/i;
/** Tags that mark a place as adults-only nightlife, gambling or cannabis: never a partner for a sidewalk table. */
const ADULT_ONLY_TAG = /\b(adult entertainment|strip club|gentlemen'?s club|casino|gambling|dispensary|cannabis|smoke shop|vape|hookah|liquor|night ?club)\b/i;

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

export function toPlace(entity: QlooEntity, input: { rank: number; evidenceId: string; fallback: Place["kind"]; knownChains?: ReadonlySet<string> }): Place {
  const distance = (entity as QlooEntity & { distance?: unknown }).distance;
  return {
    id: entity.id,
    name: entity.name.trim(),
    kind: placeKind(entity, input.fallback),
    tags: placeTags(entity),
    address: text(entity.properties?.address) ?? entity.disambiguation,
    distanceM: typeof distance === "number" && Number.isFinite(distance) ? Math.round(distance) : null,
    point: entity.location ? { lat: entity.location.lat, lon: entity.location.lon } : null,
    why: placeWhy(entity),
    rank: input.rank,
    affinity: entity.affinity,
    popularity: entity.popularity,
    chain: isChain(entity.name, input.knownChains),
    evidenceIds: [input.evidenceId],
  };
}

/** Why a place is left off the block, or null when it can be a partner, a gift card or a spot. Chains stay (marked). */
const WIRELESS = /^(t-mobile|metro by t-mobile|metropcs|cricket|boost|at&t|verizon|sprint|us cellular|straight talk|simple mobile)\b/i;

export function placeLeftOut(entity: QlooEntity): string | null {
  if (WIRELESS.test(entity.name.trim())) return "another wireless store";
  if (isAlcoholPlace(entity)) return "it is built around alcohol, and the table is on a public sidewalk";
  if (entity.tags.some((t) => ADULT_ONLY_TAG.test(t.name))) return "an adults-only nightlife spot, not a partner for a sidewalk table";
  if (checkText(entity.name).some((issue) => issue.rule === "minor")) return "it is aimed at kids";
  return null;
}
