// The frame critique loop's review (zero Qloo calls): after a world's storyboard frames render,
// Claude looks at each one with vision (AI SDK file parts) against the frame checklist
// (lib/prompts/critique-checklist.ts), the kept concept and the brief, and lists concrete issues. For a
// frame with issues it writes one new frame description; code adds back the closing rules (the
// reference, who may be on screen, the exclusions), so a rewrite can never drop them. Every rewrite
// passes the same guardrails as generated text before anything re-renders: no real names, no
// likenesses, no third-party logos, no children or school settings, no product facts the seller never
// gave. Lib/media/frames.ts re-renders each kept rewrite once, at most MAX_REWRITES per world.
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel } from "ai";
import { z } from "zod";
import { cachedInstructions } from "../agent/ask";
import { GUARDRAIL_INSTRUCTIONS, quoted } from "../agent/instructions";
import { STOOP_PROVIDER_OPTIONS } from "../agent/model";
import { checkText, childSetting, FAMOUS_PLACES, stripEmDashes, unsupportedClaims } from "../guardrails";
import { sellerText, type BriefSlots, type Concept, type ProductSpec } from "../prompts/brief";
import { checklistFor, type ChecklistItem } from "../prompts/critique-checklist";
import type { ProductionPack } from "../prompts/pack";
import type { FrameCritique } from "../report/world";

export const CRITIQUE_VERSION = 1;
/** Issues kept per frame (the report's limit). */
export const MAX_ISSUES = 6;
/** Re-renders per world at most: one per flagged frame. */
export const MAX_REWRITES = 4;
export const ISSUE_MAX_CHARS = 160;
export const REWRITE_MAX_CHARS = 900;
export const CRITIQUE_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 10_000;

/** The checklist items a still can be judged on, for this pack's cast and product. */
export function frameChecklist(pack: Pick<ProductionPack, "cast">, product: ProductSpec): ChecklistItem[] {
  return checklistFor({ hasTalent: pack.cast === "adult_talent", hasSourceImages: product.source.kind === "images", cast: pack.cast }).filter((item) => item.appliesTo.includes("frame"));
}

export function critiqueInstructions(): string {
  return [
    "You are the director of a 15 second vertical product ad for Meta Reels and TikTok, reviewing storyboard frames before any video is rendered.",
    "",
    "How to review:",
    "- Look at each frame against the checklist, the concept and the brief you are given.",
    "- List only concrete issues you can see in the image, each in a few words: \"product hidden behind the hand\", \"setting reads generic, not a coffee counter\", \"readable text on the sign\", \"a second logo on the mug\". Never guess at what you cannot see.",
    "- A frame that passes gets an empty issues list and a null rewrite.",
    "- For a frame with issues, write one rewritten frame description that fixes them: what the frame shows (subject and action, location, composition, light, style) in plain words, under 700 characters. Keep the brief's setting, styling, visual language and mood.",
    "- Do not restate the rules about reference photos, people and exclusions: they are added to every prompt by code.",
    "- Your wording never contains a real name: no person, artist, film, show, brand, business or podcast. The setting city in the brief is the one place you may name.",
    "",
    GUARDRAIL_INSTRUCTIONS,
  ].join("\n");
}

const outputSchema = z.object({
  frames: z.array(
    z.object({
      shot: z.number().int().describe("The shot number of the frame, as labeled"),
      issues: z.array(z.string()).describe("Concrete issues you can see, a few words each; empty when the frame passes"),
      rewrite: z.string().nullable().describe("One rewritten frame description that fixes the issues, or null when it passes"),
    }),
  ),
});

export interface FrameToReview {
  /** Index into the kept concept's scenes. */
  scene: number;
  /** The stored frame's public https URL. */
  url: string;
  /** The body of the prompt it was rendered from (what a rewrite replaces). */
  body: string;
}

