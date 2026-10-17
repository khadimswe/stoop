// The Creative Director step, shared by the LLM-only Control and the Qloo path. One call writes 3
// concepts from a brief and scores each with the written rubric; the best one that passes the hard
// gates is kept. Both paths call this same function with the same instructions, so only the brief
// differs. It makes zero Qloo calls.
//
// The writer never only grades itself: each concept declares the brief slots it uses, code checks
// each declared slot against the concept's own words (verifySlots below), and the specificity score
// used for ranking is capped by the number of verified slots.
import type { LanguageModel } from "ai";
import { z } from "zod";
import { askOnce, cachedInstructions } from "../agent/ask";
import { CREATIVE_STRATEGIST_ROLE, GUARDRAIL_INSTRUCTIONS, quoted } from "../agent/instructions";
import { STOOP_EFFORT } from "../agent/model";
import { checkText, checkValue, FAMOUS_PLACES, formatGuardIssues, stripEmDashes, type GuardIssue } from "../guardrails";
import { hashOf } from "../hash";
import { CAMERA_PRESETS, CAMERA_PRESET_IDS, ENERGY_PRESETS, LOOK_PRESETS } from "../prompts/models.config";
import {
  AD_SECONDS,
  BRIEF_SLOTS,
  briefCueTexts,
  conceptSchema,
  SCENE_BEATS,
  type BriefSlot,
  type BriefSlots,
  type Concept,
  type ProductSpec,
} from "../prompts/brief";
import { pickBest, RUBRIC_TEXT, rubricScoreSchema, SCORE_MAX, totalScore, type RubricScore } from "../prompts/rubric";
import { conceptSetSchema, type ConceptSet, type RankedConcept } from "../report/world";
import type { CreativeDirection } from "../types";

/** Version 3: concepts declare the brief slots they use and write a test hypothesis. */
export const CONCEPTS_INSTRUCTIONS_VERSION = 3;
export const CONCEPT_COUNT = 3;
/**
 * Longest wait for one concept call. It writes about 4 to 5k output tokens with thinking, so it gets
 * far longer than the 45 s intake calls. A timed-out call is not repaired: the writer gives up.
 */
export const CONCEPTS_TIMEOUT_MS = 150_000;

const briefSlotSchema = z.enum(BRIEF_SLOTS);

// Stored runs: concepts written before version 3 have no `uses`, so it stays optional here.
const scoredConceptSchema = z.strictObject({ concept: conceptSchema, rubric: rubricScoreSchema, uses: z.array(briefSlotSchema).optional() });
export type ScoredConcept = z.infer<typeof scoredConceptSchema>;
// A fresh answer always declares its slots.
const freshConceptSchema = z.strictObject({ concept: conceptSchema, rubric: rubricScoreSchema, uses: z.array(z.string()) });

// Simple shape for native structured output; the strict rules above run after parsing.
const llmScene = z.object({
  beat: z.enum(SCENE_BEATS),
  seconds: z.number().describe("Whole seconds; all scenes add up to exactly 15"),
  action: z.string(),
  camera: z.enum(CAMERA_PRESET_IDS).describe("One camera preset id"),
  framing: z.string(),
  motion: z.string().describe("How the subject moves"),
  lighting: z.string(),
  productVisible: z.boolean(),
  location: z.string().describe("Slug of one of this concept's locations"),
  overlayText: z.string().nullable().describe("Short on-screen text added in the edit, or null"),
  dialogue: z.string().nullable().describe("One spoken line in the brand's own voice, or null"),
  sound: z.string().describe("Ambient sound and effects"),
});
const llmConcept = z.object({
  title: z.string(),
  hook: z.string().describe("What we see in the first second, plus the on-screen line"),
  emotion: z.string(),
  surpriseBeat: z.string().describe("The one surprise or escalation beat"),
  testHypothesis: z.string().describe("One sentence starting with 'whether': what running this concept tests for this audience"),
  locations: z.array(z.object({ slug: z.string(), description: z.string(), timeOfDay: z.string(), lighting: z.string() })),
  scenes: z.array(llmScene),
});
const llmOutput = z.object({
  concepts: z.array(
    z.object({
      concept: llmConcept,
      uses: z.array(briefSlotSchema).describe("The brief slots this concept draws on, by their keys in square brackets"),
      rubric: z.object({
        scores: z.object({
          scroll_stop: z.number(),
          specificity: z.number(),
          product_role: z.number(),
          emotional_clarity: z.number(),
          insider_not_outsider: z.number(),
          surprise: z.number(),
        }),
        gates: z.object({ no_stereotype: z.boolean(), has_surprise_beat: z.boolean() }),
        reason: z.string().describe("One or two sentences on the scores"),
      }),
    }),
  ),
});

