// The prize wheel: a physical tabletop wheel the store already owns, so the plan says what goes on
// each slice. Code builds the slices from what Claude chose, never from free text it wrote:
// - a promo slice per manager promo: the promo verbatim (origin "yours"), with a short label made
//   only of the promo's own words, so a slice never promises more than the store offers;
// - 1 or 2 gift-card slices ($5 to $10) to places on the block Qloo ranks, with their receipts; the
//   label names the place from Qloo's answer;
// - optionally a free snack slice; and a "spin again" slice when the wheel needs four.
// Spinning is free, one spin per person, and the gift cards count against the budget.
import { z } from "zod";
import { textIssues, type GuardContext } from "./guard";
import { evidenceFor, toRealRefs, type Aliases } from "./prompt";
import { refsIn } from "./refs";
import type { Plan, PlanInputs, Wheel, WheelSlice } from "./schema";
import { normalizeName } from "../qloo/match";

export const GIFT_CARD_MIN_USD = 5;
export const GIFT_CARD_MAX_USD = 10;
export const MAX_GIFT_SLICES = 2;
export const MIN_SLICES = 4;
export const MAX_PROMO_SLICES = 8;

/** The wheel goes outside: on the sidewalk table and at a community event booth. */
export const wheelWanted = (inputs: PlanInputs) => inputs.setting === "sidewalk_table" || inputs.setting === "community_event";

export const llmWheel = z
  .object({
    promoLabels: z.array(z.object({ offer: z.number().describe("The offer's number in the offers list"), label: z.string().describe("At most 30 characters, made only of the offer's own words") })),
    giftCards: z
      .array(z.object({ place: z.string().describe("The p-key of a block place"), amountUsd: z.number().describe("5 to 10"), cards: z.number().describe("How many cards to buy for this slice") }))
      .describe("1 or 2 gift-card slices"),
    snack: z.object({ label: z.string().describe("At most 30 characters"), text: z.string().describe("At most 140 characters") }).nullable(),
  })
  .describe("The tabletop prize wheel's slices");
export type LlmWheel = z.infer<typeof llmWheel>;

export const WHEEL_RULES = ["Free to spin, no purchase needed. One spin per person.", "Promo slices show their full terms; staff explain them inside the store."];

const words = (text: string) => normalizeName(text).split(" ").filter(Boolean);

/** A promo label may only use the promo's own words (and numbers), so it never adds a promise. */
export function labelFromPromo(label: string, promo: string): boolean {
  const allowed = new Set(words(promo));
  const used = words(label);
  return used.length > 0 && used.every((w) => allowed.has(w));
}

const cut = (text: string, max: number) => {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  return (space > max / 2 ? head.slice(0, space) : text.slice(0, max)).replace(/[\s,/&:-]+$/, "");
};

export interface WheelCheck {
  wheel: Wheel | null;
  /** Gift cards to buy, for the shopping list. */
  purchases: Plan["shopping"];
  issues: string[];
}

export function checkWheel(raw: LlmWheel | null, inputs: PlanInputs, aliases: Aliases, guard: GuardContext): WheelCheck {
  const issues: string[] = [];
  if (!raw) return { wheel: null, purchases: [], issues: ["wheel: the event is outside, so plan the tabletop prize wheel's slices."] };
  const slices: WheelSlice[] = [];
  const purchases: Plan["shopping"] = [];

  // One promo slice per manager promo, the promo verbatim.
  inputs.offers.slice(0, MAX_PROMO_SLICES).forEach((offer, i) => {
    const asked = raw.promoLabels.find((p) => p.offer === i + 1)?.label.trim() ?? "";
    const label = asked && asked.length <= 40 && labelFromPromo(asked, offer.text) ? asked : cut(offer.text, 40);
    if (asked && label !== asked) issues.push(`wheel.promoLabels.${i + 1}: a promo label uses only the promo's own words, at most 40 characters ("${cut(offer.text, 30)}").`);
    slices.push({ label, kind: "promo", text: cut(offer.text, 160), origin: "yours", refs: [], evidenceIds: [] });
  });

  // Gift-card slices, to places on the block Qloo ranks.
  raw.giftCards.slice(0, MAX_GIFT_SLICES).forEach((card, i) => {
    const at = `wheel.giftCards.${i + 1}`;
    const id = aliases.ids.get(card.place.trim().replace(/^\[\[|\]\]$/g, "").toLowerCase());
    const place = id ? aliases.places.get(id) : undefined;
    if (!place || !id) return issues.push(`${at}: "${card.place}" is not a block place key.`);
    if (!Number.isFinite(card.amountUsd) || card.amountUsd < GIFT_CARD_MIN_USD || card.amountUsd > GIFT_CARD_MAX_USD) return issues.push(`${at}: a gift card is $${GIFT_CARD_MIN_USD} to $${GIFT_CARD_MAX_USD}.`);
    const amount = Math.round(card.amountUsd);
    const cards = Math.max(1, Math.min(10, Math.round(card.cards || 1)));
    if (place.chain && [...aliases.places.values()].some((p) => !p.chain && p.kind === "food")) issues.push(`${at}: the block has local independents; a gift card to one of them beats a chain.`);
    const evidenceIds = evidenceFor(aliases, [id], []);
    slices.push({ label: cut(`$${amount} ${place.name}`, 40), kind: "gift_card", text: `A $${amount} gift card to [[${id}]].`, origin: "qloo", refs: [id], evidenceIds });
    purchases.push({ item: `Gift cards for the wheel's ${place.name} slice`.slice(0, 120), qty: `${cards} at $${amount} each`, estUsd: cards * amount, from: id, origin: "interpreted", evidenceIds });
  });
  if (raw.giftCards.length === 0) issues.push("wheel.giftCards: add 1 or 2 gift-card slices to places on the block.");

  if (raw.snack) {
    const text = toRealRefs(raw.snack.text.trim(), aliases);
    const label = raw.snack.label.trim();
    const problems = [...textIssues(text, guard), ...textIssues(label, guard)];
    if (!label || label.length > 40) problems.push("label must be 1 to 40 characters.");
    if (!text || text.length > 160) problems.push("text must be 1 to 160 characters once keys become ids.");
    if (problems.length) issues.push(...problems.map((p) => `wheel.snack: ${p}`));
    else {
      const refs = refsIn(text);
      const evidenceIds = evidenceFor(aliases, refs, []);
      slices.push({ label, kind: "snack", text, origin: refs.length ? "interpreted" : "creative", refs, evidenceIds });
    }
  }
  while (slices.length < MIN_SLICES) slices.push({ label: "Spin again", kind: "other", text: "One more free spin.", origin: "creative", refs: [], evidenceIds: [] });

  const giftSlices = slices.filter((s) => s.kind === "gift_card");
  const rules = [
    ...WHEEL_RULES,
    giftSlices.length
      ? "Gift cards are bought ahead (see the shopping list) and handed over at the table; when a slice's cards run out, it pays a free snack instead."
      : "Gift-card slices pay a free snack when there are no cards left.",
  ];
  return { wheel: slices.length >= MIN_SLICES ? { slices: slices.slice(0, 12), rules } : null, purchases, issues };
}
