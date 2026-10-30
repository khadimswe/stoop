import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeRecorded, ifRecorded } from "../testing/recorded";
import { recordedNames } from "../testing/recorded-names";
import { askDrafts, askFacts, mailtoHref, okBy, placeKey, weekBefore } from "./ask";
import { canPlanAt } from "./event-spots";
import { planEventSchema, reducePlan, toPlanReport } from "./events";
import { PLAN_EXAMPLES, examplePlanId, type PlanExampleSlug } from "./example-list";
import type { Place, PlanReport } from "./schema";
import { planView, sourceFromReport } from "./view/plan";

// "Get the OK" drafts and the "Plan it here" place filter, against the recorded example runs.
function reportOf(slug: PlanExampleSlug): PlanReport {
  const events = planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
  return toPlanReport(reducePlan(events), "recorded");
}
const reports = ifRecorded(() => Object.fromEntries(PLAN_EXAMPLES.map(({ slug }) => [slug, reportOf(slug)])) as Record<PlanExampleSlug, PlanReport>);
const viewOf = (report: PlanReport, slug: PlanExampleSlug) => planView(sourceFromReport(report, examplePlanId(slug)));

const ORIGIN = "https://stoop.example";
const TODAY = "2026-10-30";
const LONG_DASH = String.fromCharCode(0x2014);
const DOLLARS = /\$\s?\d/;

/** The Houston plan with its table moved to one of its own Qloo places, as "Plan it here" would ask. */
function movedTo(report: PlanReport, place: Place): PlanReport {
  return { ...report, inputs: { ...report.inputs, setting: "community_event", location: { name: place.name, point: place.point! } } };
}