export interface CritiqueInput {
  frames: readonly FrameToReview[];
  concept: Concept;
  brief: BriefSlots;
  product: ProductSpec;
  checklist: readonly ChecklistItem[];
  /** Every real name the run knows, kept out of rewrites. */
  names: readonly string[];
}

export interface CritiqueResult {
  /** One per frame Claude reviewed, in scene order. A rewrite is set only when it passed the guardrails. */
  critiques: FrameCritique[];
  /** Rewrites the guardrails refused, with why (for the trace). */
  refused: { scene: number; reason: string }[];
  /** Why there is no review at all (a timeout, a malformed answer); null when it came back. */
  failure: string | null;
}

function briefLines(brief: BriefSlots): string {
  return [
    `Setting: ${brief.setting.map((c) => c.text).join("; ")}`,
    brief.wardrobe ? `Wardrobe: ${brief.wardrobe.text}` : null,
    brief.talent ? `Talent: ${brief.talent.text}` : null,
    `Visual language: ${brief.visual.text}`,
    `Mood: ${brief.mood.text}`,
    `Product's role: ${brief.productRole.text}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The user message: the checklist, concept, brief and product as data, then each frame's prompt and image. */
export function critiqueMessage(input: CritiqueInput) {
  const { concept } = input;
  const checklist = input.checklist.map((item) => `- ${item.blocking ? "[blocking] " : ""}${item.text}`).join("\n");
  const intro = [
    "Review these storyboard frames.",
    "",
    "Checklist (blocking items fail a frame outright):",
    checklist,
    "",
    quoted("concept", [`Title: ${concept.title}`, `Hook: ${concept.hook}`, `Feeling: ${concept.emotion}`, `Surprise beat: ${concept.surpriseBeat}`].join("\n")),
    quoted("brief", briefLines(input.brief)),
    quoted("product", `${input.product.name}: ${input.product.oneLine}`),
    "",
    `There are ${input.frames.length} frames. Answer once per frame, by its shot number.`,
  ].join("\n");
  const content = [
    { type: "text" as const, text: intro },
    ...input.frames.flatMap((frame) => {
      const scene = concept.scenes[frame.scene];
      return [
        { type: "text" as const, text: `Shot ${frame.scene + 1} (${scene?.beat ?? "scene"}). It was rendered from this description:\n${quoted("frame description", frame.body)}` },
        { type: "file" as const, mediaType: "image", data: new URL(frame.url) },
      ];
    }),
  ];
  return [{ role: "user" as const, content }];
}

/** Clauses that forbid something ("no logos", "without text") name it on purpose; they are not mentions. */
const NEGATED = /\b(?:no|never|without|free of|not)\b[^.,;:!?\n]*/gi;

/** A logo or brand mark other than the product's own label, outside a negated clause. */
export function mentionsLogo(text: string): string | null {
  return text.replace(NEGATED, " ").match(/\b(?:logos?|monograms?|brand marks?|branded)\b/i)?.[0] ?? null;
}

/** A rewrite that passes the guardrails (whitespace tidied, em dashes replaced), or why it was refused. */
export function guardRewrite(text: string, ctx: { names: readonly string[]; brief: BriefSlots; product: ProductSpec }): { ok: true; text: string } | { ok: false; reason: string } {
  const clean = stripEmDashes(text).replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, reason: "the rewrite was empty" };
  if (clean.length > REWRITE_MAX_CHARS) return { ok: false, reason: `the rewrite ran past ${REWRITE_MAX_CHARS} characters` };
  const allowedNames = [...ctx.brief.allowedPlaces, ...(ctx.product.brandName ? [ctx.product.brandName] : [])];
  // Long lists of Qloo names match as written, so a title like "Every Day" never flags "every day".
  const issues = checkText(clean, { names: [...ctx.names, ...FAMOUS_PLACES], allowedNames, exactCaseNames: true });
  if (issues.length > 0) return { ok: false, reason: issues[0].message };
  const kids = childSetting(clean);
  if (kids) return { ok: false, reason: `"${kids}" invites children into frame; every person on screen is an adult` };
  const logo = mentionsLogo(clean);
  if (logo) return { ok: false, reason: `"${logo}": the product's own label is the only branding allowed` };
  const claims = unsupportedClaims(clean, sellerText(ctx.product), { phrases: false });
  if (claims.length > 0) return { ok: false, reason: `"${claims[0]}" is a product fact the seller never gave` };
  return { ok: true, text: clean };
}

const tidyIssue = (issue: string) => {
  const text = stripEmDashes(issue).replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  return text.length > ISSUE_MAX_CHARS ? `${text.slice(0, ISSUE_MAX_CHARS - 3).trimEnd()}...` : text;
};

/** Turns Claude's answer into critiques: known shots only, issues capped and guardrailed, at most MAX_REWRITES rewrites. */
export function readCritique(raw: unknown, input: CritiqueInput): Omit<CritiqueResult, "failure"> {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) return { critiques: [], refused: [] };
  const reviewed = new Set(input.frames.map((f) => f.scene));
  const byScene = new Map<number, (typeof parsed.data.frames)[number]>();
  for (const entry of parsed.data.frames) {
    const scene = entry.shot - 1;
    if (reviewed.has(scene) && !byScene.has(scene)) byScene.set(scene, entry);
  }
  const critiques: FrameCritique[] = [];
  const refused: CritiqueResult["refused"] = [];
  let rewrites = 0;
  for (const scene of [...byScene.keys()].sort((a, b) => a - b)) {
    const entry = byScene.get(scene)!;
    // Issue wording is shown in the report: one that names a real person or describes someone by
    // ethnicity is dropped. An issue may still flag that someone looks under 18; that is the point of it.
    const issues = [...new Set(entry.issues.map(tidyIssue).filter(Boolean))]
      .filter((issue) => checkText(issue, { names: input.names, exactCaseNames: true }).every((i) => i.rule !== "named-reference" && i.rule !== "ethnicity" && i.rule !== "em-dash"))
      .slice(0, MAX_ISSUES);
    let rewrite: string | null = null;
    if (issues.length > 0 && entry.rewrite?.trim()) {
      if (rewrites >= MAX_REWRITES) {
        refused.push({ scene, reason: `only ${MAX_REWRITES} frames re-render per world` });
      } else {
        const guarded = guardRewrite(entry.rewrite, input);
        if (guarded.ok) {
          rewrite = guarded.text;
          rewrites++;
        } else refused.push({ scene, reason: guarded.reason });
      }
    }
    critiques.push({ scene, issues, rewrite });
  }
  return { critiques, refused };
}

