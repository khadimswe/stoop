// Intake's guard on untrusted page text. Every intake answer comes through askOnce
// (lib/agent/ask.ts), and looksLikeInstructions() backs up Claude's own flag, so instruction-like page
// text is noted in the trace even when the model misses it.

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
