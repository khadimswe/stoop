// The plan's guard: every line Claude writes passes it before it reaches an event. It checks what
// Stoop's guardrails check (minors, ethnicity, likeness, health claims, invented proof) plus what a
// sidewalk event in front of a carrier's store needs:
// - refs: plan text names Qloo artists and places only as "[[id]]" tokens for ids this run measured;
// - receipts: qloo and interpreted lines cite Qloo, creative and "yours" lines cite nothing;
// - offers: prices and deal words appear only inside an offer quoted exactly as the manager typed it;
// - no alcohol or tobacco, nothing aimed at minors, no identity-based theme, no implied carrier
//   endorsement, and never "your customers" (Stoop measures a city and a block, not a store's buyers).
import { checkText, childSetting, type GuardRule } from "../guardrails";
import { refsIn } from "./refs";
import { genreOrSlang, VOLUME_FRAMING } from "./words";
import type { ItemKind } from "./schema";

export interface GuardContext {
  /** The manager's offers, as typed. */
  offers: readonly string[];
  /** The manager's budget, which plan text may mention. */
  budgetUsd: number;
  /** Ids of the artists and places this run measured. */
  known: ReadonlySet<string>;
  /** Real names text must not spell out: the run's artists and places (they go in as [[key]] refs), or the generic plan's own picks. */
  names?: readonly string[];
  /** The manager's notes (already guarded), for the checks of what they ask for. */
  notes?: string;
  /** The event's day, for places out of season. */
  date?: string;
}

const CHECKED_RULES = new Set<GuardRule>(["minor", "ethnicity", "likeness", "health-claim", "fake-proof", "em-dash", "named-reference"]);

export const ALCOHOL_TOBACCO =
  /\b(alcohol|alcoholic|beers?|wines?|liquor|booze|cocktails?|margaritas?|mimosas?|tequila|vodka|whiske?y|rum|bourbon|champagne|seltzers?|brewery|breweries|taproom|happy hour|shots? of|tobacco|cigars?|cigarettes?|vapes?|vaping|e-cig|hookah|cannabis|weed|marijuana|thc|cbd|kratom)\b/i;
