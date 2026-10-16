// The one structured Claude call each intake step makes (the site reading and the seed
// suggestions), with the provider options every Stoop call shares. The model is a parameter, so
// tests pass the AI SDK mock. A malformed answer never fails the intake: the caller gets a failure
// line for the trace and carries on without it. Untrusted text only ever reaches the prompt through
// quoted() (lib/agent/instructions.ts), and looksLikeInstructions() backs up Claude's own flag, so
// instruction-like page text is noted in the trace even when the model misses it.
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from "ai";
import { z } from "zod";
import { STOOP_PROVIDER_OPTIONS } from "../agent/model";

// Thinking always runs on this model and counts toward the limit, so leave room beyond the JSON.
const MAX_OUTPUT_TOKENS = 16_000;

export const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});
export type IntakeUsage = z.infer<typeof usageSchema>;

const usageOf = (usage: LanguageModelUsage | undefined): IntakeUsage => ({
  inputTokens: usage?.inputTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
});

export interface Asked {
  /** The answer, still to be validated by the caller. Undefined on failure. */
  output: unknown;
  usage: IntakeUsage;
  /** Set when the answer could not be read at all. */
  failure?: string;
}

export interface AskOptions {
  instructions: string;
  prompt: string;
  schema: z.ZodType;
  name: string;
  description?: string;
}

/** One call with structured output. Rethrows anything but a malformed or cut-off answer (auth, network). */
export async function askOnce(model: LanguageModel, options: AskOptions): Promise<Asked> {
  try {
    const result = await generateText({
      model,
      instructions: options.instructions,
      prompt: options.prompt,
      output: Output.object({ schema: options.schema, name: options.name, ...(options.description ? { description: options.description } : {}) }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: STOOP_PROVIDER_OPTIONS,
    });
    try {
      return { output: result.output, usage: usageOf(result.usage) };
    } catch (error) {
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      return { output: undefined, usage: usageOf(result.usage), failure: "the answer ended before it was complete" };
    }
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return { output: undefined, usage: usageOf(error.usage), failure: "the answer was not valid JSON for the schema" };
  }
}

// Phrases that address an AI rather than a shopper. Kept narrow so marketing copy ("forget the
// rules", "acts as a barrier") does not trip it; Claude's own flag covers the rest.
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|of\s+)*(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|rules|directions|messages?)\b/i,
  /\b(?:ignore|disregard)\s+(?:all|any|your)\s+(?:instructions?|rules|guidelines|guardrails)\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\byou are now (?:a|an|the|in)\b/i,
  /\bnew instructions?\s*:/i,
  /\b(?:reveal|print|repeat|output)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b/i,
  /<\/?\s*(?:system|instructions?|prompt|data)\b[^>]*>/i,
  /(?:^|\n)\s*(?:system|assistant)\s*:/i,
];

/** True when untrusted text contains a line aimed at an AI model. */
export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}
