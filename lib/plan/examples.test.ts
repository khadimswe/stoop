// The recorded example plans: each one's events reduce to exactly its stored report (the golden
// test), the report passes the contract, and the pipeline replays offline to the same plan.
import { describe, expect, it } from "vitest";
import { PLAN_BUDGET, PLAN_CAP } from "../qloo/budget";
import { createRunContext } from "../qloo/context";
import { describeRecorded, ifRecorded } from "../testing/recorded";
import { createPlanEmitter, reducePlan, toPlanReport, type PlanEvent } from "./events";
import { examplePlanId, LEAD_PLAN_EXAMPLE, PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES, planExampleSlug } from "./example-list";
import { loadPlanExample } from "./examples";
import { runPlan } from "./pipeline";
import { refsIn } from "./refs";
import { replayClient, replayPlanModel } from "./replay";
import { planReportSchema, type PlanReport } from "./schema";
import { isChain } from "./taste";
import { genreOrSlang, titleGenre, VOLUME_FRAMING } from "./words";
import { scrubTrace } from "./env";

describe("the example list", () => {
  it("has one lead, three fictional stores in three cities, and ids accepted as plan ids", () => {
    expect(PLAN_EXAMPLES.filter((e) => e.lead)).toEqual([LEAD_PLAN_EXAMPLE]);
    expect(new Set(PLAN_EXAMPLES.map((e) => e.city)).size).toBe(PLAN_EXAMPLES.length);
    for (const example of PLAN_EXAMPLES) {
      expect(planExampleSlug(examplePlanId(example.slug))).toBe(example.slug);
      const inputs = PLAN_EXAMPLE_INPUTS[example.slug];
      expect(inputs.store.carrier).toBe("metro");
      expect(inputs.date.startsWith("2026-11")).toBe(true);
      expect(new Date(`${inputs.date}T12:00:00Z`).getUTCDay()).toBe(6);
    }
    expect(planExampleSlug("ex-nowhere")).toBeNull();
    expect(planExampleSlug("plan_000000000000000000000000")).toBeNull();
  });
});

const recorded = ifRecorded(() => Object.fromEntries(PLAN_EXAMPLES.map((e) => [e.slug, e.slug])));

