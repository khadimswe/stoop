// Receipt deep links: "/examples/<slug>#receipt-music" scrolls to the Screening Room and opens the
// music style receipt of the first world that carries one (demo beat 3; /judges links here, and any
// page can). The generic form is "#receipt-<cue>": a brief cue (music, visual, wardrobe, setting,
// mood, voice) or a world fact (age, cities, setting-city). Plain strings, safe in the browser.
import type { BriefSlot } from "../../prompts/brief";

const PREFIX = "#receipt-";

/** Other words a link may use for the same cue. */
const ALIASES: Readonly<Record<string, string>> = { "music-style": "music", look: "visual", "voice-tone": "voice", tone: "voice", city: "setting-city" };

/** The world facts a Screening Room row carries, by deep-link key. */
export const FACT_KEYS = { skew: "age", topCities: "cities", setting: "setting-city" } as const;

/** A brief slot's deep-link key: "voice.tone" is "voice", every setting is "setting". */
export function cueKeyOf(slot: BriefSlot | string): string {
  if (slot.startsWith("setting.")) return "setting";
  if (slot === "voice.tone") return "voice";
  return slot.toLowerCase();
}

/** The cue a hash asks for ("#receipt-music" is "music"), or null when it is not a receipt link. */
export function receiptKeyOf(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  let key: string;
  try {
    key = decodeURIComponent(hash.slice(PREFIX.length)).trim().toLowerCase();
  } catch {
    return null;
  }
  if (!/^[a-z][a-z-]{0,31}$/.test(key)) return null;
  return ALIASES[key] ?? key;
}

/** The hash for a cue's receipt: receiptHash("music") is "#receipt-music". */
export const receiptHash = (key: string) => `${PREFIX}${key}`;
