// The Creative Director step, shared by the LLM-only Control and the Qloo path. One call writes 3
// concepts from a brief and scores each with the written rubric; the best one that passes the hard
// gates is kept. Both paths call this same function with the same instructions, so only the brief
// differs. It makes zero Qloo calls.
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from "ai";
import { z } from "zod";
import { CREATIVE_STRATEGIST_ROLE, GUARDRAIL_INSTRUCTIONS, quoted } from "../agent/instructions";
import { STOOP_EFFORT, STOOP_PROVIDER_OPTIONS } from "../agent/model";
import { checkText, checkValue, FAMOUS_PLACES, formatGuardIssues, stripEmDashes, type GuardIssue } from "../guardrails";
import { hashOf } from "../hash";
import { CAMERA_PRESETS, CAMERA_PRESET_IDS, ENERGY_PRESETS, LOOK_PRESETS } from "../prompts/models.config";
import { AD_SECONDS, conceptSchema, SCENE_BEATS, type BriefSlots, type Concept, type ProductSpec } from "../prompts/brief";
import { pickBest, RUBRIC_TEXT, rubricScoreSchema, type RubricScore } from "../prompts/rubric";
import type { CreativeDirection } from "../types";

export const CONCEPTS_INSTRUCTIONS_VERSION = 2;
export const CONCEPT_COUNT = 3;
/** Thinking counts toward the output limit; real answers run about 4k tokens. */
const MAX_OUTPUT_TOKENS = 16_000;

const scoredConceptSchema = z.strictObject({ concept: conceptSchema, rubric: rubricScoreSchema });
export type ScoredConcept = z.infer<typeof scoredConceptSchema>;

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
  locations: z.array(z.object({ slug: z.string(), description: z.string(), timeOfDay: z.string(), lighting: z.string() })),
  scenes: z.array(llmScene),
});
const llmOutput = z.object({
  concepts: z.array(
    z.object({
      concept: llmConcept,
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
    `Camera presets (use these ids only):\n${cameraMenu()}`,
    `Rubric:\n${RUBRIC_TEXT}`,
  ].join("\n\n");
}

function briefBlock(brief: BriefSlots): string {
  const cue = (label: string, text: string | undefined) => (text ? `${label}: ${text}` : `${label}: (none)`);
  return [
    `Audience: ${brief.segment.label}`,
    cue("Product role", brief.productRole.text),
    cue("Mood", brief.mood.text),
    cue("Music", brief.music.text),
    cue("Visual language", brief.visual.text),
    cue("Wardrobe", brief.wardrobe?.text),
    `Setting: ${brief.setting.map((s) => s.text).join("; ")}`,
    cue("Voice", brief.voice.tone.text),
    `Words to use: ${brief.voice.use.join(", ") || "(none)"}`,
    `Words to avoid: ${brief.voice.avoid.join(", ") || "(none)"}`,
    cue("Talent", brief.talent?.text ?? "none (no people on screen)"),
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

export interface ConceptRun {
  version: 1;
  briefId: string;
  /** Hash of the product, brief and direction these concepts were written from. A changed brief means stale concepts. */
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
  /** Index into `concepts` of the kept concept. */
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
  now?: () => Date;
}

/** Validates one model output. Returns the concepts, or the problems to send back for one repair. */
export function validateConcepts(
  raw: unknown,
  brief: BriefSlots,
  options: Pick<ConceptOptions, "names" | "direction">,
): { ok: true; concepts: ScoredConcept[] } | { ok: false; problems: string } {
  const cleaned = stripEmDashes(raw);
  const parsed = z.strictObject({ concepts: z.array(scoredConceptSchema).length(CONCEPT_COUNT) }).safeParse(cleaned);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n") };
  }
  const issues: GuardIssue[] = checkValue(
    parsed.data.concepts.map((c) => c.concept),
    { names: [...options.names, ...FAMOUS_PLACES], allowedNames: brief.allowedPlaces },
    "concepts",
  );
  // Cast (product only, pet) is enforced by the pack builder, which renders no talent sheet or character.
  if (issues.length > 0) return { ok: false, problems: formatGuardIssues(issues) };
  if (pickBest(parsed.data.concepts).best === null) {
    return { ok: false, problems: "- Every concept failed a hard gate (stereotype or missing surprise beat). Write new ones." };
  }
  return { ok: true, concepts: parsed.data.concepts };
}

/** What a concept set was written from. Scripts compare it to spot concepts that no longer match their brief. */
export function conceptInputHash(product: ProductSpec, brief: BriefSlots, direction: CreativeDirection): string {
  return hashOf({ product, brief, direction, instructions: conceptsInstructionsHash() });
}

interface Reply {
  output: unknown;
  usage: LanguageModelUsage | undefined;
  /** Set when the answer could not be read as concepts at all. */
  failure?: string;
}

async function askForConcepts(model: LanguageModel, instructions: string, prompt: string): Promise<Reply> {
  try {
    const result = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: llmOutput, name: "concepts" }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: STOOP_PROVIDER_OPTIONS,
    });
    try {
      return { output: result.output, usage: result.usage };
    } catch (error) {
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      return { output: undefined, usage: result.usage, failure: "- The answer ended before the concepts were complete." };
    }
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return { output: error.text ?? null, usage: error.usage, failure: "- The answer was not a complete JSON object matching the concepts schema." };
  }
}

/** Writes 3 concepts for one brief and keeps the best. One repair retry on invalid output. */
export async function writeConcepts(product: ProductSpec, brief: BriefSlots, options: ConceptOptions): Promise<ConceptRun> {
  // User notes pass the same guardrails as generated text before they reach the model.
  const noteIssues = options.direction.notes
    ? checkText(options.direction.notes, { names: [...options.names, ...FAMOUS_PLACES], allowedNames: brief.allowedPlaces })
    : [];
  if (noteIssues.length > 0) throw new Error(`The creative direction notes break the guardrails:\n${formatGuardIssues(noteIssues)}`);
  const instructions = conceptsInstructions();
  const prompt = conceptsPrompt(product, brief, options.direction);
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  let lastProblems = "";
  let previous: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const repair =
      attempt === 1
        ? prompt
        : `${prompt}\n\nYour previous answer broke these rules. Fix every one and answer again in full:\n${lastProblems}\n\n${quoted("previous answer", JSON.stringify(previous))}`;
    const reply = await askForConcepts(options.model, instructions, repair);
    if (reply.usage && (reply.usage.inputTokens !== undefined || reply.usage.outputTokens !== undefined)) sawUsage = true;
    inputTokens += reply.usage?.inputTokens ?? 0;
    outputTokens += reply.usage?.outputTokens ?? 0;
    previous = reply.output;

    const checked = reply.failure ? { ok: false as const, problems: reply.failure } : validateConcepts(reply.output, brief, options);
    if (checked.ok) {
      const { best, discarded } = pickBest(checked.concepts);
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
        bestIndex: checked.concepts.indexOf(best as ScoredConcept),
        discarded: discarded.map((c) => checked.concepts.indexOf(c)),
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

export type { RubricScore };
