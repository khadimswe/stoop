// "Not this vibe" on the hot sauce example's 35 to 44 world, stored as a finished live run. The
// revision replays every Qloo call from the recorded fixtures through a strict cache (a call nobody
// recorded throws, so a revision that needed fresh Qloo data would fail here), and Claude is the AI
// SDK mock: the Culture agent submits a brief that also tries to cite a rejected pick, and the concept
// writer answers with the world's recorded concepts. Plus the route's checks and limits.
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { CONTROL_RUN } from "../agent/baseline-brief";
import { SHARED_CREATIVE } from "../agent/creative";
import { loadRuns } from "../data-check/plan";
import { candidateMember } from "../demo/example-run";
import { createEmitter, reduce, type RunEvent } from "../events";
import { referenceSets } from "../geo/reference";
import { createQlooClient, type QlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { FixtureCache } from "../qloo/fixtures";
import type { World } from "../report/world";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { loadReport, readRunEvents } from "../store/runs";
import { mapControl, type ControlRunMap } from "./check";
import { BASE_COST, exampleReport, knownArtist, LIVE_RUN_ID, storeExampleRun } from "./fixture-run";
import { controlMaps, diffBriefs, requestRevision, resolveExclusions, runRevision, type ReviseEnv, type ReviseRouteDeps, type RevisionJob, type RevisionOutcome } from "./revise";
import { HAS_RECORDED_DATA, describeRecorded, ifRecorded } from "../testing/recorded";

const report = ifRecorded(() => exampleReport());
const world = ifRecorded(() => report.worlds.find((w) => w.segmentId === "seg-35-to-44")!);
const sourcesOf = (w: World, field: string) => w.culture!.find((f) => f.field === field)!.sources.map((s) => s.id);
const MUSIC = ifRecorded(() => sourcesOf(world, "music"));
const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 200, text: 200, reasoning: undefined } };
const NEW_MUSIC = "Gritty electric blues with a stomping kick drum and harmonica, mid tempo, raw and live.";

