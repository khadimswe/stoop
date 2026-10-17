// The grounding guard: what the Culture agent submits is checked against what Qloo returned for this
// world before any of it reaches a brief. The agent cites ids only; names are rendered from the run's
// candidates. A cite must be one of this world's candidates for that field and at or above the panel
// median (the self-critique: a weak pick is dropped, not argued for). Wording must pass the
// guardrails and name nothing real: no artist, film, brand, person or place name (the setting city
// is the one allowed place). Problems go back to the agent once; whatever still fails is dropped.
import { z } from "zod";
import { checkText, FAMOUS_PLACES, stripEmDashes, unsupportedClaims } from "../guardrails";
import type { CultureField } from "../report/world";
import type { CultureCandidate } from "../stages/culture";

const cue = z.object({
  text: z.string().describe("The direction in plain craft words. No real names of any kind."),
  cites: z.array(z.string()).describe("Ids of the candidates this cue rests on (from the lists you were given)"),
});

/** What the agent submits: per field, wording plus the ids it rests on. Never names. */
export const briefSubmissionSchema = z.object({
  music: cue.describe("Music feel: genre, era, tempo and instrumentation, from the artists and music tags. Never a song or an artist."),
  visual: cue.describe("Visual language: color grade, lens, grain, framing, pacing and edit rhythm, from the films and shows."),
  wardrobe: cue.nullable().describe("Styling from the brands, described as styling only, no logos. Null when no brand fits."),
  setting: z.array(cue).describe("1 to 3 settings: place types in the setting city, from the places and their tags."),
  mood: cue.describe("One line of feeling, from the mood tags."),
  voice: z.object({
    tone: cue.describe("Tone and pacing of voice and on-screen text, from the mood tags and the podcasts."),
    use: z.array(z.string()).describe("Up to 5 words or phrases to use"),
    avoid: z.array(z.string()).describe("Up to 5 words, cliches or framings to avoid"),
  }),
  talent: cue
    .nullable()
    .describe("A fictional adult, described by styling and energy only (never age under 18, race, ethnicity or a real person). Null for product-only and pet ads."),
  productRole: z.string().describe("What the product really does on screen"),
  hooks: z.array(z.string()).describe("Up to 3 hook ideas, each one line"),
  creators: cue.nullable().describe("The kind of creator to partner with, from the people and podcasts, without naming anyone."),
});
export type BriefSubmission = z.infer<typeof briefSubmissionSchema>;

/** Brief slots and the candidate fields each may cite. */
export const SLOT_FIELDS = {
  music: ["music"],
  visual: ["visual"],
  wardrobe: ["wardrobe"],
  setting: ["setting"],
  mood: ["mood"],
  "voice.tone": ["mood", "creators"],
  talent: ["wardrobe", "visual"],
  creators: ["creators"],
} as const satisfies Record<string, readonly CultureField[]>;
export type CitingSlot = keyof typeof SLOT_FIELDS;

export interface GuardContext {
  candidates: readonly CultureCandidate[];
  /** Every real name the run knows (seeds, candidates, references): none may appear in wording. */
  names: readonly string[];
  /** Places a cue may name: the world's setting city. */
  allowedPlaces: readonly string[];
  /** False for product-only and pet ads: the talent cue is dropped. */
  talent: boolean;
  /** Everything the seller said about the product: the only product facts wording may state. */
  sellerText: string;
}

export interface GuardedCue {
  text: string;
  /** The candidates this cue rests on, after the guard. */
  cites: CultureCandidate[];
}

export interface GuardedBrief {
  music: GuardedCue | null;
  visual: GuardedCue | null;
  wardrobe: GuardedCue | null;
  setting: GuardedCue[];
  mood: GuardedCue | null;
  voice: { tone: GuardedCue | null; use: string[]; avoid: string[] };
  talent: GuardedCue | null;
  productRole: string | null;
  hooks: string[];
  creators: GuardedCue | null;
}

export interface GuardResult {
  brief: GuardedBrief;
  /** What was wrong, for the agent's one repair and for the trace. Empty when it passed. */
  problems: string[];
  /** Picks dropped because they rank below the panel median (the self-critique). */
  belowMedian: CultureCandidate[];
}

/** Notes about how a cue is labeled ("tempo is interpretation") would reach the prompts; the report labels cues itself. */
const LABEL_NOTE = /\binterpret(?:ation|ed)\b|\bnot from qloo\b|\bcreative suggestion\b/i;

/** Settings that invite children into frame. Every audience and every person on screen is an adult. */
const CHILD_SETTING = /\bfamily[- ]friendly\b|\bkid[- ]friendly\b|\bfor the whole family\b|\bplayground\b/i;

