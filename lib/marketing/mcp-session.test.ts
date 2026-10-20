// The /mcp example session must say exactly what score_brief says for its input, on the recorded
// Qloo responses: the strict FixtureCache throws on any request that was not recorded.
import { describe, expect, it } from "vitest";
import { SCORE_BRIEF_BUDGET, SCORE_BRIEF_CAP } from "../qloo/budget";
import { createQlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { FixtureCache } from "../qloo/fixtures";
import { scoreBrief, scoreBriefInputSchema, scoreBriefText } from "../mcp/score-brief";
import { exampleSession, SCORE_ANSWER, SCORE_INPUT } from "./mcp-session";

describe("the /mcp example session", () => {
  it("shows score_brief's own answer for its input, replayed from the recordings", async () => {
    const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
    const ctx = createRunContext({ runId: "mcp-session-test", cap: SCORE_BRIEF_CAP, rowCaps: SCORE_BRIEF_BUDGET });
    const result = await scoreBrief(scoreBriefInputSchema.parse(SCORE_INPUT), { client, ctx });
    expect(scoreBriefText(result)).toBe(SCORE_ANSWER);
    expect(result.calls.live).toBe(0);
  });

  it("uses placeholders, never a real run id or token, and the page's own origin", () => {
    const turns = exampleSession("https://stoop.example");
    const text = turns.map((t) => t.text).join("\n");
    expect(text).toContain("https://stoop.example/report/run_<id>");
    expect(text).not.toMatch(/run_[0-9a-f]{24}|stp_[A-Za-z0-9_-]{8,}/);
    expect(turns.filter((t) => t.tool).map((t) => t.tool)).toEqual(["score_brief", "culture_brief"]);
  });
});
