// The table game: a drop board (drop a chip, it lands in one of 6 slots) next to the prize wheel. A
// drop-board plan is built into exactly 6 slots and says "drop board" everywhere code writes; a wheel
// plan's prompts and words stay exactly as they were (the recorded examples replay against them).
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { fallbackPlan, planPrompt } from "./builder";
import { conceptsInstructions, conceptsTask } from "./concepts";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { DROP_BOARD_SLOTS, gameOf, leftOffNote, offersLeftOff } from "./game";
import { guardFor } from "./guard-context";
import { inputProblemOf } from "./input-errors";
import { posterAlt, posterText, wheelLineOf } from "./poster-text";
import { checkPostText, composePosts, fallbackOpenings, postsPrompt } from "./posts";
import { samplePlanReport } from "./posts-fixture";
import { buildAliases } from "./prompt";
import { postPlan, type PlanRouteDeps } from "./routes";
import { planStartRequestSchema } from "./runtime";
import { inputsSchema, planReportSchema, type Concept, type PlanInputs, type PlanReport } from "./schema";
import { eventPageView } from "./view/event-page";
import { eventStats } from "./view/floor";
import { planView, sourceFromReport } from "./view/plan";
import { emptyStoreForm, parseStoreForm } from "./view/start-form";
import { checkWheel, type LlmWheel } from "./wheel";
import { reportReminderFacts } from "../social/reminders";

const SPIN_OR_WHEEL = /\b(spin|spins|spinning|wheel)\b/i;
const OFFERS = ["$25/mo unlimited with a free phone when you switch", "Free screen protector with any accessory", "$10 off any case", "Free SIM with a new line", "Bring your number, get $50 off", "Tablet line for $15 a month", "Free phone wallet with a port-in", "$5 off a charger"];

const report = samplePlanReport();
const aliases = buildAliases(report.local);
const key = (id: string) => aliases.keys.get(id) as string;
const TACO = "place-taqueria";
const BAKERY = "place-bakery";

function board(offers: readonly string[], raw: LlmWheel, game: PlanInputs["game"] | null = "drop_board") {
  const inputs: PlanInputs = { ...report.inputs, offers: offers.map((text) => ({ text })), ...(game ? { game } : {}) };
  return { inputs, ...checkWheel(raw, inputs, aliases, guardFor(inputs, aliases.ids.values())) };
}

