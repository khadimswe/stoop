import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { LlmFixtureMissError, LlmStore, recordingModel, replayModel } from "./llm-replay";

// Claude is the AI SDK mock. Its answers are what the store records and replays.
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
const answer = (words: string) => ({
  content: [{ type: "text" as const, text: words }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
  response: { id: "msg_1", modelId: "mock-model", timestamp: new Date("2026-10-16T20:00:00.000Z") },
});
const mock = (words: string) => Object.assign(new MockLanguageModelV4({ doGenerate: answer(words) }), { modelId: "mock-model" });
const store = () => new LlmStore(path.join(mkdtempSync(path.join(tmpdir(), "stoop-llm-")), "example.json"), "example", () => new Date("2026-10-16T21:00:00.000Z"));

describe("recorded Claude answers", () => {
  it("records an answer once, then replays it without asking the model", async () => {
    const answers = store();
    const live = mock("Warm americana.");
    const first = await generateText({ model: recordingModel(live, answers), prompt: "Describe the music." });
    expect(first.text).toBe("Warm americana.");
    expect(answers.save()).toBe(true);

    const offline = mock("never asked");
    const replayed = await generateText({ model: replayModel(offline, new LlmStore(answers.file, "example")), prompt: "Describe the music." });
    expect(replayed.text).toBe("Warm americana.");
    expect(replayed.response.timestamp.toISOString()).toBe("2026-10-16T20:00:00.000Z");
    expect(offline.doGenerateCalls).toHaveLength(0);
    // The stored file keeps the answer, not the request body that repeats the prompt.
    expect(readFileSync(answers.file, "utf8")).not.toContain('"body"');
  });

  it("misses on a different question instead of answering it with an old answer", async () => {
    const answers = store();
    await generateText({ model: recordingModel(mock("Warm americana."), answers), prompt: "Describe the music." });
    await expect(generateText({ model: replayModel(mock("never asked"), answers), prompt: "Describe the visuals." })).rejects.toBeInstanceOf(LlmFixtureMissError);
  });

  it("drops answers a run no longer asks for", async () => {
    const answers = store();
    await generateText({ model: recordingModel(mock("old"), answers), prompt: "Old question." });
    answers.save();
    const next = new LlmStore(answers.file, "example");
    await generateText({ model: recordingModel(mock("new"), next), prompt: "New question." });
    expect(next.prune()).toBe(1);
    expect(next.size).toBe(1);
  });
});
