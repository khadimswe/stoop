// The scheduling agent: the store's time zone, wall-clock times across a clock change, and the two or
// three suggested post times, all in the store's local day and all inside Meta's scheduling window.
import { describe, expect, it } from "vitest";
import { samplePlanReport } from "../plan/posts-fixture";
import { inScheduleWindow } from "./meta";
import { eventStart, localClock, storeTimeZone, suggestPostTimes, zonedInstant } from "./schedule";
import { readSocialTrail, socialLabel, socialStep } from "./trail";

const report = samplePlanReport();
const withInputs = (patch: Partial<typeof report.inputs>) => ({ inputs: { ...report.inputs, ...patch } });
const NOW = Date.parse("2026-10-28T15:00:00Z");

describe("the store's time zone", () => {
  it("comes from its state, by postal code or name", () => {
    expect(storeTimeZone({ region: "IL", point: { lat: 41.85, lon: -87.65 } })).toBe("America/Chicago");
    expect(storeTimeZone({ region: "ga", point: { lat: 33.7, lon: -84.4 } })).toBe("America/New_York");
    expect(storeTimeZone({ region: "Texas", point: { lat: 29.7, lon: -95.3 } })).toBe("America/Chicago");
    expect(storeTimeZone({ region: "AZ", point: { lat: 33.4, lon: -112 } })).toBe("America/Phoenix");
  });

  it("falls back to the longitude when the region is not a state", () => {
    expect(storeTimeZone({ region: "Ontario", point: { lat: 43.6, lon: -79.4 } })).toBe("America/New_York");
    expect(storeTimeZone({ region: "Somewhere", point: { lat: 34, lon: -118.2 } })).toBe("America/Los_Angeles");
  });
});

describe("wall-clock times", () => {
  it("land on the right instant on both sides of the November clock change", () => {
    // Daylight time ends Sunday, Nov 1, 2026 in the US.
    expect(zonedInstant("2026-10-30", 19 * 60, "America/Chicago").toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(zonedInstant("2026-11-07", 12 * 60, "America/Chicago").toISOString()).toBe("2026-11-07T18:00:00.000Z");
    expect(zonedInstant("2026-11-07", 12 * 60, "America/New_York").toISOString()).toBe("2026-11-07T17:00:00.000Z");
    expect(eventStart(report).toISOString()).toBe("2026-11-07T18:00:00.000Z");
    expect(localClock(new Date("2026-11-07T01:02:00Z"), "America/Chicago")).toBe("7:02 pm");
  });
});

describe("suggestPostTimes", () => {
  it("offers the evening before, the morning of and an hour before, in the store's time", () => {
    expect(suggestPostTimes(report, NOW)).toEqual([
      { id: "evening_before", at: "2026-11-07T01:00:00.000Z", name: "Evening before", label: "Fri, Nov 6, 7:00 pm" },
      { id: "morning_of", at: "2026-11-07T15:00:00.000Z", name: "Morning of", label: "Sat, Nov 7, 9:00 am" },
      { id: "hour_before", at: "2026-11-07T17:00:00.000Z", name: "An hour before", label: "Sat, Nov 7, 11:00 am" },
    ]);
  });

  it("is deterministic, and every time is one Meta can schedule", () => {
    const times = suggestPostTimes(report, NOW);
    expect(suggestPostTimes(report, NOW)).toEqual(times);
    for (const t of times) expect(inScheduleWindow(new Date(t.at), NOW)).toBe(true);
  });

  it("skips the morning post when the table opens early", () => {
    expect(suggestPostTimes(withInputs({ startTime: "10:00" }), NOW).map((t) => t.id)).toEqual(["evening_before", "hour_before"]);
  });

  it("leaves out times that are too soon or after the start", () => {
    // At 10:50 am in Chicago on the day, the other times have passed and 11:00 is under 15 minutes away.
    expect(suggestPostTimes(report, Date.parse("2026-11-07T16:50:00Z"))).toEqual([]);
    expect(suggestPostTimes(report, Date.parse("2026-11-07T14:00:00Z")).map((t) => t.id)).toEqual(["morning_of", "hour_before"]);
  });

  it("leaves out times Meta cannot schedule yet (more than 30 days ahead)", () => {
    expect(suggestPostTimes(withInputs({ date: "2027-02-20" }), NOW)).toEqual([]);
  });
});

describe("the trail", () => {
  it("writes and reads back what was posted, in the store's time", () => {
    const at = new Date("2026-11-07T01:02:00Z");
    expect(socialLabel("facebook", "posted", at, "America/Chicago")).toBe("Posted to Facebook at 7:02 pm on Fri, Nov 6");
    expect(socialLabel("instagram", "scheduled", at, "America/Chicago")).toBe("Scheduled on Instagram for 7:02 pm on Fri, Nov 6");
    const trace = [{ stage: "marketing" as const, kind: "decision" as const, label: "Wrote the Facebook, Instagram and WhatsApp drafts" }, socialStep("facebook", "posted", at, "America/Chicago"), socialStep("facebook", "scheduled", at, "America/Chicago")];
    expect(readSocialTrail(trace)).toEqual([
      { channel: "facebook", status: "posted", label: "Posted to Facebook at 7:02 pm on Fri, Nov 6" },
      { channel: "facebook", status: "scheduled", label: "Scheduled on Facebook for 7:02 pm on Fri, Nov 6" },
    ]);
  });
});