/** Claude's review of a world's frames. A timeout or a malformed answer is a failure line, never an error; a cancelled call rejects. */
export async function critiqueFrames(model: LanguageModel, input: CritiqueInput, options: { abortSignal?: AbortSignal; timeoutMs?: number } = {}): Promise<CritiqueResult> {
  if (input.frames.length === 0) return { critiques: [], refused: [], failure: null };
  const timeoutMs = options.timeoutMs ?? CRITIQUE_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const abortSignal = options.abortSignal ? AbortSignal.any([timeout, options.abortSignal]) : timeout;
  try {
    const result = await generateText({
      model,
      instructions: cachedInstructions(critiqueInstructions()),
      messages: critiqueMessage(input),
      output: Output.object({ schema: outputSchema, name: "frame_critique" }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      abortSignal,
      providerOptions: STOOP_PROVIDER_OPTIONS,
    });
    let output: unknown;
    try {
      output = result.output;
    } catch (error) {
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      return { critiques: [], refused: [], failure: "the review ended before it was complete" };
    }
    return { ...readCritique(output, input), failure: null };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) return { critiques: [], refused: [], failure: "the review was not valid JSON for the schema" };
    if (timeout.aborted && !options.abortSignal?.aborted) return { critiques: [], refused: [], failure: `Claude did not answer within ${timeoutMs / 1000} s` };
    throw error;
  }
}
