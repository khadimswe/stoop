import { describe, expect, it } from "vitest";
import { byokEnabled, dailyCaps, isLive, judgingEndsAt, mcpCaps, renderLimits, videoSwitches } from "./config";

describe("runtime config", () => {
  it("stays in replay unless STOOP_LIVE is true (any case, trimmed)", () => {
    expect(isLive({})).toBe(false);
    expect(isLive({ STOOP_LIVE: "1" })).toBe(false);
    expect(isLive({ STOOP_LIVE: "false" })).toBe(false);
    expect(isLive({ STOOP_LIVE: " True " })).toBe(true);
  });

  it("uses the documented caps by default, and refuses a cap that is not a whole number", () => {
    expect(dailyCaps({})).toEqual({ liveRuns: 30, frames: 200, qloo: 500, renders: 0 });
    expect(dailyCaps({ LIVE_RUNS_DAILY_CAP: "5", FRAMES_DAILY_CAP: "0" })).toMatchObject({ liveRuns: 5, frames: 0 });
    expect(() => dailyCaps({ QLOO_DAILY_CAP: "lots" })).toThrow(/whole number/);
    expect(() => dailyCaps({ QLOO_DAILY_CAP: "-1" })).toThrow(/whole number/);
  });

  it("allows final renders only under the live video switch", () => {
    expect(videoSwitches({})).toEqual({ liveVideo: false, finalRender: false });
    expect(videoSwitches({ ENABLE_FINAL_RENDER: "true" })).toEqual({ liveVideo: false, finalRender: false });
    expect(videoSwitches({ ENABLE_LIVE_VIDEO: "true", ENABLE_FINAL_RENDER: "true" })).toEqual({ liveVideo: true, finalRender: true });
  });

  it("keeps server-paid renders at zero until a lifetime cap is set, with per-pass and per-IP limits", () => {
    expect(renderLimits({})).toEqual({ total: 0, perPass: 3, perIpDaily: 6, draftSeconds: 15 });
    expect(renderLimits({ RENDERS_TOTAL_CAP: "40", RENDER_DRAFT_SECONDS: "10" })).toMatchObject({ total: 40, draftSeconds: 10 });
    expect(() => renderLimits({ RENDER_DRAFT_SECONDS: "30" })).toThrow(/4 to 15/);
    expect(() => renderLimits({ RENDER_DRAFT_SECONDS: "2" })).toThrow(/4 to 15/);
  });

  it("ends judge passes and MCP tokens after Nov 16 everywhere in the US", () => {
    expect(new Date(judgingEndsAt({})).toISOString()).toBe("2026-11-17T08:00:00.000Z");
    expect(judgingEndsAt({ JUDGING_ENDS_AT: "2026-12-01T00:00:00Z" })).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(() => judgingEndsAt({ JUDGING_ENDS_AT: "soon" })).toThrow(/ISO date/);
  });

  it("keeps BYOK on unless it is switched off", () => {
    expect(byokEnabled({})).toBe(true);
    expect(byokEnabled({ ENABLE_BYOK: " FALSE " })).toBe(false);
  });

  it("caps MCP tool calls across all tokens", () => {
    expect(mcpCaps({}).daily).toBe(200);
    expect(mcpCaps({ MCP_DAILY_CAP: "0" }).daily).toBe(0);
  });

  it("gives MCP a share of the day's live runs, never more than the cap, and its own email budget", () => {
    expect(mcpCaps({})).toMatchObject({ liveRunsShare: 10, tokenEmailsDaily: 50, tokenEmailsPerAddressDaily: 2, issue: { perIpDaily: 3, daily: 100 } });
    expect(mcpCaps({ MCP_LIVE_RUNS_DAILY_SHARE: "25", LIVE_RUNS_DAILY_CAP: "12" }).liveRunsShare).toBe(12);
    expect(mcpCaps({ MCP_LIVE_RUNS_DAILY_SHARE: "0" }).liveRunsShare).toBe(0);
    expect(mcpCaps({ MCP_TOKEN_EMAILS_DAILY: "5" }).tokenEmailsDaily).toBe(5);
  });
});
