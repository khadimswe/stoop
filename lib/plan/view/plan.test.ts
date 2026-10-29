import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planEventSchema, reducePlan, toPlanReport } from "../events";
import { PLAN_EXAMPLES, examplePlanId } from "../example-list";
import { planReportSchema } from "../schema";
import { planningSteps, railRows, readPlanResponse } from "./live";
import { clicheKind, compareRows, planView, shareLinks, sourceFromReport, sourceFromState, type PlanView, type TextPart } from "./plan";

// Built from the recorded example runs (data/plans/<slug>/plan.events.json), the way the pages build them.
function events(slug: string) {
  return planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
}
const views = Object.fromEntries(PLAN_EXAMPLES.map(({ slug }) => [slug, planView(sourceFromReport(toPlanReport(reducePlan(events(slug)), "recorded"), examplePlanId(slug)))])) as Record<
  string,
  PlanView
>;

const keysIn = (parts: readonly TextPart[]) => parts.flatMap((p) => (p.kind === "ref" && p.receipt ? [p.receipt] : []));

describe("the plan view of each recorded example", () => {
  for (const { slug } of PLAN_EXAMPLES) {
    const view = views[slug]!;

    it(`${slug}: names every ref from Qloo's own results, never a raw token`, () => {
      const texts = [
        ...(view.concept?.items.map((i) => i.plain) ?? []),
        ...view.runOfShow.flatMap((s) => s.parts.map((p) => (p.kind === "text" ? p.text : p.name))),
        ...view.checklist.flatMap((parts) => parts.map((p) => (p.kind === "text" ? p.text : p.name))),
      ];
      for (const t of texts) expect(t).not.toMatch(/\[\[|\]\]/);
      const names = new Set([...(view.local.city?.artists.map((a) => a.name) ?? []), ...(view.local.block?.places.map((p) => p.name) ?? [])]);
      for (const item of view.concept?.items ?? []) for (const p of item.parts) if (p.kind === "ref") expect(names.has(p.name)).toBe(true);
    });

    it(`${slug}: every receipt the page opens is in the receipts it sends, and every Qloo line has one`, () => {
      const used = [
        ...(view.concept?.items.flatMap((i) => [i.receipt, ...keysIn(i.parts), ...i.places.map((p) => p.receipt)]) ?? []),
        ...view.shopping.flatMap((s) => [s.receipt, s.from?.receipt ?? null]),
        ...(view.local.city?.artists.map((a) => a.receipt) ?? []),
        ...(view.local.block?.places.map((p) => p.receipt) ?? []),
      ].filter((k): k is string => k !== null);
      for (const key of used) expect(view.receipts[key], key).toBeDefined();
      for (const item of view.concept?.items ?? []) if (item.origin === "qloo" || item.origin === "interpreted") expect(item.receipt).not.toBeNull();
      for (const receipt of Object.values(view.receipts)) expect(receipt.rows.some((r) => r.label === "Endpoint")).toBe(true);
    });

    it(`${slug}: says it is fictional, quotes the promos exactly and shows adult bands only`, () => {
      const inputs = toPlanReport(reducePlan(events(slug))).inputs;
      expect(view.header.fictional).toBe("Fictional store. Not affiliated with or endorsed by T-Mobile.");
      expect(view.header.offers).toEqual(inputs.offers.map((o) => o.text));
      expect(view.header.ageText).not.toMatch(/24 and younger|younger/);
      expect(view.id).toBe(`ex-${slug}`);
      expect(view.marketing.eventPath).toBe(`/e/ex-${slug}`);
    });

    it(`${slug}: lines the two plans up kind by kind, with cliches struck and flagged once`, () => {
      const generic = view.generic!;
      expect(generic.rows.length).toBeGreaterThan(3);
      const kinds = generic.rows.map((r) => r.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      const flagged = generic.items.flatMap((g) => g.flags);
      expect(new Set(flagged.map((f) => f.label)).size).toBe(flagged.length);
      for (const g of generic.items) if (g.flags.some((f) => f.kind === "cliche")) expect(g.struck).toBe(true);
      expect(generic.planCliches.every((c) => clicheKind(c.text) === null || !generic.items.some((g) => g.kind === clicheKind(c.text)))).toBe(true);
    });
  }

  it("puts the Chicago partner's distance and Qloo's own why under the line that names it", () => {
    const view = views["chicago-18th-street"]!;
    const withPlace = view.concept!.items.find((i) => i.places.length > 0)!;
    expect(withPlace.places[0]!.why).toBeTruthy();
    expect(withPlace.places[0]!.distanceText).toMatch(/ m$| km$/);
    expect(view.partnerIds.length).toBeGreaterThan(0);
  });
});

describe("live plans", () => {
  it("rebuilds the same view from the live reducer state as from the report", () => {
    const slug = PLAN_EXAMPLES[0].slug;
    const state = reducePlan(events(slug));
    const live = planView(sourceFromState(state, examplePlanId(slug))!);
    expect(live.concept).toEqual(views[slug]!.concept);
    expect(live.header.storeName).toBe(views[slug]!.header.storeName);
  });

  it("marks the rail's stages done as the events arrive", () => {
    const all = events(PLAN_EXAMPLES[0].slug);
    const firstStageDone = all.findIndex((e) => e.type === "stage.done");
    const early = railRows(reducePlan(all.slice(0, firstStageDone + 1)));
    expect(early[0]!.status).toBe("done");
    expect(early.some((r) => r.status === "pending")).toBe(true);
    expect(railRows(reducePlan(all)).every((r) => r.status === "done")).toBe(true);
  });

  it("tells the agent's work as six steps, filled in as the events arrive", () => {
    const all = events(PLAN_EXAMPLES[0].slug);
    const start = planningSteps(reducePlan(all.slice(0, 2)));
    expect(start.map((s) => s.key)).toEqual(["music", "places", "ideas", "fit", "check", "marketing"]);
    expect(start[0]!.status).toBe("current");
    expect(start.slice(1, 5).every((s) => s.status === "pending")).toBe(true);
    const runDone = all.findIndex((e) => e.type === "run.done");
    const planned = planningSteps(reducePlan(all.slice(0, runDone + 1)));
    expect(planned.slice(0, 5).every((s) => s.status === "done")).toBe(true);
    expect(planned[0]!.title).toMatch(/^Read Chicago's music$/);
    expect(planned[1]!.title).toMatch(/^Found \d+ places within /);
    expect(planned[2]!.detail).toMatch(/scored \d+ of \d+$/);
    expect(planned[2]!.source).toBe("Claude");
    expect(planned[5]!.status).toBe("pending");
    expect(planningSteps(reducePlan(all))[5]!.status).toBe("done");
  });

  it("reads the plan route's answer as a report or as events", () => {
    const report = toPlanReport(reducePlan(events(PLAN_EXAMPLES[0].slug)));
    expect(readPlanResponse(report)).toEqual({ report });
    expect(readPlanResponse({ report })).toEqual({ report });
    expect(readPlanResponse({ events: events(PLAN_EXAMPLES[0].slug).slice(0, 3) })).toMatchObject({ events: expect.any(Array) });
    expect(readPlanResponse({ nope: true })).toBeNull();
  });
});

describe("the prize wheel", () => {
  it("quotes promo slices exactly and names gift-card places from Qloo, with receipts", () => {
    const report = toPlanReport(reducePlan(events("chicago-18th-street")));
    const place = report.local.block!.places[0]!;
    const promo = report.inputs.offers[0]!.text;
    // The wheel's shape is the pipeline's; its place and promo are the run's own.
    const withWheel = planReportSchema.parse({
      ...report,
      plan: {
        ...report.plan!,
        wheel: {
          slices: [
            { label: "Switch deal", kind: "promo", text: promo, origin: "yours", refs: [], evidenceIds: [] },
            { label: "Gift card", kind: "gift_card", text: `A $10 gift card to [[${place.id}]]`, origin: "qloo", refs: [place.id], evidenceIds: place.evidenceIds },
            { label: "Hand warmers", kind: "other", text: "A pair of hand warmers", origin: "creative", refs: [], evidenceIds: [] },
            { label: "Spin again", kind: "other", text: "Spin again", origin: "creative", refs: [], evidenceIds: [] },
          ],
          rules: ["Free to spin, no purchase needed."],
        },
      },
    });
    const wheel = planView(sourceFromReport(withWheel)).wheel!;
    expect(wheel.slices.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(wheel.slices[0]).toMatchObject({ text: promo, origin: "yours", receipt: null, kindLabel: "Promo" });
    expect(wheel.slices[1]!.text).toBe(`A $10 gift card to ${place.name}`);
    expect(wheel.slices[1]!.receipt).toBe("wheel:1");
    expect(wheel.rules).toEqual(["Free to spin, no purchase needed."]);
  });
});

describe("share links and rows", () => {
  it("adds the event page to the WhatsApp text once, and shares the page on Facebook", () => {
    const links = shareLinks("https://stoop.example/e/ex-x", "Saturday at noon, see you there");
    expect(decodeURIComponent(links.whatsapp.split("text=")[1]!)).toBe("Saturday at noon, see you there\nhttps://stoop.example/e/ex-x");
    expect(links.facebook).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fstoop.example%2Fe%2Fex-x");
    expect(decodeURIComponent(shareLinks("https://s/e/1", "Come by https://s/e/1").whatsapp.split("text=")[1]!)).toBe("Come by https://s/e/1");
  });

  it("puts block partners on the food row", () => {
    const view = views["chicago-18th-street"]!;
    const rows = compareRows(view.concept!.items, view.generic!.items);
    expect(rows.find((r) => r.kind === "partner")).toBeUndefined();
    expect(rows.find((r) => r.kind === "food")?.kindLabel).toBe("Food and partners");
  });
});