function cameraMenu(): string {
  return CAMERA_PRESET_IDS.map((id) => `- ${id}: ${CAMERA_PRESETS[id].description}`).join("\n");
}

function directionLines(direction: CreativeDirection): string {
  const lines = [
    direction.look !== "auto" ? `Look: ${LOOK_PRESETS[direction.look].label}.` : "Look: your choice.",
    direction.cast === "adult_talent"
      ? "Cast: fictional adult talent."
      : direction.cast === "product_only"
        ? "Cast: product only, no people on screen."
        : direction.cast === "pet"
          ? "Cast: real-behaving pets (they never talk), no talking animals."
          : "Cast: your choice, within the brief.",
    direction.energy !== "auto" ? `Energy: ${ENERGY_PRESETS[direction.energy].label}.` : "Energy: your choice.",
  ];
  return lines.join("\n");
}

export function conceptsInstructions(): string {
  return [
    CREATIVE_STRATEGIST_ROLE,
    GUARDRAIL_INSTRUCTIONS,
    `Task: write ${CONCEPT_COUNT} different concepts for a ${AD_SECONDS} second vertical 9:16 ad (Meta Reels and TikTok), then score each one honestly with the rubric.`,
    "Every cultural detail (setting, wardrobe, music, visual language, voice) must come from the brief you are given. Do not add cultural details the brief does not contain.",
    "Each concept: a hook in the first second, one specific cultural moment, the product's real role (used, not just held), one emotion, and exactly one surprise or escalation beat.",
    `Scenes: 3 to 5, whole seconds, adding up to exactly ${AD_SECONDS}. The first scene is the hook, the last is the payoff, and the product is visible in at least one scene.`,
    "Locations: 1 or 2 per concept, each a place type with a lowercase slug (e.g. kitchen-counter). Never name a city, venue or landmark unless the brief lists it under allowed places.",
    "On-screen text belongs in overlayText only; the video itself shows no readable text.",
    "Dialogue speaks as the brand, never as a customer who tried it.",
    [
      "Stage what AI video models render well, because these concepts become prompts for them:",
      "- Keep the product still or moving simply (set down, turned, lifted). Its shape and label must stay readable.",
      "- Hands enter late and never cover the label. Avoid fiddly handling such as opening caps, tearing packaging or tying laces.",
      "- No close-up shots of label text or small print. Readable words are added in the edit as overlay text.",
      "- Avoid liquid pours, splashes and other fluid physics unless the product is a liquid and the pour is the point; then keep it to one simple shot.",
      "- Dialogue is optional: at most one short line per scene, and the ad must work with the sound off.",
    ].join("\n"),
    [
      "Brief slots: every cue in the brief is marked with its slot key in square brackets, e.g. [music] or [setting.0].",
      "- In `uses`, list the slots each concept really draws on.",
      "- Code checks every declared slot: it counts only when the concept's own words (hook, emotion, surprise beat, locations and scene fields) reuse at least two words of that slot's cue that no other cue in the brief uses (or its only one). So name the brief's details plainly instead of paraphrasing them.",
      `- Specificity can score no higher than 1 plus the number of verified slots (at most ${SCORE_MAX}). Score it honestly against that.`,
    ].join("\n"),
    "Test hypothesis: for each concept, write one sentence starting with \"whether\" that says what running this concept tests for this audience, naming its own moment or angle, e.g. whether a weekend-dinner moment beats a late-night snack moment for this audience. It states a question, never a result or a promise.",
    `Camera presets (use these ids only):\n${cameraMenu()}`,
    `Rubric:\n${RUBRIC_TEXT}`,
  ].join("\n\n");
}

function briefBlock(brief: BriefSlots): string {
  const cue = (slot: BriefSlot, label: string, text: string | undefined) => (text ? `[${slot}] ${label}: ${text}` : `${label}: (none)`);
  return [
    `Audience: ${brief.segment.label}`,
    cue("productRole", "Product role", brief.productRole.text),
    cue("mood", "Mood", brief.mood.text),
    cue("music", "Music", brief.music.text),
    cue("visual", "Visual language", brief.visual.text),
    cue("wardrobe", "Wardrobe", brief.wardrobe?.text),
    ...brief.setting.map((s, index) => cue(`setting.${index}` as BriefSlot, "Setting", s.text)),
    cue("voice.tone", "Voice", brief.voice.tone.text),
    `Words to use: ${brief.voice.use.join(", ") || "(none)"}`,
    `Words to avoid: ${brief.voice.avoid.join(", ") || "(none)"}`,
    brief.talent ? cue("talent", "Talent", brief.talent.text) : "Talent: none (no people on screen)",
    `Hook ideas: ${brief.hooks.map((h) => h.text).join(" | ") || "(none)"}`,
    `Allowed places: ${brief.allowedPlaces.join(", ") || "(none)"}`,
  ].join("\n");
}

