import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askOnce, cachedInstructions, CLAUDE_TIMEOUT_MS } from "./ask";

// Claude is the AI SDK mock. A stalled call waits for its abort signal, like a real request.
const schema = z.object({ ok: z.boolean() });
const ask = { instructions: "Answer.", prompt: "Answer.", schema, name: "answer" };

const reply = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  },
  warnings: [],
});

const stalled = () =>
  new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
      }),
  });

describe("askOnce", () => {
  it("returns the answer with usage, and gives the model an abort signal", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply({ ok: true }) });
    expect(await askOnce(model, ask)).toEqual({ output: { ok: true }, usage: { inputTokens: 10, outputTokens: 5 } });
    expect(model.doGenerateCalls[0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(CLAUDE_TIMEOUT_MS).toBe(45_000);
  });

  it("turns a timed-out call into a failure line", async () => {
    const result = await askOnce(stalled(), { ...ask, timeoutMs: 50 });
    expect(result).toEqual({ output: undefined, usage: { inputTokens: null, outputTokens: null }, failure: "Claude did not answer within 0.05 s" });
  });

  it("rejects when the caller cancels", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("left the page")), 20);
    await expect(askOnce(stalled(), { ...ask, abortSignal: controller.signal })).rejects.toThrow();
  });

  it("passes cached instructions as a system message with a cache breakpoint", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply({ ok: true }) });
    await askOnce(model, { ...ask, instructions: cachedInstructions("Answer.") });
    expect(model.doGenerateCalls[0].prompt[0]).toMatchObject({
      role: "system",
      content: "Answer.",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    });
  });

  it("turns a malformed answer into a failure line", async () => {
    const model = new MockLanguageModelV4({ doGenerate: reply("not the schema") });
    expect((await askOnce(model, ask)).failure).toBe("the answer was not valid JSON for the schema");
  });
});
