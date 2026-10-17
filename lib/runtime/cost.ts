// The estimate in the trace footer ("$0.38"): Claude at list prices per million tokens, plus each
// job's own vendor prices (frames). An estimate, labeled as one; Qloo calls are free in the hackathon.

/** Claude list prices per million tokens; cached input is billed at a tenth. */
export const PRICES = { input: 3, cachedInput: 0.3, output: 15 } as const;

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** Dollars for these tokens, unrounded (sums stay exact until shown). */
export function claudeUsd(claude: ClaudeUsage): number {
  const fresh = Math.max(0, claude.inputTokens - claude.cachedInputTokens);
  return (fresh * PRICES.input + claude.cachedInputTokens * PRICES.cachedInput + claude.outputTokens * PRICES.output) / 1_000_000;
}

/** The same, rounded to the cent for the footer. */
export const estimateUsd = (claude: ClaudeUsage): number => Math.round(claudeUsd(claude) * 100) / 100;
