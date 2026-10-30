import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planEventSchema, reducePlan, toPlanReport } from "../plan/events";
import { PLAN_EXAMPLES, examplePlanId, type PlanExampleSlug } from "../plan/example-list";
import type { PlanReport } from "../plan/schema";
import { landingCompare } from "../plan/view/floor";
import { planView, sourceFromReport, type PlanView } from "../plan/view/plan";
import { titleGenre } from "../plan/words";
import { ageSpan, listOf, pickReceipts, postTimeline, storeShowcase, verdictText } from "./landing-stores";
import { genericCheckWords, usDistance, usRadius } from "./plain-words";
import { andList, recordedNames } from "../testing/recorded-names";
import { describeRecorded, ifRecorded } from "../testing/recorded";

// The landing's store showcase, against the recorded example runs (data/plans/<slug>/plan.events.json).
function load(slug: PlanExampleSlug): { view: PlanView; report: PlanReport } {
  const events = planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
  const report = toPlanReport(reducePlan(events), "recorded");
  return { view: planView(sourceFromReport(report, examplePlanId(slug))), report };
}
const stores = ifRecorded(() => PLAN_EXAMPLES.map(({ slug, city }) => ({ slug, city, ...load(slug) })));
const chicago = ifRecorded(() => stores.find((s) => s.slug === "chicago-18th-street")!);
const houston = ifRecorded(() => stores.find((s) => s.slug === "houston-east-end")!);

describe("small wording helpers", () => {
  it("merges age bands that run on, and leaves the rest", () => {
    expect(ageSpan("25 to 29 and 30 to 34")).toBe("25 to 34");
    expect(ageSpan("18 to 24 and 25 to 29")).toBe("18 to 29");
    expect(ageSpan("30 to 34 and 35 to 44")).toBe("30 to 44");
    expect(ageSpan("25 to 29 and 35 to 44")).toBe("25 to 29 and 35 to 44");
    expect(ageSpan("45 to 54 and 55 and older")).toBe("45 and older");
    expect(ageSpan("25 to 29")).toBe("25 to 29");
  });

  it("says distances in US units: feet up close, miles to a tenth, the radius as about 1 mile", () => {
    expect(usDistance(60)).toBe("200 ft");
    expect(usDistance(520)).toBe("0.3 miles");
    expect(usDistance(840)).toBe("0.5 miles");
    expect(usDistance(1610)).toBe("1 mile");
    expect(usRadius(1500)).toBe("about 1 mile");
    expect(usRadius(800)).toBe("about 0.5 miles");
  });

  it("lists with a final and", () => {
    expect(listOf(["A"])).toBe("A");
    expect(listOf(["A", "B"])).toBe("A and B");
    expect(listOf(["A", "B", "C"])).toBe("A, B and C");
  });
});