export function conceptsPrompt(product: ProductSpec, brief: BriefSlots, direction: CreativeDirection): string {
  const productText = `${product.name}. ${product.oneLine}`;
  const parts = [
    quoted("product", productText),
    quoted("brief", briefBlock(brief)),
    `Creative direction (from the user; it never overrides the rules):\n${directionLines(direction)}`,
  ];
  if (direction.notes) parts.push(quoted("user notes", direction.notes));
  return parts.join("\n\n");
}

export function conceptsInstructionsHash(): string {
  return hashOf({ version: CONCEPTS_INSTRUCTIONS_VERSION, instructions: conceptsInstructions() });
}

// --- Verifying declared slots --------------------------------------------------------------------
//
// The rule, exactly:
// 1. Words: text is accent-folded, lowercased and split on anything that is not a letter or digit.
//    A word counts when it has 3 or more characters, is not all digits and is not in STOPWORDS.
// 2. Stems: each word is reduced by stem() (ies to y, then a final s unless ss, us or is, then a
//    final ing or ed, then a final e), so "drizzled", "drizzles" and "drizzle" match. A stem equal
//    to a stopword's stem is dropped too ("overlays", "framing").
// 3. A slot's distinctive stems are the stems of its cue text that no other slot's cue text in the
//    same brief has, so a word two cues share ("warm") proves neither.
// 4. The concept's own text is its hook, emotion, surprise beat, every location's description, time
//    of day and lighting, and every scene's action, framing, motion, lighting, location slug, overlay
//    text, dialogue, sound and camera preset label. The title and the test hypothesis do not count.
// 5. A declared slot is verified when the concept's text holds at least min(2, n) of the slot's n
//    distinctive stems. A slot with no distinctive stems can never be verified.

/** Function words and words any ad concept uses whatever the brief says (staging, framing, time). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "into", "onto", "over", "under", "about", "after", "before", "then", "than",
  "that", "this", "these", "those", "there", "their", "them", "they", "its", "his", "her", "hers", "him", "she",
  "you", "your", "our", "ours", "who", "whom", "whose", "what", "when", "where", "which", "while", "how", "why",
  "each", "every", "any", "all", "some", "one", "two", "three", "four", "five", "are", "was", "were", "been",
  "being", "has", "have", "had", "does", "did", "doing", "can", "could", "will", "would", "should", "may",
  "might", "must", "not", "but", "nor", "yet", "also", "just", "only", "very", "more", "most", "less", "much",
  "many", "such", "like", "off", "out", "down", "through", "across", "around", "between", "near", "next",
  "beside", "behind", "above", "below", "toward", "towards", "per", "via", "upon", "inside", "outside",
  "without", "within", "again", "here", "own", "same", "other", "another", "both", "either", "neither", "few",
  "lot", "lots", "way", "ways", "thing", "things", "something", "someone", "everyone", "says", "say", "said",
  "shot", "shots", "scene", "scenes", "frame", "frames", "camera", "video", "clip", "clips", "product",
  "products", "brand", "final", "first", "last", "beat", "beats", "moment", "moments", "second", "seconds",
  "quick", "fast", "slow", "little", "small", "big", "simple", "plain", "real", "feel", "feels", "look", "looks",
  "style", "show", "shows", "seen", "see", "label", "labels", "hand", "hands", "light", "lights", "lighting", "lit",
  "cut", "cuts", "motion", "close", "ups", "hold", "holds", "overlay", "text", "sound", "audio", "time",
]);

/** A light, deterministic stem, enough to match plurals and simple verb forms. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const STOPWORD_STEMS: ReadonlySet<string> = new Set([...STOPWORDS].map(stem));

/** The content stems of a text, by the rule above (steps 1 and 2). A word whose stem is a stopword's stem ("overlays") is dropped too. */
export function contentStems(text: string): Set<string> {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !STOPWORDS.has(word));
  return new Set(words.map(stem).filter((s) => !STOPWORD_STEMS.has(s)));
}

