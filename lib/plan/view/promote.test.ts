// The Promote timeline on the one schedule: the announcement now, then each reminder at its own time,
// grouped by the store's day, each with its own caption; and the calendar file of reminders.
import { describe, expect, it } from "vitest";
import { loadExampleReport } from "../examples";
import { PLAN_EXAMPLE_INPUTS } from "../example-list";
import { instagramCopy } from "../share";
import { planView, sourceFromReport } from "./plan";
import { channelDraft, channelMessage, facebookShareUrl, postNoun, promoteScreenView, promoteTimeline, remindersCalendar, SHARE_CHANNELS, timelineRows, whatsappShareUrl, type TimelineId } from "./promote";

async function chicago() {
  const report = await loadExampleReport("chicago-18th-street");
  const view = planView(sourceFromReport(report, report.meta.id));
  return { report, view, inputs: PLAN_EXAMPLE_INPUTS["chicago-18th-street"] };
}

describe("the Promote timeline", () => {
  it("announces now, then the evening before, the morning of and an hour before, by day, in one clock format", async () => {
    const { view, inputs } = await chicago();
    const days = promoteTimeline(promoteScreenView(view), inputs);
    expect(days.map((d) => d.label)).toEqual(["Now", "Fri, Nov 6", "Sat, Nov 7"]);
    expect(timelineRows(days).map((r) => [r.clock, r.name])).toEqual([
      ["Now", "Announce"],
      ["7 pm", "Evening before"],
      ["9 am", "Morning of"],
      ["11 am", "An hour before"],
    ]);
  });

  it("gives every post its own words: the approved draft first, then the reminders", async () => {
    const { view, inputs } = await chicago();
    const rows = timelineRows(promoteTimeline(promoteScreenView(view), inputs));
    expect(rows[0]!.text).toBe(view.marketing.posts!.facebook);
    expect(new Set(rows.map((r) => r.text)).size).toBe(rows.length);
    for (const row of rows) expect(row.instagram).toContain(view.marketing.posts!.hashtags[0]!);
  });

  it("drops reminders whose time has passed, once the browser knows the time", async () => {
    const { view, inputs } = await chicago();
    const morning = Date.parse("2026-11-07T15:30:00Z");
    expect(timelineRows(promoteTimeline(promoteScreenView(view), inputs, morning)).map((r) => r.id)).toEqual(["announce", "hour_before"]);
  });

  it("is empty before the plan has post drafts", async () => {
    const { view, inputs } = await chicago();
    expect(promoteTimeline({ ...promoteScreenView(view), marketing: { ...view.marketing, posts: null } }, inputs)).toEqual([]);
  });

  it("keeps the slice it passes small: no receipts, no plan lines", async () => {
    const { view } = await chicago();
    const slim = JSON.stringify(promoteScreenView(view));
    expect(slim.length).toBeLessThan(JSON.stringify(view).length / 5);
    expect(slim).not.toContain("receipt");
  });
});

describe("what each channel sends", () => {
  const url = "https://stoop.test/e/ex-chicago-18th-street";

  it("gives each channel its own words: Facebook's caption, Instagram's with its hashtags as posted, WhatsApp's message", async () => {
    const { report, view, inputs } = await chicago();
    const [announce, evening] = timelineRows(promoteTimeline(promoteScreenView(view), inputs));
    expect(channelDraft(announce!, "facebook")).toBe(report.posts!.facebook.text);
    expect(channelDraft(announce!, "instagram")).toBe(instagramCopy(report.posts!));
    expect(channelDraft(announce!, "whatsapp")).toBe(report.posts!.whatsapp.text);
    for (const channel of SHARE_CHANNELS) expect(channelDraft(evening!, channel)).toContain("Tomorrow, 12 to 4 pm: our table is out front.");
    expect(channelDraft(evening!, "instagram")).toMatch(/\n\n#Chicago /);
  });

  it("sends exactly the words shown: WhatsApp's with the event link as its own last line, the others as they are", () => {
    expect(channelMessage("whatsapp", "Come by.\n", url)).toBe(`Come by.\n${url}`);
    expect(channelMessage("whatsapp", `Come by. ${url}`, url)).toBe(`Come by. ${url}`);
    expect(channelMessage("facebook", "Come by.", url)).toBe("Come by.");
    expect(channelMessage("instagram", "Come by.\n\n#Chicago", url)).toBe("Come by.\n\n#Chicago");
    const message = channelMessage("whatsapp", "Hi neighbor! ☕ 50% off & more", url);
    expect(new URL(whatsappShareUrl(message)).searchParams.get("text")).toBe(message);
    expect(facebookShareUrl(url)).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
  });

  it("names each post as a sentence says it", () => {
    expect(["announce", "evening_before", "morning_of", "hour_before"].map((id) => postNoun({ id: id as TimelineId }))).toEqual(["announcement", "evening-before reminder", "morning-of reminder", "hour-before reminder"]);
  });
});

describe("the calendar file of reminders", () => {
  it("has one event with an alert at each reminder's time, its caption and the event link, folded and escaped", async () => {
    const { view, inputs } = await chicago();
    const rows = timelineRows(promoteTimeline(promoteScreenView(view), inputs));
    const ics = remindersCalendar(rows, { planId: view.id, storeName: "18th Street Wireless", eventUrl: "https://stoop.test/e/ex-chicago-18th-street", stamp: new Date("2026-10-29T12:00:00Z") })!;
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART:20261107T010000Z");
    expect(ics).toContain("UID:ex-chicago-18th-street-evening_before@stoop");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Event page: https://stoop.test/e/ex-chicago-18th-street");
    expect(unfolded).toContain("Tomorrow\\, 12 to 4 pm: our table is out front.\\n");
    expect(unfolded).not.toMatch(/https?:\/\/(?!stoop\.test)/);
  });

  it("names each reminder in plain words", async () => {
    const { view, inputs } = await chicago();
    const rows = timelineRows(promoteTimeline(promoteScreenView(view), inputs));
    const ics = remindersCalendar(rows, { planId: view.id, storeName: "18th Street Wireless", eventUrl: "https://stoop.test/e/x", stamp: new Date("2026-10-29T12:00:00Z") })!.replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Post the evening-before reminder for 18th Street Wireless");
    expect(ics).toContain("SUMMARY:Post the hour-before reminder for 18th Street Wireless");
    expect(ics).toContain("DESCRIPTION:Time to post the morning-of reminder");
    expect(ics).not.toMatch(/the an hour|Post the (evening|morning|an hour) (before|of) reminder/);
  });

  it("is null when every reminder has passed", () => {
    expect(remindersCalendar([], { planId: "p", storeName: "s", eventUrl: "u", stamp: new Date() })).toBeNull();
  });
});