describe("the drop board's slots", () => {
  it("has exactly 6 slots: promos verbatim, then gift cards with their Qloo receipts, then Drop again", () => {
    const { wheel, purchases, issues, leftOff } = board(OFFERS.slice(0, 2), { promoLabels: [{ offer: 1, label: "$25/mo unlimited" }], giftCards: [{ place: key(TACO), amountUsd: 10, cards: 2 }, { place: key(BAKERY), amountUsd: 5, cards: 3 }], snack: null });
    expect(issues).toEqual([]);
    expect(leftOff).toEqual([]);
    expect(wheel!.slices).toHaveLength(DROP_BOARD_SLOTS);
    expect(wheel!.slices.map((s) => s.kind)).toEqual(["promo", "promo", "gift_card", "gift_card", "other", "other"]);
    expect(wheel!.slices.slice(0, 2).map((s) => [s.text, s.origin])).toEqual([
      [OFFERS[0], "yours"],
      [OFFERS[1], "yours"],
    ]);
    expect(wheel!.slices[0]!.label).toBe("$25/mo unlimited");
    expect(wheel!.slices[2]).toMatchObject({ kind: "gift_card", origin: "qloo", refs: [TACO], label: "$10 Taqueria Fixture Grande" });
    expect(wheel!.slices[2]!.evidenceIds.length).toBeGreaterThan(0);
    expect(wheel!.slices[3]).toMatchObject({ origin: "qloo", refs: [BAKERY] });
    expect(wheel!.slices.slice(4).map((s) => [s.label, s.text, s.origin])).toEqual([
      ["Drop again", "One more free drop.", "creative"],
      ["Drop again", "One more free drop.", "creative"],
    ]);
    expect(wheel!.rules.slice(0, 2)).toEqual(["Free to play, no purchase needed. One drop per person.", "Promo slots show their full terms; staff explain them inside the store."]);
    expect(purchases.map((p) => [p.item, p.qty, p.from])).toEqual([
      ["Gift cards for the drop board: Taqueria Fixture Grande", "2 at $10 each", TACO],
      ["Gift cards for the drop board: Sample Street Bakery", "3 at $5 each", BAKERY],
    ]);
    for (const slice of wheel!.slices) expect(`${slice.label} ${slice.text}`).not.toMatch(SPIN_OR_WHEEL);
    for (const rule of wheel!.rules) expect(rule).not.toMatch(SPIN_OR_WHEEL);
  });

  it("keeps the first promos when there are more than fit, always saves a slot for a gift card, and says which are left off", () => {
    const { inputs, wheel, purchases, issues, leftOff } = board(OFFERS, { promoLabels: [], giftCards: [{ place: key(TACO), amountUsd: 10, cards: 2 }, { place: key(BAKERY), amountUsd: 5, cards: 1 }], snack: null });
    expect(wheel!.slices).toHaveLength(6);
    expect(wheel!.slices.filter((s) => s.kind === "promo").map((s) => s.text)).toEqual(OFFERS.slice(0, 5));
    expect(wheel!.slices[5]).toMatchObject({ kind: "gift_card", refs: [TACO] });
    // Only the gift card on the board is bought; leaving promos off is a note, not an error.
    expect(purchases.map((p) => p.from)).toEqual([TACO]);
    expect(issues).toEqual([]);
    expect(leftOff).toEqual(OFFERS.slice(5));
    expect(offersLeftOff(inputs.offers, wheel!.slices)).toEqual(OFFERS.slice(5));
    expect(leftOffNote(leftOff, OFFERS.length)).toBe(
      `The drop board has 6 slots, so it carries your first 5 promos of 8. Not on the board: "${OFFERS[5]}", "${OFFERS[6]}", "${OFFERS[7]}". Every promo is still on the poster and in the posts.`,
    );
    expect(leftOffNote([], 3)).toBeNull();
  });

  it("fills with gift cards, a snack and Drop again when there are no promos", () => {
    const { wheel } = board([], { promoLabels: [], giftCards: [{ place: key(TACO), amountUsd: 10, cards: 1 }], snack: { label: "Free churro", text: "A churro from the table." } });
    expect(wheel!.slices.map((s) => s.kind)).toEqual(["gift_card", "snack", "other", "other", "other", "other"]);
  });

  it("leaves the wheel as it was: every promo, no filler past four, the wheel's own rules", () => {
    const { wheel, purchases, leftOff } = board(OFFERS, { promoLabels: [], giftCards: [{ place: key(TACO), amountUsd: 10, cards: 2 }], snack: null }, null);
    expect(wheel!.slices.filter((s) => s.kind === "promo")).toHaveLength(8);
    expect(wheel!.slices).toHaveLength(9);
    expect(wheel!.rules[0]).toBe("Free to spin, no purchase needed. One spin per person.");
    expect(purchases[0]!.item).toBe("Gift cards for the wheel: Taqueria Fixture Grande");
    expect(leftOff).toEqual([]);
    const short = board([], { promoLabels: [], giftCards: [], snack: null }, null).wheel!;
    expect(short.slices.map((s) => s.label)).toEqual(["Spin again", "Spin again", "Spin again", "Spin again"]);
  });

  it("builds a 6-slot board in the plain plan too", () => {
    const inputs: PlanInputs = { ...report.inputs, game: "drop_board" };
    const kept = report.plan!.concepts.find((c) => c.kept) as Concept;
    const plain = fallbackPlan(inputs, kept, aliases);
    expect(plain.wheel!.slices).toHaveLength(6);
    expect(plain.wheel!.rules[0]).toBe("Free to play, no purchase needed. One drop per person.");
  });
});