/** The concept's own text (step 4). */
export function conceptText(concept: Concept): string {
  return [
    concept.hook,
    concept.emotion,
    concept.surpriseBeat,
    ...concept.locations.flatMap((place) => [place.description, place.timeOfDay, place.lighting]),
    ...concept.scenes.flatMap((scene) => [
      scene.action,
      scene.framing,
      scene.motion,
      scene.lighting,
      scene.location,
      scene.overlayText ?? "",
      scene.dialogue ?? "",
      scene.sound,
      CAMERA_PRESETS[scene.camera].label,
    ]),
  ].join("\n");
}

/** Each brief slot's distinctive stems (step 3). */
export function distinctiveStems(brief: BriefSlots): Map<BriefSlot, Set<string>> {
  const cues = briefCueTexts(brief).map((cue) => ({ slot: cue.slot, stems: contentStems(cue.text) }));
  return new Map(
    cues.map(({ slot, stems }) => {
      const others = cues.filter((other) => other.slot !== slot);
      return [slot, new Set([...stems].filter((s) => !others.some((other) => other.stems.has(s))))] as const;
    }),
  );
}

export interface SlotCheck {
  slot: BriefSlot;
  verified: boolean;
  /** Distinctive stems the concept's text holds. */
  matched: string[];
  /** How many matches the slot needed: min(2, its distinctive stems). 0 means it can never be verified. */
  needed: number;
}

/** Checks each declared slot against the concept's own words (step 5). Undeclared slots are never checked. */
export function verifySlots(concept: Concept, brief: BriefSlots, uses: readonly BriefSlot[]): SlotCheck[] {
  const distinctive = distinctiveStems(brief);
  const text = contentStems(conceptText(concept));
  return uses.map((slot) => {
    const stems = distinctive.get(slot) ?? new Set<string>();
    const matched = [...stems].filter((s) => text.has(s));
    const needed = Math.min(2, stems.size);
    return { slot, verified: needed > 0 && matched.length >= needed, matched, needed };
  });
}

/** Specificity can be no higher than 1 plus the verified slots, capped at the scale's maximum. */
export function specificityCap(verifiedCount: number): number {
  return Math.min(SCORE_MAX, 1 + verifiedCount);
}

/** The rubric with specificity bounded by the verified count. Every other score stays the writer's own. */
export function boundedRubric(rubric: RubricScore, verifiedCount: number): RubricScore {
  return { ...rubric, scores: { ...rubric.scores, specificity: Math.min(rubric.scores.specificity, specificityCap(verifiedCount)) } };
}

/** The declared slots that exist in this brief, deduplicated, in the order given. */
function declaredSlots(uses: readonly string[], brief: BriefSlots): BriefSlot[] {
  const present = new Set<string>(briefCueTexts(brief).map((cue) => cue.slot));
  return [...new Set(uses)].filter((slot): slot is BriefSlot => present.has(slot));
}

interface Ranked {
  index: number;
  uses: BriefSlot[];
  verifiedUses: BriefSlot[];
  rubric: RubricScore;
  bounded: RubricScore;
}

/** Verifies every concept's declared slots and ranks by the bounded rubric (rubric.ts pickBest rules). */
export function rankConcepts(concepts: readonly ScoredConcept[], brief: BriefSlots): { ranked: Ranked[]; best: Ranked | null; discarded: Ranked[] } {
  const all: Ranked[] = concepts.map((scored, index) => {
    // A concept written before version 3 declared nothing, so nothing of it is verified.
    const uses = declaredSlots(scored.uses ?? [], brief);
    const verifiedUses = verifySlots(scored.concept, brief, uses)
      .filter((check) => check.verified)
      .map((check) => check.slot);
    return { index, uses, verifiedUses, rubric: scored.rubric, bounded: boundedRubric(scored.rubric, verifiedUses.length) };
  });
  const picked = pickBest(all.map((r) => ({ ...r, rubric: r.bounded })));
  const back = (r: { index: number }) => all[r.index];
  return { ranked: picked.ranked.map(back), best: picked.best ? back(picked.best) : null, discarded: picked.discarded.map(back) };
}

// --- The run --------------------------------------------------------------------------------------