describeRecorded("Get the OK drafts on the recorded Houston plan", () => {
  const slug = "houston-east-end" as const;
  const report = reports[slug];
  const view = viewOf(report, slug);
  const facts = askFacts(view, report.inputs)!;
  const drafts = askDrafts(facts, { origin: ORIGIN, today: TODAY });
  const both = [drafts.manager, drafts.organizer];

  it("has drafts for a plan away from the store", () => {
    expect(report.inputs.setting).toBe("community_event");
    expect(facts).not.toBeNull();
  });

  it("puts the location, the date and the time in both drafts", () => {
    for (const d of both) {
      expect(d.subject).toContain("A fall community fair on Navigation Blvd");
      expect(d.subject).toContain("Sat, Nov 21");
      expect(d.body).toContain("a fall community fair on Navigation Blvd");
      expect(d.body).toContain("Saturday, Nov 21");
      expect(d.body).toContain("11 am to 4 pm");
    }
    expect(drafts.manager.subject).toBe("Table request: A fall community fair on Navigation Blvd, Sat, Nov 21");
  });

  it("gives the district manager the cost, the table, the plan's link and when the OK is needed", () => {
    const body = drafts.manager.body;
    expect(body).toContain("Cost: about $50 of a $50 budget");
    expect(body).toContain("a playlist of artists Qloo ranks for Houston");
    expect(body).toContain(`from ${recordedNames("houston-east-end").snackPlace}`);
    expect(body).toContain("a free prize game, no purchase needed");
    expect(body).toContain(`The plan: ${ORIGIN}/e/ex-houston-east-end`);
    expect(body).toContain("Need your OK by Saturday, Nov 14.");
    expect(body).toContain(`"${view.concept!.title}"`);
    expect(body).toMatch(/Where: A fall community fair on Navigation Blvd, \d+ ft from the store/);
  });

  it("asks the organizer for a table with no budget and no dollar figures", () => {
    const body = drafts.organizer.body;
    // A fictional example store never names a carrier in text that leaves the page.
    expect(body).toContain("Navigation Wireless, a wireless store at 2810 Navigation Blvd, Houston, TX 77003");
    expect(body).not.toContain("T-Mobile");
    expect(body).toContain("At the table: a free prize game (no purchase needed), music and snacks.");
    expect(body).toContain("We bring our own table, about 6 feet, and clean up after.");
    for (const q of ["Is there space for a table?", "Is there a vendor fee?", "Do you need insurance or a permit from us?"]) expect(body).toContain(q);
    expect(`${drafts.organizer.subject}\n${body}`).not.toMatch(DOLLARS);
    expect(body).not.toMatch(/budget|cost/i);
  });

  it("never says your customers, never uses a long dash, and claims no traffic or sales", () => {
    for (const d of both) {
      const text = `${d.subject}\n${d.body}`;
      expect(text).not.toMatch(/your customers/i);
      expect(text).not.toContain(LONG_DASH);
      expect(text).not.toMatch(/\b(traffic|lift|more sales|guarantee)\b/i);
    }
  });

  it("quotes Qloo on why there only when the location is one of Qloo's places", () => {
    // The recorded fair is not a Qloo place: no "Why there" line.
    expect(facts.whyThere).toBeNull();
    expect(drafts.manager.body).not.toContain("Why there");
    // Moved to Qloo's top park there: Qloo's rank and its own words.
    const park = report.local.block!.places.find((p) => p.kind === "park")!;
    const moved = movedTo(report, park);
    const movedFacts = askFacts(viewOf(moved, slug), moved.inputs)!;
    expect(movedFacts.whyThere).not.toBeNull();
    expect(movedFacts.whyThere!.receipt).toBe(`place:${park.id}`);
    const body = askDrafts(movedFacts, { origin: ORIGIN, today: TODAY }).manager.body;
    expect(body).toContain(`Why there: Qloo ranks it ${park.rank === 1 ? "1st" : `${park.rank}`}`);
    expect(body).toContain("among the parks it found within about 1 mile of the event");
    expect(body).toContain(`In Qloo's words: "${park.why!.slice(0, 30)}`);
    expect(body).not.toContain(LONG_DASH);
  });

  it("matches the location to a Qloo place by normalized name", () => {
    expect(placeKey("The Corner Cantina's on Main")).toBe(placeKey("corner cantinas on main"));
    const park = report.local.block!.places.find((p) => p.kind === "park")!;
    const moved = { ...movedTo(report, park), inputs: { ...movedTo(report, park).inputs, location: { name: park.name.toUpperCase().replace(/^THE /, ""), point: park.point! } } };
    expect(askFacts(viewOf(moved, slug), moved.inputs)!.whyThere).not.toBeNull();
  });

  it("names the carrier in words for a live plan, never for an example", () => {
    const live = planView({ ...sourceFromReport(report, "plan_0123456789abcdef01234567"), kind: "live" });
    const organizer = askDrafts(askFacts(live, report.inputs)!, { origin: ORIGIN, today: TODAY }).organizer.body;
    expect(organizer).toContain("Navigation Wireless, a Metro by T-Mobile store at");
    expect(drafts.organizer.body).not.toContain("Metro by T-Mobile");
  });

  it("promises no prize game when the plan has none", () => {
    const noGame = { ...report, plan: { ...report.plan!, wheel: undefined } };
    const noGameFacts = askFacts(viewOf(noGame, slug), noGame.inputs)!;
    expect(noGameFacts.game).toBe(false);
    const d = askDrafts(noGameFacts, { origin: ORIGIN, today: TODAY });
    for (const body of [d.manager.body, d.organizer.body]) expect(body).not.toMatch(/prize game/);
    expect(d.organizer.body).toContain("At the table: music and snacks.");
    expect(d.manager.body).toContain("At the table: a playlist of artists Qloo ranks for Houston; large order of chips");
  });

  it("builds a mailto link with the subject and body and no recipient", () => {
    const href = mailtoHref(drafts.manager);
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(drafts.manager.subject);
    expect(url.searchParams.get("body")).toBe(drafts.manager.body.replace(/\n/g, "\r\n"));
  });

  it("has no drafts once the table is back at the store", () => {
    const home = { ...report, inputs: { ...report.inputs, setting: "sidewalk_table" as const } };
    expect(askFacts(viewOf(home, slug), home.inputs)).toBeNull();
    const nowhere = { ...report, inputs: { ...report.inputs, location: undefined } };
    expect(askFacts(viewOf(nowhere, slug), nowhere.inputs)).toBeNull();
  });
});

describeRecorded("the examples at the store have no Get the OK drafts", () => {
  for (const slug of ["chicago-18th-street", "atlanta-west-end"] as const) {
    it(`${slug}: a sidewalk table needs no OK`, () => {
      const report = reports[slug];
      expect(askFacts(viewOf(report, slug), report.inputs)).toBeNull();
    });
  }
});

