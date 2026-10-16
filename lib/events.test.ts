import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apply, createEmitter, initialState, reduce, runEventSchema, toReport, type RunEvent } from "./events";

// A real recorded run (data/runs/, produced by `npm run audience -- --picks` from fixtures).
const recorded = JSON.parse(readFileSync("data/runs/food-hot-sauce/audience.events.json", "utf8")) as RunEvent[];

describe("run events", () => {
  it("every recorded event parses with the one event schema", () => {
    for (const event of recorded) expect(runEventSchema.parse(event)).toEqual(event);
  });

  it("the reducer ignores order and duplicates, so an SSE reconnect changes nothing", () => {
    const shuffled = [...recorded].reverse();
    const doubled = [...recorded, ...recorded.slice(5, 20)];
    expect(reduce(shuffled)).toEqual(reduce(recorded));
    expect(reduce(doubled)).toEqual(reduce(recorded));
  });

  it("builds the report progressively: proof before the Reality Check before segments", () => {
    const upTo = (type: RunEvent["type"]) => reduce(recorded.slice(0, recorded.findIndex((e) => e.type === type) + 1));
    expect(upTo("audience.proof").audience).toMatchObject({ gap: null, segments: null });
    expect(upTo("audience.proof").audience.proof).not.toBeNull();
    expect(upTo("audience.gap").audience.segments).toBeNull();
    expect(upTo("run.done").status).toBe("done");
  });

  it("keeps one ledger entry per receipt even when the same call is reported twice", () => {
    const state = reduce(recorded);
    expect(new Set(state.ledger.map((e) => e.id)).size).toBe(state.ledger.length);
  });

  it("refuses to turn a run that is still going into a report", () => {
    expect(() => toReport(reduce(recorded.slice(0, 3)))).toThrow(/in progress/);
    expect(() => toReport(initialState)).toThrow(/never started/);
  });

  it("marks a stopped run partial, and its report says why", () => {
    const { emit, events } = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
    // The run start and the seed receipts, exactly as recorded.
    for (const event of recorded.slice(0, recorded.findIndex((e) => e.type === "stage.started"))) emit(event as never);
    emit({ type: "stage.started", stage: "prove" });
    emit({ type: "run.partial", stage: "prove", reason: "Need at least 2 seeds Qloo knows." });
    emit({ type: "run.done" });
    const report = toReport(reduce(events));
    expect(report.meta.provenance).toBe("partial");
    expect(report.partial).toEqual({ stage: "prove", reason: "Need at least 2 seeds Qloo knows." });
  });

  it("turns a failed run into a partial report, never a normal-looking one, and keeps it failed", () => {
    const upToProof = recorded.slice(0, recorded.findIndex((e) => e.type === "audience.proof") + 1);
    const at = "2026-10-16T20:00:00.000Z";
    const failed = reduce([...upToProof, { seq: 500, at, type: "run.failed", stage: "gap", message: "boom" }, { seq: 501, at, type: "run.done" }]);
    expect(failed).toMatchObject({ status: "failed", error: "boom" });
    const report = toReport(failed);
    expect(report.meta.provenance).toBe("partial");
    expect(report.partial).toEqual({ stage: "gap", reason: "boom" });
  });

  it("ignores events after the run ended, and a second run.started", () => {
    const done = reduce(recorded);
    const proof = recorded.find((e) => e.type === "audience.proof") as Extract<RunEvent, { type: "audience.proof" }>;
    const forged = { ...proof, seq: 900, proof: { ...proof.proof, cities: [] } };
    expect(reduce([...recorded, forged])).toEqual(done);
    const restart = { ...(recorded[0] as Extract<RunEvent, { type: "run.started" }>), seq: 5, runId: "someone-else" };
    expect(reduce([...recorded.filter((e) => e.seq !== 5), restart]).runId).toBe(done.runId);
  });

  it("applies a late event (lower seq, not yet seen) instead of dropping it", () => {
    const ten = recorded[10];
    const eleven = recorded[11];
    const inOrder = reduce(recorded.slice(0, 12));
    const late = apply(apply(reduce(recorded.slice(0, 10)), eleven), ten);
    expect(late.ledger.length).toBe(inOrder.ledger.length);
    expect(late.trace.length).toBe(inOrder.trace.length);
  });

  it("refuses a report that cites a receipt missing from its ledger", () => {
    const state = reduce(recorded);
    const forged = { ...state, audience: { ...state.audience, proof: state.audience.proof && { ...state.audience.proof, cities: state.audience.proof.cities.map((c) => ({ ...c, evidenceIds: ["ev_000000000000"] })) } } };
    expect(() => toReport(forged)).toThrow(/not in the ledger/);
  });
});