export interface ConceptRun {
  version: 1;
  briefId: string;
  /** Hash of the product, brief, direction and instructions these concepts were written from. */
  inputHash: string;
  modelId: string;
  effort: typeof STOOP_EFFORT;
  generatedAt: string;
  instructionsHash: string;
  attempts: number;
  /** What the first answer got wrong when a repair was needed. */
  repairedFor?: string[];
  usage: { inputTokens: number | null; outputTokens: number | null };
  concepts: ScoredConcept[];
  /** Index into `concepts` of the kept concept (from the bounded rubric since version 3). */
  bestIndex: number;
  /** Indexes of concepts that failed a hard gate. */
  discarded: number[];
}

export const conceptRunSchema = z.strictObject({
  version: z.literal(1),
  briefId: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  modelId: z.string().min(1),
  effort: z.literal(STOOP_EFFORT),
  generatedAt: z.iso.datetime(),
  instructionsHash: z.string().regex(/^[0-9a-f]{64}$/),
  attempts: z.number().int().min(1).max(2),
  repairedFor: z.array(z.string()).optional(),
  usage: z.strictObject({ inputTokens: z.number().nullable(), outputTokens: z.number().nullable() }),
  concepts: z.array(scoredConceptSchema).length(CONCEPT_COUNT),
  bestIndex: z.number().int().min(0).max(CONCEPT_COUNT - 1),
  discarded: z.array(z.number().int().min(0).max(CONCEPT_COUNT - 1)),
});

export interface ConceptOptions {
  model: LanguageModel;
  modelId: string;
  /** Real names (references, seeds) that must never appear in a concept. */
  names: readonly string[];
  direction: CreativeDirection;
  /** Cancels the call (the run's deadline, or the founder leaving). A cancelled call rejects. */
  abortSignal?: AbortSignal;
  /** Per call; defaults to CONCEPTS_TIMEOUT_MS. */
  timeoutMs?: number;
  now?: () => Date;
}

/** Validates one model output. Returns the concepts, or the problems to send back for one repair. */
export function validateConcepts(
  raw: unknown,
  brief: BriefSlots,
  options: Pick<ConceptOptions, "names" | "direction">,
): { ok: true; concepts: ScoredConcept[] } | { ok: false; problems: string } {
  const cleaned = stripEmDashes(raw);
  const parsed = z.strictObject({ concepts: z.array(freshConceptSchema).length(CONCEPT_COUNT) }).safeParse(cleaned);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n") };
  }
  const missing = parsed.data.concepts.flatMap((c, i) => (c.concept.testHypothesis ? [] : [`- concepts.${i}.concept.testHypothesis: write what running this concept tests`]));
  if (missing.length > 0) return { ok: false, problems: missing.join("\n") };
  const concepts: ScoredConcept[] = parsed.data.concepts.map((c) => ({ ...c, uses: declaredSlots(c.uses, brief) }));
  const issues: GuardIssue[] = checkValue(
    concepts.map((c) => c.concept),
    { names: [...options.names, ...FAMOUS_PLACES], allowedNames: brief.allowedPlaces },
    "concepts",
  );
  // Cast (product only, pet) is enforced by the pack builder, which renders no talent sheet or character.
  if (issues.length > 0) return { ok: false, problems: formatGuardIssues(issues) };
  if (rankConcepts(concepts, brief).best === null) {
    return { ok: false, problems: "- Every concept failed a hard gate (stereotype or missing surprise beat). Write new ones." };
  }
  return { ok: true, concepts };
}

/**
 * What a concept set was written from. Scripts compare it to spot concepts that no longer match their
 * brief. Pass a stored run's own instructionsHash to ask only whether the product, brief and direction
 * still match (see conceptsStatus).
 */
export function conceptInputHash(product: ProductSpec, brief: BriefSlots, direction: CreativeDirection, instructionsHash: string = conceptsInstructionsHash()): string {
  return hashOf({ product, brief, direction, instructions: instructionsHash });
}

/**
 * Whether a stored run still fits: "current", "stale-instructions" (same inputs, written with older
 * instructions, so it may lack declared slots or a test hypothesis) or "other-input" (written from a
 * different product, brief or direction).
 */
export function conceptsStatus(run: ConceptRun, product: ProductSpec, brief: BriefSlots, direction: CreativeDirection): "current" | "stale-instructions" | "other-input" {
  if (run.inputHash === conceptInputHash(product, brief, direction)) return "current";
  if (run.inputHash === conceptInputHash(product, brief, direction, run.instructionsHash)) return "stale-instructions";
  return "other-input";
}