describeRecorded.each(PLAN_EXAMPLES.map((e) => e.slug))("the %s example", (slug) => {
  void recorded;
  it("reduces its stored events to exactly its stored report", async () => {
    const { events, report } = await loadPlanExample(slug);
    expect(toPlanReport(reducePlan(events))).toEqual(report);
    expect(planReportSchema.safeParse(report).success).toBe(true);
    expect(report.meta).toMatchObject({ id: examplePlanId(slug), kind: "example", provenance: "recorded" });
    expect(report.cost).toBeNull();
  });

  it("names Qloo results only through refs, with a receipt on every Qloo line", async () => {
    const { report } = await loadPlanExample(slug);
    const offered = report.local.blockMusic?.used ? report.local.blockMusic.artists : [];
    const known = new Set([...(report.local.city?.artists.map((a) => a.id) ?? []), ...offered.map((a) => a.id), ...(report.local.block?.places.map((p) => p.id) ?? [])]);
    const names = [...(report.local.city?.artists.map((a) => a.name) ?? []), ...offered.map((a) => a.name), ...(report.local.block?.places.map((p) => p.name) ?? [])].filter((n) => n.length > 4);
    for (const concept of report.plan?.concepts ?? []) {
      for (const item of concept.items) {
        for (const ref of refsIn(item.text)) expect(known.has(ref)).toBe(true);
        if (item.origin === "qloo" || item.origin === "interpreted") expect(item.evidenceIds.length).toBeGreaterThan(0);
        for (const name of names) expect(item.text).not.toContain(name);
      }
    }
    for (const step of report.plan?.runOfShow ?? []) for (const ref of refsIn(step.step)) expect(known.has(ref)).toBe(true);
    for (const line of report.baseline?.items ?? []) expect(line.origin).toBe("creative");
  });

  it("never names a music genre or community slang in a title, a hook or a line, and never frames music by volume", async () => {
    const { report } = await loadPlanExample(slug);
    for (const concept of report.plan?.concepts ?? []) {
      expect(titleGenre(`${concept.title} ${concept.hook}`)).toBeNull();
      for (const item of concept.items) {
        expect(genreOrSlang(item.text.replace(/\[\[[A-Za-z0-9-]+\]\]/g, " "))).toBeNull();
        expect(VOLUME_FRAMING.test(item.text)).toBe(false);
      }
    }
    for (const step of report.plan?.runOfShow ?? []) expect(genreOrSlang(step.step.replace(/\[\[[A-Za-z0-9-]+\]\]/g, " "))).toBeNull();
    for (const line of report.baseline?.items ?? []) expect(genreOrSlang(line.text)).toBeNull();
  });

  it("buys every gift card the plan gives away, inside the budget", async () => {
    const { report } = await loadPlanExample(slug);
    const plan = report.plan!;
    const kept = plan.concepts.find((c) => c.kept)!;
    const places = new Set(report.local.block?.places.map((p) => p.id) ?? []);
    const given = new Set<string>();
    const gift = /gift ?cards?/i;
    for (const item of kept.items) if (gift.test(item.text)) for (const ref of item.refs) if (places.has(ref)) given.add(ref);
    for (const step of plan.runOfShow) if (gift.test(step.step)) for (const ref of refsIn(step.step)) if (places.has(ref)) given.add(ref);
    for (const slice of plan.wheel?.slices ?? []) if (slice.kind === "gift_card") for (const ref of slice.refs) given.add(ref);
    const bought = new Set(plan.shopping.filter((s) => s.from && gift.test(s.item)).map((s) => s.from));
    for (const id of given) expect(bought.has(id), `a gift card to ${id} is given away but not bought`).toBe(true);
    expect(plan.estimatedCostUsd).toBeLessThanOrEqual(PLAN_EXAMPLE_INPUTS[slug].budgetUsd);
  });

  it("writes 12-hour times and no traffic claims, and keeps raw tag names out of the trace", async () => {
    const { report } = await loadPlanExample(slug);
    const plan = report.plan!;
    const texts = [...plan.concepts.flatMap((c) => [c.title, c.hook, ...c.items.map((i) => i.text)]), ...plan.runOfShow.map((s) => s.step), ...plan.checklist, ...plan.shopping.map((s) => s.item), ...(report.baseline?.items.map((i) => i.text) ?? [])];
    for (const text of texts) {
      expect(text, text).not.toMatch(/\b(1[3-9]|2[0-3]):[0-5]\d\b/);
      expect(text, text).not.toMatch(/\bpeaks?\b/i);
    }
    for (const step of report.trace) {
      expect(scrubTrace(step.label)).toBe(step.label);
      if (step.reason) expect(scrubTrace(step.reason), step.reason).toBe(step.reason);
    }
  });

  it("keeps the plan inside its budget, with a free wheel whose promos are quoted exactly", async () => {
    const { report } = await loadPlanExample(slug);
    const plan = report.plan!;
    const inputs = PLAN_EXAMPLE_INPUTS[slug];
    expect(plan.estimatedCostUsd).toBeLessThanOrEqual(inputs.budgetUsd);
    expect(Math.round(plan.shopping.reduce((sum, s) => sum + (s.estUsd ?? 0), 0))).toBe(plan.estimatedCostUsd);
    expect(plan.checklist).toContain("Giveaways are free to enter, no purchase needed.");
    const wheel = plan.wheel!;
    expect(wheel.rules[0]).toBe("Free to spin, no purchase needed. One spin per person.");
    const promos = wheel.slices.filter((s) => s.kind === "promo").map((s) => s.text);
    expect(promos).toEqual(inputs.offers.map((o) => o.text));
    for (const slice of wheel.slices.filter((s) => s.kind === "gift_card")) expect(slice.evidenceIds.length).toBeGreaterThan(0);
  });

  it("keeps every place's point and marks no wireless store, and leaves chains for gift cards only", async () => {
    const { report } = await loadPlanExample(slug);
    for (const place of report.local.block?.places ?? []) {
      expect(place.point).not.toBeUndefined();
      expect(place.name).not.toMatch(/t-mobile|cricket wireless|boost mobile/i);
    }
    const chains = new Set((report.local.block?.places ?? []).filter((p) => isChain(p.name)).map((p) => p.id));
    for (const concept of report.plan?.concepts ?? []) for (const item of concept.items) if (item.kind === "partner") for (const ref of item.refs) expect(chains.has(ref)).toBe(false);
  });

  it("replays offline from its recordings to the same plan", async () => {
    const { report } = await loadPlanExample(slug);
    const events: PlanEvent[] = [];
    const emit = createPlanEmitter();
    const sink = { emit: (input: Parameters<typeof emit>[0]) => {
      const event = emit(input);
      events.push(event);
      return event;
    } };
    const runId = examplePlanId(slug);
    await runPlan({ client: replayClient(slug), ctx: createRunContext({ runId, cap: PLAN_CAP, rowCaps: PLAN_BUDGET }), sink, model: replayPlanModel(slug) }, { runId, kind: "example", inputs: PLAN_EXAMPLE_INPUTS[slug] });
    sink.emit({ type: "run.done" });
    const replayed: PlanReport = toPlanReport(reducePlan(events));
    expect(replayed.local).toEqual(report.local);
    expect(replayed.plan).toEqual(report.plan);
    expect(replayed.baseline).toEqual(report.baseline);
    expect(replayed.comparison).toEqual(report.comparison);
    // The trace's words too (its timings differ), so a wording change reaches the stored examples.
    expect(replayed.trace.map((t) => [t.stage, t.label, t.reason])).toEqual(report.trace.map((t) => [t.stage, t.label, t.reason]));
  });
});
