// The poster's background art prompt, painted by fal (POSTER_MODEL), with every word set on top by code
// afterwards (lib/plan/poster-text.ts). The look follows the posters stores already put up, a bit
// cleaner: an illustrated neon scene on a dark ground, themed by the date (a haunted street with
// pumpkins and friendly ghosts on Halloween weekend, an autumn evening in November, and so on) and by
// the kept concept's hook, in the carrier's color set (colors only, never a logo). What Qloo measured
// still sets the craft: the city's music styles become energy and texture. No genre, artist, place,
// store, carrier or brand name ever reaches the prompt, and it always ends with the same exclusions: no
// text, no logos, no people. A deterministic check (checkPosterPrompt) refuses any prompt that breaks
// this. A plain module (no server imports): the UI and scripts can show the frozen prompt.
import { checkText, FAMOUS_PLACES, type GuardIssue } from "../guardrails";
import { hashOf } from "../hash";
import { POSTER_MODEL } from "../prompts/models.config";
import type { PlanReport, Store } from "./schema";
import { keptConcept } from "./poster-text";

/** Bumped when the template changes, so the render cache never serves art from an older template. */
export const POSTER_PROMPT_VERSION = 4;

/** Music style keywords to energy and texture (the carrier's set gives the colors). Matched against Qloo's style names, first match wins. */
export const STYLE_ENERGY: readonly { match: RegExp; energy: string }[] = [
  { match: /\bdrill\b/i, energy: "a cold haze, gritty concrete texture and sharp angular light" },
  { match: /jersey club|footwork|juke|\bclub\b|house|techno|electronic|\bedm\b|dance|future bass|french.?touch|chillwave|synth|garage|dubstep|\bbass\b/i, energy: "strobing light beams and a pulsing geometric glow" },
  { match: /\btrap\b|hip ?hop|\brap\b|crunk|bounce/i, energy: "heavy chrome highlights and a deep glow that feels like low bass" },
  { match: /r&b|rnb|rhythm and blues|soul|motown/i, energy: "a soft dreamy glow and smooth flowing light trails" },
  { match: /gospel|choir/i, energy: "radiant rays of warm light fanning out" },
  { match: /jazz|blues|swing/i, energy: "a smoky haze and a brass-like gleam" },
  { match: /reggaeton|dembow|latin trap|dancehall|afrobeat|afro ?pop|amapiano/i, energy: "bouncing glossy light and a sunlit sparkle" },
  { match: /cumbia|salsa|bachata|merengue|regional|corrido|banda|norte|tejano|mariachi|tropical/i, energy: "swinging rhythmic light trails and a hand-cut paper texture" },
  { match: /reggae|ska|dub\b/i, energy: "rolling waves of warm light and a soft offset print texture" },
  { match: /country|americana|bluegrass|folk/i, energy: "woodgrain and letterpress grain with a seventies print feel" },
  { match: /punk|rock|grunge|metal|emo|alternative|indie/i, energy: "photocopied zine grit and torn-paper edges" },
  { match: /k-?pop|j-?pop|\bpop\b/i, energy: "glossy bubbles of light and a playful sparkle" },
];

export const DEFAULT_ENERGY = "a bold neon glow and light print grain";

/** The closing rules every poster prompt carries, word for word. Pumpkins and cartoon ghosts may have faces; people may not. */
export const POSTER_EXCLUSIONS =
  "No text, no letters, no words, no numbers, no logos, no brand marks, no signs or signage, no people, no human faces, no hands, no crowds, no phones or devices, no flags, no money or trophies.";

/** Carrier and brand words that never appear in art prompts (the poster names the store in text only). */
export const BRAND_WORDS = ["Metro", "Metro by T-Mobile", "T-Mobile", "Cricket", "Cricket Wireless", "Boost", "Boost Mobile", "AT&T", "Verizon"] as const;

/** The carrier's color set, in words for the art (the text layer uses the same set as hex, poster-image.tsx). Colors only. */
export const CARRIER_ART_PALETTE: Record<Store["carrier"], string> = {
  metro: "a deep purple and black ground with neon purple, magenta, lime and orange glow",
  cricket: "a deep green and black ground with neon green, lime and gold glow",
  boost: "a deep brown and black ground with neon orange, amber and coral glow",
  other: "a deep charcoal ground with cool blue, white and gold glow",
};

/**
 * The scene for the event's date: Halloween weekend (October 15 to November 1) gets the haunted street,
 * and every other stretch of the year its own scene. Never school, never anything aimed at minors.
 */