describe("the prompts for a drop board", () => {
  it("change only the game sentences of the concepts task; the wheel's stay word for word", () => {
    expect(conceptsInstructions("wheel")).toBe(conceptsInstructions());
    const wheel = conceptsTask("wheel").split("\n");
    const drop = conceptsTask("drop_board").split("\n");
    expect(drop).toHaveLength(wheel.length);
    const changed = wheel.flatMap((line, i) => (line === drop[i] ? [] : [i]));
    expect(changed).toHaveLength(3);
    for (const i of changed) {
      expect(wheel[i]).toMatch(/wheel/i);
      expect(drop[i]).toMatch(/drop board/);
      expect(drop[i]!.replace("never call it a wheel or say spin", "")).not.toMatch(SPIN_OR_WHEEL);
    }
    // Everything else in the instructions is the same text.
    const a = conceptsInstructions("wheel");
    const b = conceptsInstructions("drop_board");
    expect(a.replace(conceptsTask("wheel"), "")).toBe(b.replace(conceptsTask("drop_board"), ""));
  });

  it("change only the game paragraph of the plan prompt", () => {
    const kept = report.plan!.concepts.find((c) => c.kept) as Concept;
    const wheel = planPrompt(report.inputs, kept, aliases).split("\n\n");
    const drop = planPrompt({ ...report.inputs, game: "drop_board" }, kept, aliases).split("\n\n");
    expect(drop).toHaveLength(wheel.length);
    const changed = wheel.flatMap((part, i) => (part === drop[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
    expect(wheel[changed[0]!]).toMatch(/^The prize wheel:/);
    expect(drop[changed[0]!]).toMatch(/^The drop board: .*6 prize slots/);
    expect(planPrompt({ ...report.inputs, game: "wheel" }, kept, aliases)).toBe(planPrompt(report.inputs, kept, aliases));
  });
});

/** The sample report with a drop board on its plan, built by the same code a run uses. */
function boardReport(offers: readonly string[] = OFFERS.slice(0, 2)): PlanReport {
  const { inputs, wheel, purchases } = board(offers, { promoLabels: [], giftCards: [{ place: key(TACO), amountUsd: 10, cards: 2 }], snack: null });
  const plan = { ...report.plan!, wheel: wheel!, shopping: [...report.plan!.shopping, ...purchases] };
  return planReportSchema.parse({ ...report, inputs, plan: { ...plan, estimatedCostUsd: Math.round(plan.shopping.reduce((sum, s) => sum + (s.estUsd ?? 0), 0)) } });
}

describe("a drop-board plan's own words", () => {
  const dropped = boardReport();

  it("puts the drop board on the poster and its alt text, never a spin or a wheel", () => {
    const text = posterText(dropped);
    expect(text.game).toBe("drop_board");
    expect(text.wheel).toBe("Drop a chip on the drop board: store deals and free gift cards. Free to play, no purchase needed.");
    expect(text.wheel).not.toMatch(SPIN_OR_WHEEL);
    expect(posterAlt(text)).not.toMatch(SPIN_OR_WHEEL);
    expect(wheelLineOf(["promo"])).toBe("Spin the prize wheel: store deals. Free to spin, no purchase needed.");
  });

  it("says drop board in the posts, the posts prompt and the reminders", () => {
    const posts = composePosts(fallbackOpenings(dropped), dropped);
    for (const text of [posts.facebook.text, posts.instagram.caption, posts.whatsapp.text]) {
      expect(text).toContain("Drop a chip on the drop board");
      expect(text).not.toMatch(SPIN_OR_WHEEL);
    }
    const prompt = postsPrompt(dropped);
    expect(prompt).toContain('You may say "drop a chip on the drop board"');
    expect(prompt).not.toContain("prize wheel");
    expect(reportReminderFacts(dropped).wheel).toBe(posterText(dropped).wheel);
  });

  it("lets a post name the drop board, and still refuses prize talk", () => {
    expect(checkPostText("Stop by and drop a chip on the drop board.", dropped, "facebook")).toEqual([]);
    expect(checkPostText("Stop by and win a prize at the table.", dropped, "facebook").length).toBeGreaterThan(0);
  });

  it("shows the board's slots, its title and the note for promos left off", () => {
    const view = planView(sourceFromReport(dropped));
    expect(view.wheel).toMatchObject({ game: "drop_board", title: "Drop board", note: null });
    expect(view.wheel!.slices).toHaveLength(6);
    expect(view.tiles.find((t) => t.key === "wheel")).toMatchObject({ label: "Drop board", value: "6 slots", note: "For your drop board" });
    expect(eventStats(view).at(-1)).toEqual({ value: "Free", label: "to play" });
    expect(Object.values(view.placeUses).flat()).not.toContain("Prize wheel");
    const page = eventPageView(sourceFromReport(dropped)).draws.wheel!;
    expect(page).toMatchObject({ play: "Drop a chip on the drop board", rule: "Free to play, no purchase needed", listLabel: "On the drop board" });

    const full = planView(sourceFromReport(boardReport(OFFERS))).wheel!;
    expect(full.note).toMatch(/^The drop board has 6 slots, so it carries your first 5 promos of 8\./);
    const wheel = planView(sourceFromReport(report));
    expect(wheel.wheel).toBeNull();
  });
});

describe("asking for a game", () => {
  const inputs = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];

  it("accepts the wheel, the drop board or nothing, and nothing else", () => {
    expect(gameOf(inputs)).toBe("wheel");
    expect(inputsSchema.safeParse({ ...inputs, game: "drop_board" }).success).toBe(true);
    expect(inputsSchema.safeParse({ ...inputs, game: "wheel" }).success).toBe(true);
    const bad = planStartRequestSchema.safeParse({ inputs: { ...inputs, game: "pegboard" } });
    expect(bad.success).toBe(false);
    const problem = inputProblemOf(bad.error!);
    expect([problem.field, problem.message, problem.status]).toEqual(["game", "Pick the game: a prize wheel or a drop board.", 400]);
  });

  it("answers a bad game with the API's 400 and the field", async () => {
    const deps = (store: MemoryStore | null): PlanRouteDeps => ({
      env: { STOOP_LIVE: "true", LIVE_RUNS_DAILY_CAP: "30" },
      store: () => {
        if (!store) throw new Error("no store");
        return store;
      },
      start: () => ({ schedule: () => {}, execute: async () => {}, randomHex: () => "0".repeat(24) }),
    });
    for (const store of [new MemoryStore(), null]) {
      const response = await postPlan(new Request("https://stoop.example/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: { ...inputs, game: "spinner" } }) }), deps(store));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid", message: "Pick the game: a prize wheel or a drop board." }, field: "game" });
    }
  });

  it("sends the drop board from the form only for a setting with a game, and never sends the wheel", () => {
    const form = { ...emptyStoreForm(), storeName: "Corner Wireless", address: "1 Main St", city: "Chicago", region: "IL", lat: "41.85", lon: "-87.65", date: "2026-11-07", offers: ["$25 unlimited"] };
    const parsed = (values: typeof form) => {
      const result = parseStoreForm(values, "2026-11-01");
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return result.inputs;
    };
    expect(parsed({ ...form, game: "drop_board" }).game).toBe("drop_board");
    expect("game" in parsed({ ...form, game: "wheel" })).toBe(false);
    expect("game" in parsed({ ...form, setting: "in_store", game: "drop_board" })).toBe(false);
    expect(parsed({ ...form, setting: "community_event", venueName: "Fall fair", venueLat: "41.86", venueLon: "-87.66", game: "drop_board" }).game).toBe("drop_board");
  });
});
