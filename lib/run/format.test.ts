import { describe, expect, it } from "vitest";
import { costSchema } from "../report/stages";
import { callsLine, costLine, formatClock, replayLine, replayProgressLine } from "./format";

describe("run formatting", () => {
  it("prints a mono clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(48_900)).toBe("0:48");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(723_000)).toBe("12:03");
    expect(formatClock(-4_000)).toBe("0:00");
  });

  it("counts live calls against the cap and cached ones apart", () => {
    expect(callsLine({ live: 23, cached: 9 }, 50)).toBe("23 of 50 Qloo calls · 9 cached");
  });

  it("writes the cost footer from the run's own cost, the dollars labeled as an estimate", () => {
    const cost = costSchema.parse({ durationMs: 48_400, qloo: { live: 31, cached: 9 }, claude: { calls: 7, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0.381 });
    expect(costLine(cost)).toBe("completed in 48 s · 31 Qloo calls · 9 cached · about $0.38");
    expect(costLine({ ...cost, qloo: { live: 1, cached: 0 } })).toContain("1 Qloo call ·");
  });

  it("says an example replay spent no live calls", () => {
    expect(replayLine({ live: 0, cached: 36 })).toBe("Recorded run · 36 Qloo answers replayed · no live calls");
    expect(replayProgressLine({ live: 0, cached: 1 })).toBe("Recorded run · 1 Qloo answer so far");
  });
});