export function seasonalScene(dateIso: string): string {
  const [, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const md = m * 100 + d;
  if (md >= 1015 && md <= 1101) return "a haunted city street at dusk with glowing carved pumpkins on the front steps, bats crossing a big moon, bare trees, drifting fog and a few friendly cartoon ghosts";
  if (m === 11) return "a city street on a crisp autumn evening with swirling fallen leaves, bare trees, warm string lights and steam rising from hot food";
  if (m === 12) return "a city street on a winter holiday night with string lights, light snow, wrapped gift boxes with plain ribbons and warm glowing windows";
  if (m === 2 && d <= 14) return "a city street at night with floating glowing hearts and string lights";
  if (m <= 2) return "a city street on a cold winter night with light snow, warm glowing windows and steam rising from hot food";
  if (m <= 5) return "a city street on a spring evening with blossoming trees, puddles reflecting neon light and string lights";
  if (m === 7 && d <= 5) return "a summer night over the city with fireworks bursting in the sky and string lights over the street";
  if (m <= 8) return "a city block party on a summer evening with string lights, a warm dusk sky and trees in full leaf";
  return "a city street on a late-summer evening with string lights, a warm dusk sky and leaves just starting to turn";
}

const SETTING_MOTIF: Record<PlanReport["inputs"]["setting"], string> = {
  sidewalk_table: "an empty folding table on the sidewalk with a small speaker",
  in_store: "a warm, cozy glow spilling out of an open doorway",
  nearby_venue: "the warm glow of a small venue down the block",
  community_event: "the bustle of an outdoor community fair with an empty booth under string lights",
};

/**
 * Up to two visual energies from the music, in this order: the genres of the artists the kept plan's
 * music lines name (what will really play at the table), then the city's music styles, then every
 * measured artist's genres. All of it is what Qloo returned for this run.
 */
export function visualEnergy(report: Pick<PlanReport, "local"> & Partial<Pick<PlanReport, "plan">>): string[] {
  const city = report.local.city;
  const artists = new Map((city?.artists ?? []).map((a) => [a.id, a]));
  const playing = (report.plan ? (keptConcept({ plan: report.plan })?.items ?? []) : []).filter((i) => i.kind === "music").flatMap((i) => i.refs.flatMap((ref) => artists.get(ref)?.genres ?? []));
  const styles = [...playing, ...(city?.styles.map((s) => s.name) ?? []), ...(city?.artists.flatMap((a) => a.genres) ?? [])];
  const energies: string[] = [];
  for (const style of styles) {
    const hit = STYLE_ENERGY.find((row) => row.match.test(style));
    if (hit && !energies.includes(hit.energy)) energies.push(hit.energy);
    if (energies.length === 2) break;
  }
  return energies.length > 0 ? energies : [DEFAULT_ENERGY];
}

/** Every real name the run knows, plus the store's own words: none may reach the art prompt. */
export function posterBannedNames(report: Pick<PlanReport, "local" | "inputs">): string[] {
  const { store } = report.inputs;
  return [
    ...(report.local.city?.artists.map((a) => a.name) ?? []),
    ...(report.local.block?.places.map((p) => p.name) ?? []),
    ...(report.local.city?.styles.map((s) => s.name) ?? []),
    ...(report.local.city?.artists.flatMap((a) => a.genres) ?? []),
    store.name,
    store.city,
    ...(report.inputs.location ? [report.inputs.location.name] : []),
    ...BRAND_WORDS,
    ...FAMOUS_PLACES,
  ];
}

/** A ref token, with the small word that leads into it ("from [[id]]"), so removing it leaves a sentence. */
const REF = /(?:\s+(?:from|at|with|by|of|near|like|in the spirit of))?\s*\[\[[A-Za-z0-9-]+\]\]/gi;

/**
 * The feeling to evoke, from the kept concept's hook (else its title): refs removed, and dropped
 * entirely when it names anything, carries a number or quote, or breaks a guardrail.
 */
export function posterFeeling(report: Pick<PlanReport, "plan" | "local" | "inputs">): string | null {
  const concept = keptConcept(report);
  if (!concept) return null;
  const names = posterBannedNames(report);
  for (const raw of [concept.hook, concept.title]) {
    const text = raw.replace(REF, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
    if (text.length < 8) continue;
    if (/[0-9"“”$#@]/.test(text)) continue;
    if (/\b(?:from|at|with|by|of|near)\s*[,.]?$/i.test(text)) continue;
    if (checkText(text, { names }).length > 0) continue;
    return raw === concept.title ? text.toLowerCase() : text.charAt(0).toLowerCase() + text.slice(1);
  }
  return null;
}

export interface PosterPrompt {
  prompt: string;
  promptHash: string;
  /** What fal is sent. */
  input: Record<string, unknown>;
}

/** The most new versions of the art one plan may ask for, after its first poster. */
export const MAX_POSTER_VERSIONS = 3;

/**
 * The fal input for a prompt: one image, 4:5, at the cheap 1K setting. A new version (1 and up) adds a
 * seed, so the same frozen prompt paints a different background under its own hash and cache entry;
 * version 0 sends no seed, so a plan's first poster keeps the hash it always had.
 */
export function posterFalInput(prompt: string, version = 0): Record<string, unknown> {
  return { prompt, num_images: 1, aspect_ratio: POSTER_MODEL.aspectRatio, resolution: POSTER_MODEL.resolution, output_format: "png", ...(version > 0 ? { seed: version } : {}) };
}

export function posterPromptHash(input: Record<string, unknown>): string {
  return hashOf({ kind: "event-poster-art", templateVersion: POSTER_PROMPT_VERSION, endpoint: POSTER_MODEL.endpoint, input });
}

/** The scene, the theme, the carrier's colors and the music's energy, in that order, then the exclusions. */
export function buildPosterPrompt(report: Pick<PlanReport, "plan" | "local" | "inputs">, version = 0): PosterPrompt {
  const feeling = posterFeeling(report);
  const prompt = [
    "An illustrated neon scene in portrait format, made to sit behind type and cards that are added later.",
    `Scene: ${seasonalScene(report.inputs.date)}, with ${SETTING_MOTIF[report.inputs.setting]}.`,
    ...(feeling ? [`Theme to show: ${feeling}.`] : []),
    `Palette: ${CARRIER_ART_PALETTE[report.inputs.store.carrier]}.`,
    `Energy and texture: ${visualEnergy(report).join("; ")}.`,
    "Style: bold glowing digital illustration with neon rim light on a rich dark ground, clean and uncluttered, one clear focal scene, full-bleed to every edge with no border, frame, blank panels or empty boxes.",
    "Composition: the illustration frames the edges and corners; the top fifth, a wide band across the middle and the bottom third stay dark and quiet so type and cards can sit on them.",
    POSTER_EXCLUSIONS,
  ].join(" ");
  const input = posterFalInput(prompt, version);
  return { prompt, promptHash: posterPromptHash(input), input };
}

/**
 * Every reason a poster art prompt may not render: the shared guardrails, any real name the run knows,
 * the store's own words, digits, quotes, a missing exclusion clause, or asking for text or a logo.
 */
export function checkPosterPrompt(prompt: string, report: Pick<PlanReport, "local" | "inputs">): GuardIssue[] {
  const issues = checkText(prompt, { names: posterBannedNames(report), exactCaseNames: false });
  const add = (match: string, message: string) => issues.push({ rule: "named-reference", match, message });
  if (!prompt.endsWith(POSTER_EXCLUSIONS)) add("exclusions", "The prompt must end with the poster exclusions (no text, no logos, no people).");
  const body = prompt.slice(0, prompt.length - POSTER_EXCLUSIONS.length);
  if (/\d/.test(body)) add("digit", "Numbers never reach the art prompt: dates, prices and times are set as text by code.");
  if (/["“”]/.test(body)) add("quote", "Quoted words invite the model to paint them as text.");
  for (const word of [/\blogos?\b/i, /\btypography\b/i, /\blettering\b/i, /\bheadline\b/i, /\bslogan\b/i, /\bposter\b/i, /\bflyer\b/i, /\bportrait of\b/i, /\bperson\b/i, /\bpeople\b/i, /\bcrowd\b/i, /\btroph(?:y|ies)\b/i, /\bcash\b/i, /\bmoney\b/i, /\bwinners?\b/i, /\bcontest\b/i]) {
    const match = body.match(word)?.[0];
    if (match) add(match, `"${match}" asks for text, a logo, people or contest imagery in the art.`);
  }
  for (const word of [report.inputs.store.address, report.inputs.location?.name, ...report.inputs.offers.map((o) => o.text)]) {
    if (word && prompt.toLowerCase().includes(word.toLowerCase())) add(word, "The store's address and offers are set as text by code, never painted.");
  }
  return issues;
}
