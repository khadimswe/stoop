// The one Claude model behind every Stoop LLM call. The LLM-only Control brief and the Qloo path
// share this model id and this effort, so the with vs. without comparison differs only in the brief.
// claude-sonnet-5-5 rejects temperature, topP, topK and seed, and its thinking cannot be turned off,
// so effort is the one dial and callers never pass sampling settings.
// Server and scripts only. The Anthropic provider reads ANTHROPIC_API_KEY itself, at request time;
// this module never reads or logs it. There is no "server-only" import because tsx scripts use it too.
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { DEFAULT_LLM_MODEL_ID } from "../prompts/models.config";

if (typeof window !== "undefined") {
  throw new Error("lib/agent/model runs on the server and in scripts only.");
}

/** Model names live in models.config.ts; this module only reads them. */
export const DEFAULT_MODEL_ID = DEFAULT_LLM_MODEL_ID;

/** Shared by the Control and the Qloo path. Changing it changes both. */
export const STOOP_EFFORT = "medium" as const;

export const STOOP_PROVIDER_OPTIONS = {
  anthropic: { effort: STOOP_EFFORT },
} satisfies { anthropic: AnthropicLanguageModelOptions };

/** STOOP_MODEL when set (trimmed), else the default. */
export function stoopModelId(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.STOOP_MODEL?.trim() || DEFAULT_MODEL_ID;
}

export function stoopModel(modelId: string = stoopModelId()): LanguageModel {
  return createAnthropic()(modelId);
}
