// The reminder captions: one per scheduled time, each its own words, written by code from the inputs,
// with the manager's offers word for word, and every one passing the posts guard.
import { describe, expect, it } from "vitest";
import { PLAN_EXAMPLES } from "../plan/example-list";
import { loadExampleReport } from "../plan/examples";
import { samplePlanReport } from "../plan/posts-fixture";
import { checkReminder } from "./posts-guard";
import { reminderCaption, reminderLines, reminderOpening, reportReminderFacts } from "./reminders";
import { POST_TIME_IDS, postSlots } from "./schedule";

describe("reminder captions", () => {
  it.each(PLAN_EXAMPLES.map((e) => e.slug))("the %s example gets a distinct, guard-checked caption at each of its times", async (slug) => {
    const report = await loadExampleReport(slug);
    const facts = reportReminderFacts(report);
    const slots = postSlots(report);
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const captions = slots.map((s) => reminderCaption(facts, s.id));
    expect(new Set(captions).size).toBe(captions.length);
    // None repeats the announcement either.
    for (const caption of captions) expect(caption).not.toBe(report.posts?.facebook.text);
    for (const slot of slots) expect(checkReminder(report, slot.id)).toEqual([]);
  });

  it("quotes the offers exactly as typed, whole, and never cuts one mid-line", async () => {
    const report = await loadExampleReport("chicago-18th-street");
    const facts = reportReminderFacts(report);
    const offers = report.inputs.offers.map((o) => o.text);
    const evening = reminderLines(facts, "evening_before");
    for (const offer of offers) expect(evening).toContain(`Offer: ${offer}`);
    const hour = reminderLines(facts, "hour_before");
    expect(hour).toContain(`Offer: ${offers[0]}`);
    expect(hour).toContain(`${offers.length - 1} more offers at the table.`);
    for (const line of [...evening, ...hour].filter((l) => l.startsWith("Offer: "))) expect(offers).toContain(line.slice("Offer: ".length));
  });

  it("says the day, the time, where, and the wheel's own line, and nothing it was not given", async () => {
    const report = await loadExampleReport("atlanta-west-end");
    const facts = reportReminderFacts(report);
    expect(reminderOpening(facts, "evening_before")).toBe("Tomorrow, 1 to 5 pm: our table is out front.");
    expect(reminderOpening(facts, "morning_of")).toBe("Today, 1 to 5 pm: our table is out front.");
    expect(reminderOpening(facts, "hour_before")).toBe("In an hour, at 1 pm: our table is out front. Come say hi.");
    const caption = reminderCaption(facts, "evening_before");
    expect(caption).toContain(`Where: ${report.inputs.store.name}, ${report.inputs.store.address}`);
    expect(caption).toContain("Spin the prize wheel: store deals and free gift cards. Free to spin, no purchase needed.");
    expect(caption).toContain("Fictional store. Not affiliated with T-Mobile.");
    expect(caption).not.toMatch(/https?:|your customers|\bblock\b/i);
  });

  it("names an event away from the store by its place and its host", () => {
    const base = samplePlanReport();
    const report = { ...base, inputs: { ...base.inputs, setting: "community_event" as const, location: { name: "east End fall fair", point: base.inputs.store.point } } };
    const facts = reportReminderFacts(report);
    expect(reminderOpening(facts, "morning_of")).toContain("our booth is at East End fall fair");
    expect(reminderCaption(facts, "morning_of")).toContain(`Where: East End fall fair, hosted by ${base.inputs.store.name}`);
    for (const id of POST_TIME_IDS) expect(checkReminder(report, id)).toEqual([]);
  });

  it("is refused at post time when what the manager typed carries a link or alcohol", () => {
    const base = samplePlanReport();
    const report = { ...base, inputs: { ...base.inputs, offers: [{ text: "Free beer at bit.ly/x" }] } };
    expect(checkReminder(report, "evening_before").map((i) => i.message).join(" ")).toMatch(/link|alcohol/);
  });
});