const textProblems = (path: string, text: string, ctx: GuardContext, copy = false): string[] => [
  ...(CHILD_SETTING.test(text) ? [`${path}: "${text.match(CHILD_SETTING)?.[0]}" invites children into frame; every person on screen is an adult`] : []),
  // Quantities and prices anywhere; claim words only in copy (the product's role, hooks, words to use).
  ...unsupportedClaims(text, ctx.sellerText, { phrases: copy }).map((claim) => `${path}: "${claim}" is a product fact the seller never gave`),
  ...checkText(text, { names: [...ctx.names, ...FAMOUS_PLACES], allowedNames: ctx.allowedPlaces, exactCaseNames: true }).map((issue) => `${path}: ${issue.message}`),
  ...(LABEL_NOTE.test(text) ? [`${path}: leave out notes about labels or interpretation; write only the direction itself`] : []),
];

/** Wording without wrapping quotes the model sometimes adds. */
const unquote = (text: string) => text.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").trim();

/** Checks one submission. Returns what passes, plus every problem found. */
export function guardBrief(submission: BriefSubmission, ctx: GuardContext): GuardResult {
  const clean = stripEmDashes(submission);
  const byId = new Map(ctx.candidates.map((c) => [c.id, c]));
  const problems: string[] = [];
  const belowMedian: CultureCandidate[] = [];

  const guardCue = (slot: CitingSlot, path: string, value: { text: string; cites: string[] } | null): GuardedCue | null => {
    if (!value) return null;
    const text = unquote(value.text);
    const issues = text ? textProblems(path, text, ctx) : [`${path}: the text is empty`];
    problems.push(...issues);
    const cites: CultureCandidate[] = [];
    for (const id of [...new Set(value.cites)]) {
      const candidate = byId.get(id);
      if (!candidate) {
        problems.push(`${path}: cites an id that is not one of this world's candidates`);
        continue;
      }
      if (!(SLOT_FIELDS[slot] as readonly CultureField[]).includes(candidate.field)) {
        problems.push(`${path}: cites ${candidate.name}, which backs ${candidate.field}, not ${slot}`);
        continue;
      }
      if (candidate.position?.aboveMedian === false) {
        belowMedian.push(candidate);
        problems.push(`${path}: ${candidate.name} ranks below the panel median for this world (beats ${candidate.position.beats} of ${candidate.position.of}); cite stronger picks`);
        continue;
      }
      cites.push(candidate);
    }
    return issues.length ? null : { text, cites };
  };

  const plain = (path: string, text: string): string | null => {
    const trimmed = unquote(text);
    if (!trimmed) return null;
    const issues = textProblems(path, trimmed, ctx, true);
    problems.push(...issues);
    return issues.length ? null : trimmed;
  };
  const list = (path: string, items: readonly string[], max: number, avoidList = false) =>
    items
      .slice(0, max)
      .map((item, i) => {
        const trimmed = unquote(item);
        // An avoid list names banned claims in order to forbid them.
        const issues = checkText(trimmed, { names: [...ctx.names, ...FAMOUS_PLACES], allowedNames: ctx.allowedPlaces, exactCaseNames: true })
          .filter((issue) => !avoidList || (issue.rule !== "health-claim" && issue.rule !== "fake-proof"))
          .map((issue) => `${path}.${i}: ${issue.message}`);
        // Hooks and words to use are copy: they state only facts the seller gave. An avoid list names claims to forbid them.
        if (!avoidList) issues.push(...unsupportedClaims(trimmed, ctx.sellerText).map((claim) => `${path}.${i}: "${claim}" is a product fact the seller never gave`));
        problems.push(...issues);
        return trimmed && !issues.length ? trimmed : null;
      })
      .filter((item): item is string => Boolean(item));

  if (clean.setting.length === 0) problems.push("setting: give at least one setting");
  if (clean.setting.length > 3) problems.push("setting: at most 3 settings");
  const brief: GuardedBrief = {
    music: guardCue("music", "music", clean.music),
    visual: guardCue("visual", "visual", clean.visual),
    wardrobe: guardCue("wardrobe", "wardrobe", clean.wardrobe),
    setting: clean.setting.slice(0, 3).flatMap((s, i) => {
      const guarded = guardCue("setting", `setting.${i}`, s);
      return guarded ? [guarded] : [];
    }),
    mood: guardCue("mood", "mood", clean.mood),
    voice: { tone: guardCue("voice.tone", "voice.tone", clean.voice.tone), use: list("voice.use", clean.voice.use, 5), avoid: list("voice.avoid", clean.voice.avoid, 5, true) },
    talent: ctx.talent ? guardCue("talent", "talent", clean.talent) : null,
    productRole: plain("productRole", clean.productRole),
    hooks: list("hooks", clean.hooks, 3),
    creators: guardCue("creators", "creators", clean.creators),
  };
  if (!ctx.talent && clean.talent) problems.push("talent: this ad has no on-screen person (product-only or pet), so leave talent null");
  return { brief, problems, belowMedian };
}