describeRecorded("each example store's showcase", () => {
  for (const { slug, city, view } of stores) {
    const show = storeShowcase(view, slug, city);

    it(`${slug}: the verdict names only Qloo places and the city, each with a receipt`, () => {
      const picks = show.verdict.filter((p) => p.kind === "pick");
      expect(picks.length).toBeGreaterThanOrEqual(2);
      const names = new Set([...(view.local.block?.places.map((p) => p.name) ?? []), `Qloo ranks for ${view.local.city?.name}`]);
      for (const pick of picks) {
        expect(names.has(pick.text)).toBe(true);
        expect(pick.receipt && view.receipts[pick.receipt]).toBeTruthy();
        expect(pick.href).toMatch(/^\/(s|plan)\//);
      }
      expect(verdictText(show.verdict)).toMatch(/\.$/);
      expect(titleGenre(verdictText(show.verdict))).toBeNull();
    });

    it(`${slug}: three pick cards from the plan, Music, Food and Prize game, each with a receipt and never "snacks"`, () => {
      expect(show.picks.map((p) => p.title)).toEqual(["Music", "Food", "Prize game"]);
      for (const p of show.picks) {
        expect(p.receipt && view.receipts[p.receipt]).toBeTruthy();
        expect(p.href).toMatch(/^\/(s|plan)\//);
        expect(`${p.value} ${p.note}`).not.toMatch(/snack/i);
      }
      // The food card names a place Qloo found near the store.
      expect(view.local.block!.places.map((p) => p.name)).toContain(show.picks[1]!.value);
      expect(show.picks[0]!.note).toMatch(/^Qloo's #\d+(, #\d+)*( and #\d+)? for .+, adults \d+ (to \d+|and older)/);
    });

    it(`${slug}: the tab keeps the free-to-play line, the community map from Qloo and the fictional-store line`, () => {
      expect(show.meta).toContain("Free to play, no purchase needed");
      expect(show.map!.chip).toBe(`${view.local.block!.places.length} places from Qloo, within about 1 mile`);
      expect(show.map!.pins.map((p) => p.name)).toEqual(view.local.block!.places.map((p) => p.name));
      expect(show.fictional).toBe("Fictional store. Not affiliated with or endorsed by T-Mobile.");
    });

    it(`${slug}: the comparison names the generic plan's own picks and never a genre`, () => {
      const rows = landingCompare(view);
      expect(rows.map((r) => r.row)).toEqual(["Music", "Food", "Prizes", "Places"]);
      for (const r of rows) for (const text of [r.generic, r.stoop]) expect(titleGenre(text)).toBeNull();
      const music = rows[0]!;
      expect(music.generic).toMatch(/: famous, but .+ (make Qloo's own top \d+|makes Qloo's own top \d+|in the bottom half of its own list) for .+ adults \d+ to \d+/);
      for (const r of rows) for (const text of [r.generic, r.stoop]) expect(text).not.toMatch(/\d m\b|km\b|checkable|median|No local signal/);
      expect(music.genericReceipt && view.receipts[music.genericReceipt]?.subject).toBe("generic");
      expect(music.stoopReceipt).toBe(view.receipts[music.stoopReceipt!] ? music.stoopReceipt : null);
      expect(rows[3]!.generic).toBe("Names no place near the store");
      expect(rows[3]!.stoop).toBe(`${view.local.block!.places.length} places within about 1 mile, from Qloo`);
    });
  }

  it("Chicago reads like the plan: its spots, the city and the generic plan's three artists", () => {
    const show = storeShowcase(chicago.view, chicago.slug, chicago.city);
    // Qloo's names come from the recording, never written here (lib/testing/recorded-names.ts).
    const q = recordedNames(chicago.slug);
    expect(verdictText(show.verdict)).toBe(
      `Warm Cup Wheel Stop: hot coffee to-go box from ${q.snackPlace}, 0.3 miles away, a playlist of artists Qloo ranks for Chicago, and gift cards to ${q.giftCardPlace}.`,
    );
    expect(show.meta).toEqual(["$49 of a $50 budget", "Free to play, no purchase needed"]);
    const rows = landingCompare(chicago.view);
    // The first generic artist has no measurable affinity and the other two beat none of Qloo's 20: none makes the top 20.
    expect(rows[0]!.generic).toBe(`${andList(q.genericArtists)}: famous, but none of the 3 make Qloo's own top 20 for Chicago adults 25 to 34`);
    expect(rows[1]!.stoop).toBe(`Hot coffee to-go box from ${q.snackPlace}, 0.3 miles from the door`);
    expect(rows[0]!.stoop).toBe(`${andList(q.artists.slice(0, 3))}: Qloo's #1, #2 and #3 for Chicago adults 25 to 34`);
    expect(rows[1]!.generic).toBe("Cinnamon sugar pastries from “a nearby bakery”");
    expect(rows[2]!.generic).toBe("A gift card to “a nearby Pilsen food spot”");
  });

  it("Houston says which generic artist Qloo could not check", () => {
    const rows = landingCompare(houston.view);
    expect(rows[0]!.generic).toBe("Bun B, Selena and Solange: famous, but Bun B and Solange don't make Qloo's own top 19 for Houston adults 30 to 44, and Qloo couldn't find Selena");
    // The fair is the center, so distances are from the event.
    expect(rows[1]!.stoop).toMatch(/from the event$/);
  });
});

describe("Qloo's check of the generic playlist, read from the trace", () => {
  const step = (label: string, reason?: string, kind: "tool" | "decision" = "decision") => ({ key: label, stage: "baseline", stageLabel: "", startsGroup: false, kind, label, reason: reason ?? null, served: null, world: null, evidenceId: null });
  const city = { name: "Chicago", ageText: "25 to 29 and 30 to 34", artists: [] };
  const view = (steps: ReturnType<typeof step>[], line = "3 of 3 checkable picks sit below Chicago's median.") =>
    ({ trace: steps, local: { city, block: null, blockMusic: null, gaps: [] }, generic: { check: { line, receipt: null } } }) as unknown as Parameters<typeof genericCheckWords>[0];
  const searched = (name: string) => step(`Resolving the generic plan's "${name}" to a Qloo artist`, undefined, "tool");
  const checked = (name: string, what: string) => step("Checked a generic pick against Qloo", `${name}: ${what}`);

  it("matches a name Qloo spells differently, so a found artist is never called missing", () => {
    const words = genericCheckWords(
      view([searched("Beyonce"), searched("Common"), checked("Beyoncé", "beats 0 of 20 of Qloo's own Chicago artists, below their median."), checked("Common", "no measurable affinity for adults in Chicago at these ages.")], "2 of 2 checkable picks sit below Chicago's median."),
    );
    expect(words).toBe("neither makes Qloo's own top 20 for Chicago adults 25 to 34");
  });

  it("says the bottom half when a pick beats some of Qloo's own", () => {
    const words = genericCheckWords(view([searched("A"), checked("A", "beats 4 of 20 of Qloo's own Chicago artists, below their median.")], "1 of 1 checkable picks sit below Chicago's median."));
    expect(words).toBe("Qloo ranks it in the bottom half of its own list for Chicago adults 25 to 34");
  });

  it("says nothing when the trace doesn't add up to the check's own counts (a scrubbed step)", () => {
    // Two searched, one checked, but the check says none were unverifiable: a reason was dropped.
    expect(genericCheckWords(view([searched("A"), searched("B"), checked("A", "beats 0 of 20 of Qloo's own Chicago artists, below their median.")]))).toBeNull();
  });
});

describe("the posting timeline", () => {
  it("with posting on: announces at approval, then schedules Facebook the evening before, the morning of and an hour before", () => {
    const posts = postTimeline({ date: "2026-11-07", startTime: "12:00" }, true);
    expect(posts.map((p) => `${p.when} ${p.title}`)).toEqual(["Now Announce", "Fri 7 pm Evening before", "Sat 9 am Morning of", "Sat 11 am An hour before", "Any time Your groups"]);
    expect(posts.map((p) => p.statusText)).toEqual(["Posts on approve", "Scheduled", "Scheduled", "Scheduled", "One tap"]);
  });

  it("with posting off: the same posts, each ready to share or copy, and nothing scheduled", () => {
    const posts = postTimeline({ date: "2026-11-07", startTime: "12:00" }, false);
    expect(posts.map((p) => `${p.when} ${p.title}`)).toEqual(["Now Announce", "Fri 7 pm Evening before", "Sat 9 am Morning of", "Sat 11 am An hour before"]);
    expect(posts.map((p) => p.statusText)).toEqual(["Ready to share", "Ready to share", "Ready to share", "Ready to share"]);
    expect(posts.every((p) => p.status === "share" && p.channels.includes("WhatsApp"))).toBe(true);
  });

  it("skips the morning post when the table opens early", () => {
    expect(postTimeline({ date: "2026-11-21", startTime: "10:00" }, true).map((p) => p.title)).not.toContain("Morning of");
    expect(postTimeline({ date: "2026-11-21", startTime: "10:30" }, false).find((p) => p.title === "An hour before")!.when).toBe("Sat 9:30 am");
  });
});

describeRecorded("receipts", () => {
  it("sends only the receipts a page shows", () => {
    const keys = Object.keys(chicago.view.receipts).slice(0, 2);
    expect(Object.keys(pickReceipts(chicago.view.receipts, [...keys, null, "nope"]))).toEqual(keys);
  });
});
