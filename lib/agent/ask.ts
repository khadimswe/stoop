// The one structured Claude call a single-answer step makes (the site reading, the seed suggestions,
// the concept writer), with the provider options every Stoop call shares, a timeout and one retry.
// The model is a parameter, so tests pass the AI SDK mock. A malformed, cut-off or timed-out answer
// never fails the caller: it gets a failure line for the trace and carries on without it. Untrusted
// text only ever reaches a prompt through quoted() (lib/agent/instructions.ts).
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, type Instructions, type LanguageModel, type LanguageModelUsage, type SystemModelMessage } from "ai";
import { z } from "zod";
import { STOOP_PROVIDER_OPTIONS } from "./model";

// Thinking always runs on this model and counts toward the limit, so leave room beyond the JSON.
const MAX_OUTPUT_TOKENS = 16_000;
/**
 * Longest wait for one answer, retries included. The /start screen waits on intake answers, and the
 * seed-suggestion call thinks at medium effort, so this leaves room for one retry. Longer answers
 * (the concept writer) pass their own timeoutMs.
 */
export const CLAUDE_TIMEOUT_MS = 45_000;
/** One retry on a retryable provider error (overloaded, rate limited), inside the same timeout. */
export const CLAUDE_MAX_RETRIES = 1;

export const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});
export type AskUsage = z.infer<typeof usageSchema>;

const usageOf = (usage: LanguageModelUsage | undefined): AskUsage => ({
  inputTokens: usage?.inputTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
});

export interface Asked {
  /** The answer, still to be validated by the caller. Undefined on failure. */
  output: unknown;
  usage: AskUsage;
  /** Set when the answer could not be read at all. */
  failure?: string;
}

export interface AskOptions {
  /** A plain string, or cachedInstructions(text) to mark it for Anthropic's prompt cache. */
  instructions: Instructions;
  prompt: string;
  schema: z.ZodType;
  name: string;
  description?: string;
  /** Cancels the call, e.g. when the founder leaves the page. A cancelled call rejects. */
  abortSignal?: AbortSignal;
  /** Defaults to CLAUDE_TIMEOUT_MS. A timed-out call is a failure line, not an error. */
  timeoutMs?: number;
}

/**
 * Instructions marked as a prompt-cache breakpoint, so repeated calls with the same instructions (every
 * world, the Control, retries) read them from Anthropic's cache. Prompts shorter than the model's
 * minimum are simply not cached.
 */
export function cachedInstructions(text: string): SystemModelMessage {
  return { role: "system", content: text, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } };
}

/**
 * One call with structured output, a timeout and one retry. A malformed, cut-off or timed-out
 * answer comes back as a failure line; anything else (auth, a cancelled call) is rethrown.
 */
export async function askOnce(model: LanguageModel, options: AskOptions): Promise<Asked> {
  const timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const abortSignal = options.abortSignal ? AbortSignal.any([timeout, options.abortSignal]) : timeout;
  try {
    const result = await generateText({
      model,
      instructions: options.instructions,
      prompt: options.prompt,
      output: Output.object({ schema: options.schema, name: options.name, ...(options.description ? { description: options.description } : {}) }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: CLAUDE_MAX_RETRIES,
      abortSignal,
      providerOptions: STOOP_PROVIDER_OPTIONS,
    });
    try {
      return { output: result.output, usage: usageOf(result.usage) };
    } catch (error) {
      if (!NoOutputGeneratedError.isInstance(error)) throw error;
      return { output: undefined, usage: usageOf(result.usage), failure: "the answer ended before it was complete" };
    }
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return { output: undefined, usage: usageOf(error.usage), failure: "the answer was not valid JSON for the schema" };
    }
    if (timeout.aborted && !options.abortSignal?.aborted) {
      return { output: undefined, usage: usageOf(undefined), failure: `Claude did not answer within ${timeoutMs / 1000} s` };
    }
    throw error;
  }
}

