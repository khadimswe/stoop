// What frames and revisions share: counting Claude's calls, adding a job's cost to the run's last
// cost (also when two jobs finish at once), and the names a stored run knows.
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { reduce } from "../events";
import { MemoryStore } from "../store/memory";
import { readRunEvents } from "../store/runs";
import { addRunCost, countingModel, emptyDelta, randomHex, reportNames } from "./after-run";
import { BASE_COST, exampleReport, knownArtist, LIVE_RUN_ID, storeExampleRun } from "./fixture-run";
import { describeRecorded } from "../testing/recorded";

const usage = { inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: undefined }, outputTokens: { total: 30, text: 30, reasoning: undefined } };
const delta = (frames: number) => ({ ...emptyDelta(), frames, estimateUsd: frames * 0.08 });

describe("countingModel", () => {
  it("counts every call and its tokens, and answers exactly as the model does", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text" as const, text: "ok" }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] }) });
    const counted = countingModel(model);
    const result = await generateText({ model: counted.model, prompt: "hi" });
    await generateText({ model: counted.model, prompt: "again" });
    expect(result.text).toBe("ok");
    expect(counted.tally).toEqual({ calls: 2, inputTokens: 240, outputTokens: 60, cachedInputTokens: 40 });
  });
});

describeRecorded("addRunCost", () => {
  it("adds to the run's last cost as a new run.cost", async () => {
    const store = new MemoryStore();
    await storeExampleRun(store);
    const total = await addRunCost(store, LIVE_RUN_ID, 1, delta(4));
    expect(total).toMatchObject({ frames: 4, estimateUsd: 0.7 });
    expect(reduce(await readRunEvents(store, LIVE_RUN_ID, 1)).cost).toEqual(total);
  });

  it("adds nothing while the run has no cost yet, or when the job cost nothing", async () => {
    const store = new MemoryStore();
    await storeExampleRun(store, { cost: null });
    expect(await addRunCost(store, LIVE_RUN_ID, 1, delta(4))).toBeNull();
    const priced = new MemoryStore();
    await storeExampleRun(priced);
    const before = (await readRunEvents(priced, LIVE_RUN_ID, 1)).length;
    expect(await addRunCost(priced, LIVE_RUN_ID, 1, emptyDelta())).toBeNull();
    expect((await readRunEvents(priced, LIVE_RUN_ID, 1)).length).toBe(before);
  });

  it("keeps both jobs' costs when two finish at once", async () => {
    const store = new MemoryStore();
    await storeExampleRun(store);
    await Promise.all([addRunCost(store, LIVE_RUN_ID, 1, delta(4)), addRunCost(store, LIVE_RUN_ID, 1, delta(3))]);
    const cost = reduce(await readRunEvents(store, LIVE_RUN_ID, 1)).cost!;
    expect(cost.frames).toBe(BASE_COST.frames + 7);
    expect(cost.estimateUsd).toBeCloseTo(BASE_COST.estimateUsd + 0.56, 6);
  });
});

describeRecorded("reportNames", () => {
  it("knows the seeds, every world's sources and picks, the panels and the generic brief's references, and skips lowercase words", () => {
    const report = exampleReport();
    const names = reportNames(report);
    for (const seed of report.inputs.seeds) expect(names).toContain(seed.ref.name);
    expect(names).toContain(knownArtist(report));
    expect(names.every((n) => /\s/.test(n) || n !== n.toLowerCase())).toBe(true);
  });
});

describe("randomHex", () => {
  it("makes lowercase hex of the asked length", () => {
    expect(randomHex(6)).toMatch(/^[0-9a-f]{12}$/);
    expect(randomHex(6)).not.toBe(randomHex(6));
  });
});
