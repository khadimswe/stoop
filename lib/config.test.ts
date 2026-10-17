import { describe, expect, it } from "vitest";
import { dailyCaps, isLive, videoSwitches } from "./config";

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
});
