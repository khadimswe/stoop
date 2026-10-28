import { describe, expect, it } from "vitest";
import { scrubTrace } from "./env";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { exampleFor } from "./runtime";
import type { PlanInputs } from "./schema";
import { outOfScope } from "./taste";
import { calmTimeline, tidy, twelveHour } from "./tidy";

describe("12-hour times", () => {
  it("converts 24-hour times and keeps one suffix on a range", () => {
    expect(twelveHour("Busy from 14:00 to 16:00")).toBe("Busy from 2 to 4 pm");
    expect(twelveHour("Drawings at 12:30 and 14:30")).toBe("Drawings at 12:30 and 2:30 pm");
    expect(twelveHour("Set up at 10:45")).toBe("Set up at 10:45 am");
    expect(twelveHour("Doors at 2:00")).toBe("Doors at 2:00");
    expect(twelveHour("At 3:30 pm")).toBe("At 3:30 pm");
  });
});

describe("busy windows as a suggestion", () => {
  it("never reads as traffic data", () => {
    expect(calmTimeline("First peak: give each spinner a card.")).toBe("First busy stretch: give each spinner a card.");
    expect(calmTimeline("Peak at 1 to 3 pm, restock at 2.")).toBe("Busiest stretch, usually 1 to 3 pm, restock at 2.");
    expect(calmTimeline("Point them to the door at the 1:00 and 3:00 peaks.")).toBe("Point them to the door at 1:00 and 3:00, the busiest stretches.");
  });
  it("drops a crowd nobody named, and keeps one the manager did", () => {
    expect(calmTimeline("Busiest from 2 to 4 pm after the train.")).toBe("Busiest from 2 to 4 pm.");
    expect(calmTimeline("Busiest from 2 to 4 pm after the train.", "People come off the train after 2 pm.")).toBe("Busiest from 2 to 4 pm after the train.");
  });
  it("never touches a quoted offer", () => {
    expect(tidy('Sign: "Open 9:00 to 21:00 deals" at 14:00')).toBe('Sign: "Open 9:00 to 21:00 deals" at 2 pm');
  });
});

describe("places out of scope for the month", () => {
  const pool = { name: "Quillon Park Pool (Outdoor)", tags: ["Public swimming pool", "Park"] };
  it("closes outdoor pools from October to April, and never uses tours or nightclubs", () => {
    expect(outOfScope(pool, "2026-11-07")).toMatch(/closed for the season/);
    expect(outOfScope(pool, "2026-07-11")).toBeNull();
    expect(outOfScope({ name: "Zevrin Helicopter Experience", tags: ["Sightseeing tour agency"] }, "2026-07-11")).toMatch(/tour company/);
    expect(outOfScope({ name: "Quillon Lounge", tags: ["Night club"] }, "2026-07-11")).toMatch(/nightclub/);
    expect(outOfScope({ name: "Quillon Bakery", tags: ["Bakery", "Tourist attraction"] }, "2026-11-07")).toBeNull();
  });
});

describe("trace reasons", () => {
  it("never repeat a genre, slang or identity word", () => {
    expect(scrubTrace('concepts.1.title or hook: "trap" names a music genre.')).toBe("concepts.1.title or hook: a genre word names a music genre.");
    expect(scrubTrace("Dropped a line about queer nights")).toBe("Dropped a line about an identity word nights");
    expect(scrubTrace("Kept 6 music styles for the city")).toBe("Kept 6 music styles for the city");
  });
});

describe("the replay answer", () => {
  const at = (city: string, region: string, lat: number, lon: number): PlanInputs => ({ ...PLAN_EXAMPLE_INPUTS["chicago-18th-street"], store: { ...PLAN_EXAMPLE_INPUTS["chicago-18th-street"].store, city, region, point: { lat, lon } } });
  it("is the same city, else the same state, else the nearest example store", () => {
    expect(exampleFor(at("Kennesaw", "GA", 34.04, -84.57))).toBe("atlanta-west-end");
    expect(exampleFor(at("Austin", "TX", 30.27, -97.74))).toBe("houston-east-end");
    expect(exampleFor(at("Milwaukee", "WI", 43.04, -87.91))).toBe("chicago-18th-street");
    expect(exampleFor(at("Birmingham", "AL", 33.52, -86.8))).toBe("atlanta-west-end");
  });
});
