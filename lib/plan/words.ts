// Words a plan's copy never uses, shared by the plan's guard and the posts (lib/plan/posts.ts). A
// playlist is an ingredient, not a label for the people walking by: naming a genre in a title, or
// framing music as something "you can hear from down the block", turns taste into identity, which
// Stoop's rules forbid. The music is the city's most-played artists, by key.

/** Music genres and community slang: never in plan copy, posts or hashtags. */
export const GENRE_AND_SLANG = ["trap", "drill", "rap", "hip hop", "hip-hop", "hiphop", "gangsta", "crunk", "dirty south", "reggaeton", "banda", "corridos", "norteno", "norteño", "mariachi", "hood", "ghetto", "thug", "ratchet"];

/** Further genre names a title or hook never carries: a title comes from the occasion, the activity, the food or the place. */
export const TITLE_GENRES = [
  "r&b", "rnb", "soul", "neo soul", "country", "latin", "latino", "cumbia", "salsa", "bachata", "merengue", "tejano", "ranchera", "dancehall",
  "reggae", "afrobeat", "afrobeats", "amapiano", "k-pop", "kpop", "jersey club", "bounce", "edm", "techno", "house music", "punk", "metal",
  "gospel", "blues", "jazz", "bluegrass", "zydeco", "grime", "boom bap", "lo-fi", "emo", "indie rock", "pop punk",
];

/** Music framed by how far it carries: the playlist is an ingredient, never a volume pitch. */
export const VOLUME_FRAMING =
  /\b(hear|heard|carr(y|ies|ying)|loud|blast\w*|bump\w*|crank\w*|boom\w*)\b[^.]{0,40}\b(down the (block|street|lane)|from down|across the|a block away|half a block|the whole block|down the fair)\b|\b(loud enough|cranked up|bass you can hear|you can hear it)\b/i;

const wordRe = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s-]+")}(?![\\p{L}\\p{N}])`, "iu");
const GENRE_RES = GENRE_AND_SLANG.map((w) => [w, wordRe(w)] as const);
const TITLE_RES = [...GENRE_AND_SLANG, ...TITLE_GENRES].map((w) => [w, wordRe(w)] as const);

/** The first genre or slang word in plan copy, or null. */
export function genreOrSlang(text: string): string | null {
  return GENRE_RES.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** The first genre word a title or hook carries (the wider list), or null. */
export function titleGenre(text: string): string | null {
  return TITLE_RES.find(([, re]) => re.test(text))?.[0] ?? null;
}
