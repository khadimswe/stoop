import { describe, expect, it } from "vitest";
import { eventDate, eventTime, keptConcept, posterAlt, posterText, wheelLine } from "./poster-text";
import { samplePlanReport } from "./posts-fixture";
import type { PlanReport } from "./schema";

describe("posterText", () => {
  it("sets the manager's offers verbatim, in order, character for character", () => {
    const report = samplePlanReport();
    const odd = [{ text: "  $25/mo unlimited (taxes incl.) & a FREE phone*  " }, { text: "Bring a friend: 2 lines, 1 bill" }, { text: "Ask about Lifeline" }];
    const text = posterText({ ...report, inputs: { ...report.inputs, offers: odd } });
    expect(text.offers).toEqual(odd.map((o) => o.text));
  });

  it("uses the store's own name and address, and no offer at all when none was typed", () => {
    const report = samplePlanReport();
    const text = posterText({ ...report, inputs: { ...report.inputs, offers: [] } });
    expect(text.store).toBe(report.inputs.store.name);
    expect(text.address).toBe(report.inputs.store.address);
    expect(text.offers).toEqual([]);
  });

  it("titles the poster with the kept concept, refs rendered from this run's Qloo results", () => {
    const report = samplePlanReport();
    expect(posterText(report).title).toBe("Taco Table Saturday");
    const plan = report.plan!;
    const withRef: PlanReport = { ...report, plan: { ...plan, concepts: plan.concepts.map((c) => (c.kept ? { ...c, title: "Tacos by [[place-taqueria]]" } : c)) } };
    expect(posterText(withRef).title).toBe("Tacos by Taqueria Fixture Grande");
    expect(keptConcept(report)?.id).toBe("taco-table");
  });

  it("says an example store is fictional and unaffiliated, and a live store says nothing of the kind", () => {
    expect(posterText(samplePlanReport({ kind: "example" })).disclaimer).toBe("Fictional store. Not affiliated with T-Mobile.");
    expect(posterText(samplePlanReport({ kind: "live" })).disclaimer).toBeNull();
    const cricket = samplePlanReport({ kind: "example" });
    expect(posterText({ ...cricket, inputs: { ...cricket.inputs, store: { ...cricket.inputs.store, carrier: "cricket" } } }).disclaimer).toMatch(/^Fictional store\. Not affiliated with/);
  });

  it("writes the alt text from the same lines", () => {
    const alt = posterAlt(posterText(samplePlanReport()));
    expect(alt).toContain("Taco Table Saturday");
    expect(alt).toContain("$25/mo unlimited with a free phone when you switch");
    expect(alt).toContain("Corner Wireless on Fifth");
  });
});

describe("wheelLine", () => {
  const slice = (kind: "promo" | "gift_card" | "snack" | "other") => ({ label: "x", kind, text: "x", origin: kind === "promo" ? ("yours" as const) : ("creative" as const), refs: [], evidenceIds: [] });
  const plan = (kinds: ("promo" | "gift_card" | "snack" | "other")[]) => ({ wheel: { slices: kinds.map(slice), rules: ["Free to spin."] } });

  it("says there is a wheel in one line, from what its slices are", () => {
    expect(wheelLine(plan(["promo", "gift_card", "snack", "other"]))).toBe("Spin the prize wheel: store deals and free gift cards. Free to spin, no purchase needed.");
    expect(wheelLine(plan(["promo", "promo", "snack", "other"]))).toBe("Spin the prize wheel: store deals. Free to spin, no purchase needed.");
    expect(wheelLine(plan(["gift_card", "snack", "other", "other"]))).toBe("Spin the prize wheel: free gift cards. Free to spin, no purchase needed.");
    expect(wheelLine({})).toBeNull();
    expect(wheelLine(null)).toBeNull();
  });

  it("sets it on the poster only when the plan has a wheel", () => {
    const report = samplePlanReport();
    expect(posterText(report).wheel).toBeNull();
    const withWheel = { ...report, plan: { ...report.plan!, ...plan(["promo", "gift_card", "snack", "other"]) } };
    expect(posterText(withWheel).wheel).toMatch(/^Spin the prize wheel/);
    expect(posterAlt(posterText(withWheel))).toContain("Free to spin, no purchase needed.");
  });
});

describe("an event away from the store", () => {
  it("shows the event's place and names the store as host", () => {
    const report = samplePlanReport();
    const text = posterText({ ...report, inputs: { ...report.inputs, setting: "community_event", location: { name: "Testville Fall Fair", point: { lat: 41.86, lon: -87.64 } } } });
    expect(text.location).toBe("Testville Fall Fair");
    expect(text.store).toBe("Corner Wireless on Fifth");
    expect(posterAlt(text)).toContain("at Testville Fall Fair, hosted by Corner Wireless on Fifth");
    expect(posterText(report).location).toBeNull();
  });
});

describe("dates and times", () => {
  it("reads the event day as a calendar day", () => {
    expect(eventDate("2026-11-07")).toBe("Saturday, November 7");
    expect(eventDate("2026-01-01")).toBe("Thursday, January 1");
  });

  it("writes the time span from the start and the duration", () => {
    expect(eventTime("12:00", 240)).toBe("12 to 4 pm");
    expect(eventTime("11:00", 120)).toBe("11 am to 1 pm");
    expect(eventTime("18:30", 150)).toBe("6:30 to 9 pm");
    expect(eventTime("09:15", 45)).toBe("9:15 to 10 am");
    expect(eventTime("22:00", 180)).toBe("10 pm to 1 am");
  });
});