export const YOUR_CUSTOMERS = /\byour (customers?|clients?|buyers?|shoppers?)\b/i;
/** Themes built on who people are: never a reason for an event. */
export const IDENTITY_THEME =
  /\b(drag|queer|gay|lesbian|lgbtq?i?a?\+?|pride|transgender|trans|heritage (month|night|day)|christian|church|gospel|worship|religious|muslim|jewish|catholic|ladies'? night|for (the )?(women|men|ladies|guys))\b/i;
/** The plan never says or implies the carrier sponsors, presents or endorses the event. */
export const CARRIER_ENDORSEMENT =
  /\b(sponsored by|presented by|in partnership with|endorsed by|official)\b[^.]{0,40}\b(metro|t-mobile|cricket|boost|at&t|verizon)\b|\b(metro|t-mobile|cricket|boost)(?: by t-mobile)?\s+(presents|sponsors|hosts|endorses)\b|\b(metro|t-mobile|cricket|boost)\s+logos?\b/i;
/**
 * Price and deal words that only a quoted offer may carry. Free food at the table is fine; a free
 * phone is an offer. A carrier promo day ("T-Mobile Tuesdays") counts too: the plan may build its
 * timing around one only when the manager typed it.
 */
export const OFFER_LANGUAGE =
  /\$\s?\d|\b\d+\s?%\s?off\b|\bdiscounts?\b|\bbogo\b|\bbuy one\b|\bfree (phones?|lines?|months?|activation|sim|smartphones?|devices?|tablets?|upgrades?)\b|\bwaived?\b|\brebates?\b|\bper month\b|\/mo\b|\bunlimited\b|\bport[- ]?ins?\b|\bfirst month\b|\bswitch and (get|save)\b|\btrade[- ]?ins?\b|\b(?:t-mobile|metro|cricket|boost)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b/i;

const PROMO_DAY = /\b(?:t-mobile|metro|cricket|boost)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b/g;
const squash = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** The text with every exactly quoted offer (and the budget) taken out, for the offer check. */
function withoutOffers(text: string, ctx: GuardContext): string {
  let rest = squash(text);
  for (const offer of ctx.offers) {
    const quoted = squash(offer);
    if (quoted) rest = rest.split(quoted).join(" ");
  }
  // A promo day the manager named in any offer ("T-Mobile Tuesdays") may set the event's timing.
  rest = rest.replace(PROMO_DAY, (day) => (ctx.offers.some((o) => squash(o).includes(day)) ? " " : day));
  // A gift card paid from the event budget is a giveaway, not an offer: "$10 gift card".
  rest = rest.replace(/\$\s?\d+(?:\.\d{2})?\s+(?:e-?)?gift\s?cards?/g, " gift card");
  return rest.replace(new RegExp(`\\$\\s?${ctx.budgetUsd}(?![\\d.])`, "g"), " ");
}

/** Every problem with one piece of plan text. Empty means it passes. */
export function textIssues(text: string, ctx: GuardContext): string[] {
  const issues: string[] = [];
  for (const issue of checkText(text, { names: ctx.names ?? [], exactCaseNames: true })) {
    if (!CHECKED_RULES.has(issue.rule)) continue;
    issues.push(issue.rule === "named-reference" ? `"${issue.match}" is written out: name artists and places only with their [[key]], never in words.` : issue.message);
  }
  const child = childSetting(text);
  if (child) issues.push(`"${child}" invites kids; the table is for adults on a public sidewalk.`);
  const alcohol = text.match(ALCOHOL_TOBACCO);
  if (alcohol) issues.push(`"${alcohol[0]}": no alcohol or tobacco at a sidewalk table or in giveaways.`);
  const customers = text.match(YOUR_CUSTOMERS);
  if (customers) issues.push(`"${customers[0]}": Stoop measures the city and the places in a community, never a store's customers. Say "your city" or "your community".`);
  const identity = text.match(IDENTITY_THEME);
  if (identity) issues.push(`"${identity[0]}": no theme built on who people are. Build it on the city's music and the community's places.`);
  const carrier = text.match(CARRIER_ENDORSEMENT);
  if (carrier) issues.push(`"${carrier[0]}": nothing may imply the carrier sponsors or endorses the event, and no logos: the store adds its official signage.`);
  const genre = genreOrSlang(text.replace(/\[\[[A-Za-z0-9-]+\]\]/g, " "));
  if (genre) issues.push(`"${genre}": plan copy never names a music genre or uses slang tied to a community. The music is the city's most-played artists, by key.`);
  const volume = text.match(VOLUME_FRAMING);
  if (volume) issues.push(`"${volume[0]}": the playlist is an ingredient, not a volume pitch. Say what plays, never how far it carries.`);
  const offer = withoutOffers(text, ctx).match(OFFER_LANGUAGE);
  if (offer) {
    const list = ctx.offers.length ? ctx.offers.map((o) => `"${o}"`).join(", ") : "none were given";
    issues.push(`"${offer[0]}": prices and deals come only from the manager's offers, quoted exactly (${list}). Never invent or reword one.`);
  }
  for (const id of refsIn(text)) if (!ctx.known.has(id)) issues.push(`[[${id}]] is not an artist or place Qloo returned for this store.`);
  return issues;
}

export interface GuardedItem {
  kind: ItemKind;
  text: string;
  origin: "qloo" | "interpreted" | "creative" | "yours";
  refs: readonly string[];
  evidenceIds: readonly string[];
}

/** A giveaway that asks for something first: giveaways are free to enter, no purchase needed. */
export const PURCHASE_TO_ENTER = /\b(with (any |a |every |your )?(purchase|activation|new line|switch|upgrade)|purchase (required|necessary)|must (buy|sign up|switch|activate|port)|(buy|switch|activate|sign up|port in)\w* (to|and) (win|enter|get a (chance|ticket|entry)))\b/i;

/** Problems with one plan line: its text, plus its origin against its receipts. */
export function itemIssues(item: GuardedItem, ctx: GuardContext): string[] {
  const issues = textIssues(item.text, ctx);
  const purchase = item.kind === "giveaway" || item.kind === "activity" ? item.text.match(PURCHASE_TO_ENTER) : null;
  if (purchase) issues.push(`"${purchase[0]}": giveaways and drawings are free to enter, no purchase or sign-up needed.`);
  if ((item.origin === "qloo" || item.origin === "interpreted") && item.evidenceIds.length === 0) {
    issues.push(`a ${item.origin} line must cite a Qloo artist, place or style; otherwise mark it creative.`);
  }
  if ((item.origin === "creative" || item.origin === "yours") && item.refs.length > 0) {
    issues.push(`a ${item.origin} line names Qloo results; mark it interpreted (or qloo) instead.`);
  }
  return issues;
}
