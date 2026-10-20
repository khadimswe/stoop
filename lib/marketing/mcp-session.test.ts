// The /mcp example session must say exactly what score_brief says for its input, on the recorded
// Qloo responses: the strict FixtureCache throws on any request that was not recorded.
import { describe, expect, it } from "vitest";
import { SCORE_BRIEF_BUDGET, SCORE_BRIEF_CAP } from "../qloo/budget";
import { createQlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { FixtureCache } from "../qloo/fixtures";
import { scoreBrief, scoreBriefInputSchema, scoreBriefText } from "../mcp/score-brief";
import { describeRecorded } from "../testing/recorded";
import { exampleSession, SCORE_INPUT, sessionReply, type RecordedSession } from "./mcp-session";
import { loadRecordedSession } from "./mcp-session-data";

describeRecorded("the /mcp example session, recorded", () => {
  it("shows score_brief's own answer for its input, and a reply built from it, replayed from the recordings", async () => {
    const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
    const ctx = createRunContext({ runId: "mcp-session-test", cap: SCORE_BRIEF_CAP, rowCaps: SCORE_BRIEF_BUDGET });
    const result = await scoreBrief(scoreBriefInputSchema.parse(SCORE_INPUT), { client, ctx });
    const recorded = loadRecordedSession();
    expect(scoreBriefText(result)).toBe(recorded.scoreAnswer);
    expect(sessionReply(result)).toBe(recorded.claudeReply);
    expect(result.calls.live).toBe(0);
  });
});

describe("the /mcp example session", () => {
  const recorded: RecordedSession = { scoreAnswer: "score_brief's answer", claudeReply: "Claude's reply" };

  it("uses placeholders, never a real run id or token, and the page's own origin", () => {
    const turns = exampleSession("https://stoop.example", recorded);
    const text = turns.map((t) => t.text).join("\n");
    expect(text).toContain("https://stoop.example/report/run_<id>");
    expect(text).not.toMatch(/run_[0-9a-f]{24}|stp_[A-Za-z0-9_-]{8,}/);
    expect(turns.filter((t) => t.tool).map((t) => t.tool)).toEqual(["score_brief", "culture_brief"]);
    expect(turns.find((t) => t.tool === "score_brief")?.text).toBe(recorded.scoreAnswer);
    expect(turns.find((t) => t.who === "claude")?.text).toBe(recorded.claudeReply);
  });

  it("builds Claude's reply from each choice's outcome and Qloo's top music picks", () => {
    const choice = { matched: null, position: null, measured: null, evidenceIds: [] };
    const pick = { id: "x", position: null, evidenceIds: [] };
    const reply = sessionReply({
      choices: [
        { ...choice, dimension: "music", text: "sea shanty", status: "below" },
        { ...choice, dimension: "mood", text: "Cozy", status: "unverifiable" },
      ],
      qlooPicks: [
        { ...pick, dimension: "music", name: "genre one" },
        { ...pick, dimension: "music", name: "genre two" },
        { ...pick, dimension: "mood", name: "a mood" },
      ],
    });
    expect(reply).toBe(
      "Sea shanty sits below this audience's reference median, and Qloo has no mood tag for \"cozy\". Qloo's own top music picks are genre one and genre two. Want a full Culture Brief?",
    );
  });
});
