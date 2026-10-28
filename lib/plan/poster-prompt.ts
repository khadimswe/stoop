// The poster's background art prompt: abstract art only, painted by fal (POSTER_MODEL), with every word
// set on top by code afterwards (lib/plan/poster-text.ts). The style comes from what Qloo measured, the
// way Stoop turns taste into craft: the city's music styles become visual energy (grade, palette,
// texture, era) and the kept concept's hook sets the feeling. No genre, artist, place, store, carrier
// or brand name ever reaches the prompt, and it always ends with the same exclusions: no text, no
// logos, no people. A deterministic check (checkPosterPrompt) refuses any prompt that breaks this.
// A plain module (no server imports): the UI and scripts can show the frozen prompt.
import { checkText, FAMOUS_PLACES, type GuardIssue } from "../guardrails";
import { hashOf } from "../hash";
import { POSTER_MODEL } from "../prompts/models.config";
import type { PlanReport } from "./schema";
import { keptConcept } from "./poster-text";

/** Bumped when the template changes, so the render cache never serves art from an older template. */
export const POSTER_PROMPT_VERSION = 2;

/** Music style keywords to visual energy. Matched against Qloo's style names, first match wins. */
export const STYLE_ENERGY: readonly { match: RegExp; energy: string }[] = [
  { match: /\bdrill\b/i, energy: "a cold blue and steel grey grade, grainy concrete texture, sharp angular shapes and hard contrast" },
  { match: /jersey club|footwork|juke|\bclub\b|house|techno|electronic|\bedm\b|dance|future bass|french.?touch|chillwave|synth|garage|dubstep|\bbass\b/i, energy: "bright strobing geometry, stacked repeating shapes, saturated neon accents on a dark ground, a fast rhythmic pattern" },
  { match: /\btrap\b|hip ?hop|\brap\b|crunk|bounce/i, energy: "a deep violet and warm amber grade, chrome highlights, heavy rounded shapes that feel like low bass, crisp hard edges" },
  { match: /r&b|rnb|rhythm and blues|soul|motown/i, energy: "a warm dusk grade, soft gradients of rose, plum and gold, gentle film grain, smooth flowing curves" },
  { match: /gospel|choir/i, energy: "radiant warm gold light, rays fanning out from the center, clean uplifting shapes" },
  { match: /jazz|blues|swing/i, energy: "smoky midnight blue and brass tones, loose confident brush strokes, a sixties print texture" },
  { match: /reggaeton|dembow|latin trap|dancehall|afrobeat|afro ?pop|amapiano/i, energy: "hot coral, lime and bright teal, bouncing rounded shapes, glossy sunlit highlights" },
  { match: /cumbia|salsa|bachata|merengue|regional|corrido|banda|norte|tejano|mariachi|tropical/i, energy: "a warm sunlit palette of tangerine, turquoise and marigold, swinging rhythmic curves, a hand-cut paper texture" },
  { match: /reggae|ska|dub\b/i, energy: "a sun-warmed palette, rolling wave shapes, soft offset print texture" },
  { match: /country|americana|bluegrass|folk/i, energy: "sun-faded denim blue and rust, woodgrain and letterpress texture, a seventies print feel" },
  { match: /punk|rock|grunge|metal|emo|alternative|indie/i, energy: "a photocopied zine texture, torn paper edges, high-contrast black with one loud accent color" },
  { match: /k-?pop|j-?pop|\bpop\b/i, energy: "a clean candy-bright palette, glossy bubbles of color, playful bold shapes" },
];

export const DEFAULT_ENERGY = "a warm late-afternoon palette, bold flat shapes and light print grain";

/** The closing rules every poster prompt carries, word for word. */
export const POSTER_EXCLUSIONS =
  "No text, no letters, no words, no numbers, no logos, no brand marks, no signs or signage, no people, no faces, no hands, no crowds, no phones or devices, no flags.";

/** Carrier and brand words that never appear in art prompts (the poster names the store in text only). */
export const BRAND_WORDS = ["Metro", "Metro by T-Mobile", "T-Mobile", "Cricket", "Cricket Wireless", "Boost", "Boost Mobile", "AT&T", "Verizon"] as const;

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

/** Light from the start time. */
export function eventLight(startTime: string): string {
  const hour = Number(startTime.slice(0, 2));
  if (hour < 11) return "clear morning light";
  if (hour < 16) return "bright afternoon sun";
  if (hour < 19) return "low golden-hour light";
  return "an evening glow under streetlights";
}

const SETTING_FEEL: Record<PlanReport["inputs"]["setting"], string> = {
  sidewalk_table: "open-air sidewalk energy",
  in_store: "a warm indoor glow",
  nearby_venue: "the buzz of a night out nearby",
  community_event: "the bustle of an outdoor community fair",
};

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

/** The fal input for a prompt: one image, 4:5, at the cheap 1K setting. */
export function posterFalInput(prompt: string): Record<string, unknown> {
  return { prompt, num_images: 1, aspect_ratio: POSTER_MODEL.aspectRatio, resolution: POSTER_MODEL.resolution, output_format: "png" };
}

export function posterPromptHash(input: Record<string, unknown>): string {
  return hashOf({ kind: "event-poster-art", templateVersion: POSTER_PROMPT_VERSION, endpoint: POSTER_MODEL.endpoint, input });
}

export function buildPosterPrompt(report: Pick<PlanReport, "plan" | "local" | "inputs">): PosterPrompt {
  const feeling = posterFeeling(report);
  const prompt = [
    "Background art only, in portrait format: abstract and graphic, made to sit behind type that is added later.",
    `Visual energy: ${visualEnergy(report).join("; ")}.`,
    `Light and feel: ${eventLight(report.inputs.startTime)}, ${SETTING_FEEL[report.inputs.setting]}.`,
    ...(feeling ? [`The feeling to evoke: ${feeling}.`] : []),
    "Composition: the strongest shapes and color sit in the middle band; the top fifth and the bottom third stay calm, simple and darker so type can sit on them.",
    "Finish: printed texture with fine grain.",
    POSTER_EXCLUSIONS,
  ].join(" ");
  const input = posterFalInput(prompt);
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
  for (const word of [/\blogos?\b/i, /\btypography\b/i, /\blettering\b/i, /\bheadline\b/i, /\bslogan\b/i, /\bposter\b/i, /\bflyer\b/i, /\bportrait of\b/i, /\bperson\b/i, /\bpeople\b/i, /\bcrowd\b/i]) {
    const match = body.match(word)?.[0];
    if (match) add(match, `"${match}" asks for text, a logo or people in the art.`);
  }
  for (const word of [report.inputs.store.address, report.inputs.location?.name, ...report.inputs.offers.map((o) => o.text)]) {
    if (word && prompt.toLowerCase().includes(word.toLowerCase())) add(word, "The store's address and offers are set as text by code, never painted.");
  }
  return issues;
}