/** Candidate ids per field, read from the agent's prompt (what the agent was really offered). */
function offered(prompt: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let field = "";
  for (const line of prompt.split("\n")) {
    const header = /^(Music|Visual|Wardrobe|Setting|Mood|Creators) \(/.exec(line);
    if (header) field = header[1].toLowerCase();
    const candidate = /^- (\S+) \| .+ \| (?:beats (\d+) of (\d+)|no panel)(?: \(below median: do not cite\))?/.exec(line);
    if (field && candidate && !line.includes("below median")) (sections[field] ??= []).push(candidate[1]);
  }
  return sections;
}

/** Claude as the Culture agent (submit_brief) and as the concept writer (the world's recorded concepts). */
function claude() {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = options.prompt.map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : JSON.stringify(p))).join("\n"))).join("\n");
      prompts.push(text);
      if (options.tools?.some((t) => t.name === "submit_brief")) {
        const ids = offered(text);
        const cue = (words: string, list: string[] = [], n = 3) => ({ text: words, cites: list.slice(0, n) });
        const submission = {
          // Also cites a rejected pick, which the guard must drop.
          music: { text: NEW_MUSIC, cites: [MUSIC[0], ...(ids.music ?? []).slice(0, 3)] },
          visual: cue("Warm naturalistic grade, light grain, steady handheld close-ups.", ids.visual),
          wardrobe: cue("Worn-in chambray and canvas work jackets, no logos.", ids.wardrobe, 2),
          setting: [cue(`A neighborhood barbecue counter in ${world.settingCity!.label} at lunch.`, ids.setting, 2)],
          mood: cue("Easygoing, proud and a little wry.", ids.mood, 2),
          voice: { tone: cue("Dry and conversational, short lines.", ids.mood, 1), use: [], avoid: [] },
          talent: { text: "A fictional adult with an easygoing, unfussy look.", cites: [] },
          productRole: "The bottle finishes the plate.",
          hooks: ["This goes first."],
          creators: cue("A home cook who films plain, honest kitchen tests.", ids.creators, 2),
        };
        return { content: [{ type: "tool-call" as const, toolCallId: `c${prompts.length}`, toolName: "submit_brief", input: JSON.stringify(submission) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
      }
      const concepts = [world.concepts!.best, ...world.concepts!.others].map((c) => ({ concept: c.concept, uses: c.uses, rubric: c.rubric }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ concepts }) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
  return { model, prompts };
}

let client: QlooClient;
// The example scored all 3 of its recorded Control runs (a live run has one), mapped from the recordings.
let control: ControlRunMap[];
beforeAll(async () => {
  if (!HAS_RECORDED_DATA) return;
  // No key: a request the fixtures lack throws instead of reaching Qloo.
  client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
  const runs = loadRuns("food-hot-sauce");
  const ordered = [runs.find((r) => r.run === CONTROL_RUN)!, ...runs.filter((r) => r.run !== CONTROL_RUN)];
  const env = { client, ctx: createRunContext({ runId: "control-maps" }), emit: createEmitter().emit, reference: referenceSets(), inReference: true };
  control = await mapControl(env, ordered, report.inputs.seeds);
});

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

const reviseEnv = (model: MockLanguageModelV4): ReviseEnv => {
  const reference = referenceSets();
  return { store, client, model, modelId: "claude-sonnet-5-5", creative: SHARED_CREATIVE, reference, inReference: reference.full.members.includes(candidateMember("food-hot-sauce")), control, now: () => new Date("2026-10-17T12:00:00.000Z") };
};
const job = (over: Partial<RevisionJob> = {}): RevisionJob => ({ runId: LIVE_RUN_ID, attempt: 1, revisionId: "rev-0123456789ab", segmentId: world.segmentId, field: "music", reason: "Less roots, more grit.", exclude: MUSIC, ...over });
const newEvents = async (from: number) => (await readRunEvents(store, LIVE_RUN_ID, 1)).slice(from);

describeRecorded("runRevision", () => {
  it("rebuilds the world without the rejected picks, from cached Qloo answers only, and writes the diff", async () => {
    const { events: stored } = await storeExampleRun(store);
    const { model, prompts } = claude();
    const outcome: RevisionOutcome = await runRevision(reviseEnv(model), job());
    expect(outcome.message).toBeNull();
    expect(outcome.status).toBe("done");
    const revision = outcome.revision!;
    expect(revision.id).toBe("rev-0123456789ab");
    expect(revision.excluded).toEqual(MUSIC);
    // The agent tried to cite a rejected pick; the guard dropped it, and none of them back any cue.
    const cited = revision.culture.flatMap((f) => f.sources.map((s) => s.id));
    for (const id of MUSIC) expect(cited).not.toContain(id);
    expect(revision.culture.find((f) => f.field === "music")!.sources.length).toBeGreaterThan(0);
    expect(revision.changes.find((c) => c.slot === "music")).toMatchObject({ before: { text: world.brief!.music.text }, after: { text: NEW_MUSIC, origin: "interpreted" } });
    expect(revision.pack?.segmentId).toBe(world.segmentId);
    expect(revision.kit?.ugc.length).toBeGreaterThan(0);
    // Zero live Qloo calls: everything replayed from the recorded answers.
    expect(outcome.cost.qloo.live).toBe(0);
    expect(outcome.cost.qloo.cached).toBeGreaterThan(10);
    // The founder's note and the rejected wording reach Claude as quoted data, never as instructions.
    const agentPrompt = prompts[0];
    expect(agentPrompt).toContain('<data label="reason from the founder">\nLess roots, more grit.\n</data>');
    expect(agentPrompt).toContain('<data label="rejected wording">');
    expect(agentPrompt).not.toContain(`- ${MUSIC[0]} |`);

    const written = await newEvents(stored.length + 1);
    const types = written.map((e) => e.type);
    // One write: the revision last, then the cost it adds.
    expect(types.slice(types.indexOf("world.revised"))).toEqual(["world.revised", "run.cost"]);
    const steps = written.flatMap((e) => (e.type === "trace.step" ? [e.step] : []));
    expect(steps.every((s) => s.stage === "revise" && s.segmentId === world.segmentId)).toBe(true);
    expect(steps[0].label).toBe("Revising 35 to 44: not this music");
    expect(steps.map((s) => s.label)).toContain(`Replayed ${outcome.cost.qloo.cached} Qloo answers from the cache`);
    expect(steps.at(-1)?.label).toMatch(/^Changed \d+ brief cues? for 35 to 44$/);

    // The reducer takes the revision; the stored report carries it and the new cost.
    const state = reduce(await readRunEvents(store, LIVE_RUN_ID, 1));
    expect(state.worlds.find((w) => w.segmentId === world.segmentId)?.revisions.map((r) => r.id)).toEqual(["rev-0123456789ab"]);
    const saved = await loadReport(store, LIVE_RUN_ID);
    expect(saved?.worlds.find((w) => w.segmentId === world.segmentId)?.revisions).toHaveLength(1);
    expect(saved?.cost?.qloo).toEqual({ live: BASE_COST.qloo.live, cached: BASE_COST.qloo.cached + outcome.cost.qloo.cached });
    expect(saved?.cost?.claude.calls).toBe(BASE_COST.claude.calls + outcome.cost.claude.calls);
  });

  it("never lets a second revision bring back what the first one rejected", async () => {
    await storeExampleRun(store);
    await runRevision(reviseEnv(claude().model), job());
    // The founder now turns down the visual language: the route carries the music rejections over.
    const jobs: RevisionJob[] = [];
    const answer = await requestRevision(
      { live: true, store: () => store, headers: new Headers(), schedule: (task) => void task(), job: async (j) => (jobs.push(j), { status: "done", revision: null, message: null, cost: { durationMs: 0, qloo: { live: 0, cached: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0 } }) },
      { runId: LIVE_RUN_ID, segmentId: world.segmentId, field: "visual" },
    );
    expect(answer.status).toBe(202);
    for (const id of MUSIC) expect(jobs[0].exclude).toContain(id);
    const second = await runRevision(reviseEnv(claude().model), { ...jobs[0], revisionId: "rev-ba9876543210" });
    expect(second.status).toBe("done");
    const cited = second.revision!.culture.flatMap((f) => f.sources.map((s) => s.id));
    for (const id of MUSIC) expect(cited).not.toContain(id);
    expect(reduce(await readRunEvents(store, LIVE_RUN_ID, 1)).worlds.find((w) => w.segmentId === world.segmentId)?.revisions.map((r) => r.id)).toEqual(["rev-0123456789ab", "rev-ba9876543210"]);
  });

  it("adds a receipt the run lacks before the revision that cites it", async () => {
    const { events } = await storeExampleRun(store, { cost: null });
    // Drop one of the world's receipts from the stored ledger.
    const receipt = world.culture!.find((f) => f.field === "visual")!.sources[0].evidenceIds[0];
    const kept = events.filter((e) => !(e.type === "evidence.added" && e.evidence.id === receipt));
    await store.del(keys.run.events(LIVE_RUN_ID, 1));
    await store.append(keys.run.events(LIVE_RUN_ID, 1), kept);
    const outcome = await runRevision(reviseEnv(claude().model), job());
    expect(outcome.status).toBe("done");
    const written = await newEvents(kept.length);
    const added = written.findIndex((e) => e.type === "evidence.added" && e.evidence.id === receipt);
    expect(added).toBeGreaterThanOrEqual(0);
    expect(added).toBeLessThan(written.findIndex((e) => e.type === "world.revised"));
    expect(reduce(await readRunEvents(store, LIVE_RUN_ID, 1)).worlds.find((w) => w.segmentId === world.segmentId)?.revisions).toHaveLength(1);
  });

  it("fails in the trace, never with an exception, when a world cannot be revised", async () => {
    await storeExampleRun(store);
    const outcome = await runRevision(reviseEnv(claude().model), job({ segmentId: "seg-18-to-24" }));
    expect(outcome.status).toBe("failed");
    const labels = (await readRunEvents(store, LIVE_RUN_ID, 1)).flatMap((e) => (e.type === "trace.step" ? [e.step.label] : []));
    expect(labels).toContain("Could not revise this world");
  });

  it("explains a revision that would need fresh Qloo calls past its cap", async () => {
    await storeExampleRun(store);
    // A client with no recordings and no key: every call misses the cache and is refused.
    const empty = createQlooClient({ cache: new FixtureCache([], {}) });
    const outcome = await runRevision({ ...reviseEnv(claude().model), client: empty }, job());
    expect(outcome.status).toBe("failed");
    expect((await readRunEvents(store, LIVE_RUN_ID, 1)).some((e: RunEvent) => e.type === "world.revised")).toBe(false);
  });
});

describeRecorded("what a revision leaves out", () => {
  it("keeps only the world's own sources, defaults a cue to its sources, and the whole world to none", () => {
    expect(resolveExclusions(world, "music", [MUSIC[1], "not-a-source"])).toEqual([MUSIC[1]]);
    expect(resolveExclusions(world, "music", [])).toEqual(MUSIC);
    expect(resolveExclusions(world, "world", ["not-a-source"])).toEqual([]);
    expect(resolveExclusions(world, "visual", [MUSIC[0]])).toEqual([MUSIC[0]]);
  });

  it("carries every earlier rejection into the next revision", () => {
    const earlier = { id: "rev-aaaaaaaaaaaa", field: "music" as const, reason: null, excluded: [MUSIC[0]], changes: [], brief: world.brief!, culture: world.culture!, richSlots: [], concepts: null, pack: null, kit: null, evidenceIds: [] };
    const revised: World = { ...world, revisions: [earlier] };
    expect(resolveExclusions(revised, "world", [])).toEqual([MUSIC[0]]);
    expect(resolveExclusions(revised, "visual", [])).toEqual([MUSIC[0], ...sourcesOf(world, "visual")]);
    expect(resolveExclusions(revised, "music", [MUSIC[1]])).toEqual([MUSIC[0], MUSIC[1]]);
  });

  it("diffs cue by cue, including slots added or dropped", () => {
    const before = world.brief!;
    const after = { ...before, music: { text: NEW_MUSIC, origin: "creative" as const, evidenceIds: [] }, wardrobe: null };
    expect(diffBriefs(before, after).map((c) => c.slot)).toEqual(["music", "wardrobe"]);
    expect(diffBriefs(before, before)).toEqual([]);
  });

  it("rebuilds the generic brief's mapped picks in the run's order", () => {
    const state = reduce(JSON.parse(JSON.stringify([])) as RunEvent[]);
    expect(controlMaps(state.control, "35_to_44")[0].references).toEqual([]);
    const [map] = controlMaps({ ...report.control!, run: report.control!.run }, "35_to_44");
    expect(map.music.ref?.id).toBe(report.control!.mappings.find((m) => m.dimension === "music")?.ref?.id);
    expect(map.references.map((r) => r.ref?.id ?? null)).toEqual(report.control!.mappings.filter((m) => m.dimension === "reference").map((m) => m.ref?.id ?? null));
  });
});

describeRecorded("requestRevision (POST /api/revise)", () => {
  function deps(over: Partial<ReviseRouteDeps> = {}) {
    const jobs: RevisionJob[] = [];
    const scheduled: (() => Promise<unknown>)[] = [];
    const d: ReviseRouteDeps = {
      live: true,
      store: () => store,
      headers: new Headers({ "x-forwarded-for": "203.0.113.7" }),
      schedule: (task) => scheduled.push(task),
      job: async (j) => {
        jobs.push(j);
        return { status: "done", revision: null, message: null, cost: { durationMs: 0, qloo: { live: 0, cached: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0 } };
      },
      now: () => Date.parse("2026-10-17T12:00:00.000Z"),
      ...over,
    };
    return { d, jobs, scheduled };
  }
  const body = { runId: LIVE_RUN_ID, segmentId: world.segmentId, field: "music", reason: "Less roots, more grit." };

  it("refuses when live runs are off, and checks the body", async () => {
    expect((await requestRevision(deps({ live: false }).d, body)).body).toMatchObject({ error: { code: "off" } });
    const { d } = deps();
    expect((await requestRevision(d, { ...body, runId: "example-food-hot-sauce" })).status).toBe(400);
    expect((await requestRevision(d, { ...body, field: "talent" })).status).toBe(400);
    expect((await requestRevision(d, { ...body, reason: "x".repeat(281) })).status).toBe(400);
  });

  it("needs a finished run and the world", async () => {
    const { d } = deps();
    expect((await requestRevision(d, body)).status).toBe(404);
    await storeExampleRun(store, { status: "running" });
    expect((await requestRevision(d, body)).body).toMatchObject({ error: { code: "busy" } });
  });

  it("refuses a note that breaks the guardrails", async () => {
    await storeExampleRun(store);
    const { d, scheduled } = deps();
    expect((await requestRevision(d, { ...body, reason: `Make it sound like ${knownArtist(report)}.` })).body).toMatchObject({ error: { code: "invalid" } });
    expect((await requestRevision(d, { ...body, reason: "Set it at a playground picnic." })).body).toMatchObject({ error: { code: "invalid" } });
    expect(scheduled).toHaveLength(0);
  });

  it("starts the revision after the response, with a fresh child run id and the exclusions narrowed", async () => {
    await storeExampleRun(store);
    const { d, jobs, scheduled } = deps();
    const answer = await requestRevision(d, { ...body, exclude: [MUSIC[0], "not-a-source"] });
    expect(answer.status).toBe(202);
    expect(answer.body).toMatchObject({ status: "revising", eventsUrl: `/api/run/${LIVE_RUN_ID}/events`, message: null });
    const revisionId = (answer.body as { revisionId: string }).revisionId;
    expect(revisionId).toMatch(/^rev-[0-9a-f]{12}$/);
    await scheduled[0]();
    expect(jobs[0]).toMatchObject({ runId: LIVE_RUN_ID, attempt: 1, revisionId, segmentId: world.segmentId, field: "music", reason: "Less roots, more grit.", exclude: [MUSIC[0]] });
  });

  it("caps revisions per run", async () => {
    await storeExampleRun(store);
    const { d, scheduled } = deps({ revisionsPerRun: 2 });
    await requestRevision(d, body);
    await requestRevision(d, body);
    const third = await requestRevision(d, body);
    expect(third).toEqual({ status: 200, body: { status: "capped", revisionId: null, eventsUrl: `/api/run/${LIVE_RUN_ID}/events`, message: "This run has used its 2 revisions." } });
    expect(scheduled).toHaveLength(2);
  });

  it("limits each visitor per hour, by a salted hash of the IP", async () => {
    await storeExampleRun(store);
    const { d } = deps({ perVisitorHour: 1 });
    expect((await requestRevision(d, body)).status).toBe(202);
    expect((await requestRevision(d, body)).body).toMatchObject({ error: { code: "rate_limited" } });
    const other = deps({ perVisitorHour: 1, headers: new Headers({ "x-forwarded-for": "198.51.100.4" }) });
    expect((await requestRevision(other.d, body)).status).toBe(202);
  });
});