describe("the OK-by day", () => {
  it("is a week before the event, or as soon as you can once that has passed", () => {
    expect(weekBefore("2026-11-21")).toBe("2026-11-14");
    expect(weekBefore("2026-11-03")).toBe("2026-10-27");
    expect(okBy("2026-11-21", "2026-10-30")).toBe("by Saturday, Nov 14");
    expect(okBy("2026-11-21", "2026-11-14")).toBe("by Saturday, Nov 14");
    expect(okBy("2026-11-21", "2026-11-18")).toBe("as soon as you can");
    expect(okBy("2026-11-21", null)).toBe("by Saturday, Nov 14");
  });
});

const place = (over: Partial<Place>): Place => ({
  id: "p1",
  name: "A place",
  kind: "venue",
  tags: ["Event venue", "Tourist attraction"],
  address: null,
  point: { lat: 29.75, lon: -95.34 },
  distanceM: 200,
  why: "A multi-use event space.",
  rank: 1,
  affinity: null,
  popularity: null,
  evidenceIds: [],
  ...over,
});

describe("Plan it here: the places a table can go", () => {
  it("takes venues and parks with a point", () => {
    expect(canPlanAt(place({}))).toBe(true);
    expect(canPlanAt(place({ kind: "park", tags: ["Park", "City park"] }))).toBe(true);
  });

  it("skips food spots, shops, places without a point and chains", () => {
    expect(canPlanAt(place({ kind: "food" }))).toBe(false);
    expect(canPlanAt(place({ kind: "shop" }))).toBe(false);
    expect(canPlanAt(place({ point: null }))).toBe(false);
    expect(canPlanAt(place({ point: undefined }))).toBe(false);
    expect(canPlanAt(place({ chain: true }))).toBe(false);
  });

  it("skips bars, nightclubs, liquor stores, lounges and places for kids", () => {
    for (const tag of ["Bar", "Cocktail bar", "Night club", "Nightclub", "Nightlife", "Gastropub", "Lounge", "Hookah lounge", "Liquor store", "Brewery", "Comedy club", "Wine bar", "Casino", "Dance school", "Kids", "Teen center", "Children's museum", "Playground", "Public swimming pool", "Helicopter tour agency"])
      expect(canPlanAt(place({ tags: ["Event venue", tag] })), tag).toBe(false);
    for (const why of ["Intimate BYOB theater with improv.", "Historic hall hosting concerts, a bar, and a restaurant.", "Club-style performances and DJ nights.", "Indoor soccer with leagues, classes and summer camps.", "A youth arts space for kids."])
      expect(canPlanAt(place({ why })), why).toBe(false);
    // A park with a playground is still a park for everyone.
    expect(canPlanAt(place({ kind: "park", tags: ["Park"], why: "Neighborhood park with a playground and ball fields." }))).toBe(true);
  });
});

describeRecorded("Plan it here on the recorded communities", () => {
  for (const { slug } of PLAN_EXAMPLES) {
    it(`${slug}: offers only venues and parks with a point, no chain, nothing for alcohol or kids`, () => {
      const view = viewOf(reports[slug], slug);
      const spots = view.local.block!.places.filter((p) => p.eventSpot);
      expect(spots.length).toBeGreaterThan(0);
      for (const p of spots) {
        expect(["venue", "park"]).toContain(p.kind);
        expect(p.point).not.toBeNull();
        expect(p.chain).toBe(false);
        expect(p.why ?? "").not.toMatch(/\b(byob|bars?|night ?clubs?|club-style)\b/i);
      }
      for (const p of view.local.block!.places.filter((x) => x.kind === "food" || x.kind === "shop")) expect(p.eventSpot).toBe(false);
    });
  }

  it("houston-east-end: leaves out the BYOB comedy theater", () => {
    const view = viewOf(reports["houston-east-end"], "houston-east-end");
    const station = view.local.block!.places.find((p) => p.name.startsWith("Station Theater"))!;
    expect(station.eventSpot).toBe(false);
    expect(view.local.block!.places.find((p) => p.kind === "park")!.eventSpot).toBe(true);
  });
});