/** Writes 3 concepts for one brief and keeps the best. One repair retry on invalid output; none on a timeout. */
export async function writeConcepts(product: ProductSpec, brief: BriefSlots, options: ConceptOptions): Promise<ConceptRun> {
  // User notes pass the same guardrails as generated text before they reach the model.
  const noteIssues = options.direction.notes
    ? checkText(options.direction.notes, { names: [...options.names, ...FAMOUS_PLACES], allowedNames: brief.allowedPlaces })
    : [];
  if (noteIssues.length > 0) throw new Error(`The creative direction notes break the guardrails:\n${formatGuardIssues(noteIssues)}`);
  // Marked for Anthropic's prompt cache: every world, the Control and a repair share these instructions.
  const instructions = cachedInstructions(conceptsInstructions());
  const prompt = conceptsPrompt(product, brief, options.direction);
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  let lastProblems = "";
  let previous: unknown = undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const repair =
      attempt === 1
        ? prompt
        : [
            prompt,
            `Your previous answer broke these rules. Fix every one and answer again in full:\n${lastProblems}`,
            ...(previous !== undefined ? [quoted("previous answer", JSON.stringify(previous))] : []),
          ].join("\n\n");
    const reply = await askOnce(options.model, {
      instructions,
      prompt: repair,
      schema: llmOutput,
      name: "concepts",
      timeoutMs: options.timeoutMs ?? CONCEPTS_TIMEOUT_MS,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    if (reply.usage.inputTokens !== null || reply.usage.outputTokens !== null) sawUsage = true;
    inputTokens += reply.usage.inputTokens ?? 0;
    outputTokens += reply.usage.outputTokens ?? 0;
    // A repair would wait just as long, so a timeout ends the writer.
    if (reply.failure && /did not answer within/.test(reply.failure)) throw new Error(`Concepts for "${brief.segment.id}": ${reply.failure}.`);
    previous = reply.output;

    const checked = reply.failure ? { ok: false as const, problems: `- ${reply.failure}` } : validateConcepts(reply.output, brief, options);
    if (checked.ok) {
      const { best, discarded } = rankConcepts(checked.concepts, brief);
      return {
        version: 1,
        briefId: brief.segment.id,
        inputHash: conceptInputHash(product, brief, options.direction),
        modelId: options.modelId,
        effort: STOOP_EFFORT,
        generatedAt: (options.now?.() ?? new Date()).toISOString(),
        instructionsHash: conceptsInstructionsHash(),
        attempts: attempt,
        ...(attempt > 1 ? { repairedFor: lastProblems.split("\n").filter(Boolean) } : {}),
        usage: sawUsage ? { inputTokens, outputTokens } : { inputTokens: null, outputTokens: null },
        concepts: checked.concepts,
        bestIndex: (best as Ranked).index,
        discarded: discarded.map((r) => r.index),
      };
    }
    lastProblems = checked.problems;
  }
  throw new Error(`Concepts for "${brief.segment.id}" failed validation twice:\n${lastProblems}`);
}

/** The kept concept of a run. */
export function bestConcept(run: ConceptRun): Concept {
  return run.concepts[run.bestIndex].concept;
}

/**
 * The run as the Report's ConceptSet: the kept concept, then the others (ranked by the bounded rubric,
 * then the discarded ones), each with its declared and verified slots and its bounded total. The run's
 * own bestIndex and discarded list decide the statuses, so the set always names the concept the pack
 * was built from. For runs written since version 3 that is also the top of the bounded ranking; a run
 * written before declared no slots, so its totals carry specificity 1 and its kept concept may rank
 * below another.
 */
export function conceptSet(run: ConceptRun, brief: BriefSlots): ConceptSet {
  if (run.briefId !== brief.segment.id) throw new Error(`These concepts were written for "${run.briefId}", not "${brief.segment.id}".`);
  const { ranked, discarded: failed } = rankConcepts(run.concepts, brief);
  const discarded = new Set(run.discarded);
  const entry = (r: Ranked): RankedConcept => ({
    concept: run.concepts[r.index].concept,
    rubric: r.rubric,
    uses: r.uses,
    verifiedUses: r.verifiedUses,
    total: totalScore(r.bounded),
    status: r.index === run.bestIndex ? "kept" : discarded.has(r.index) ? "discarded" : "ranked",
  });
  // Ranked ones in bounded order, then the discarded ones in their original order.
  const order = [...ranked, ...failed].map(entry);
  const others = [...order.filter((c) => c.status === "ranked"), ...order.filter((c) => c.status === "discarded")];
  const best = order.find((c) => c.status === "kept") as RankedConcept;
  return conceptSetSchema.parse({ best, others, modelId: run.modelId, usage: run.usage });
}

export type { RubricScore };
