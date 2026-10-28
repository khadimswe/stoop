// The poster's text layer: every word on the poster, composited by code (lib/plan/poster-image.tsx) over
// the background art, so the text is always exact. The event title is the kept concept's title, with
// any "[[id]]" ref rendered from this run's Qloo results; the date and time come from the inputs; the
// store name and address are the store's own, and an event away from the store (a fair, a venue) puts
// its place first and still names the store; offers are the manager's words, verbatim (carrier promos
// included, never with terms or fine print the manager did not type), each under a short label that is
// the wheel slice's own label or the offer's first words; the store's public phone when it gave one
// (never its internal store number). Example stores are fictional and say so. No carrier logo is ever
// drawn: a real store adds its official assets itself. Artists are never named on a poster.
// A plain module (no server imports), so the UI can show the same lines as text.
import { PLAN_EXAMPLES, planExampleSlug } from "./example-list";
import { renderRefs } from "./refs";
import type { PlanReport, Store } from "./schema";

export interface PosterText {
  /** The event title. */
  title: string;
  /** "Saturday, November 7" */
  date: string;
  /** "12 to 4 pm" */
  time: string;
  store: string;
  address: string;
  /** The store's public phone, when it gave one. The internal store number never prints. */
  phone: string | null;
  /** Where the event is when it is not at the store (inputs.location), else null. */
  location: string | null;
  /** The manager's offers, verbatim, in the order typed. */
  offers: string[];
  /** One card per offer: a short label (the wheel slice's, else the offer's first words) over the offer verbatim. */
  deals: Deal[];
  /** When the plan has a prize wheel: one line saying so (never what a slice pays out). */
  wheel: string | null;
  /** What the wheel carries, for the poster's badge ("Store deals and free gift cards"), or null. */
  wheelWhat: string | null;
  /** The carrier, for the poster's palette only (colors, never a logo). */
  carrier: Store["carrier"];
  /** Example stores only: they are fictional and not affiliated with the carrier. */
  disclaimer: string | null;
}

/**
 * The prize wheel's one line, from what its slices are: deals when it carries the store's promos, free
 * gift cards when it carries gift-card slices. Spinning is always free and needs no purchase.
 */
export function wheelLine(plan: Pick<NonNullable<PlanReport["plan"]>, "wheel"> | null): string | null {
  const what = wheelWhat(plan);
  return what ? `Spin the prize wheel: ${what}. Free to spin, no purchase needed.` : null;
}

/** What the wheel carries, in lower case, or null without a wheel. */
export function wheelWhat(plan: Pick<NonNullable<PlanReport["plan"]>, "wheel"> | null): string | null {
  const slices = plan?.wheel?.slices;
  if (!slices?.length) return null;
  const deals = slices.some((s) => s.kind === "promo");
  const cards = slices.some((s) => s.kind === "gift_card");
  return deals && cards ? "store deals and free gift cards" : deals ? "store deals" : cards ? "free gift cards" : "small treats from the table";
}

export interface Deal {
  /** Short, made only of the offer's own words. */
  label: string;
  /** The offer, verbatim. */
  text: string;
}

const LABEL_MAX = 22;
const TRAILING = /^(?:a|an|and|any|at|for|if|in|of|on|or|the|to|when|with|your|you)$/i;

/**
 * An offer's card label: the wheel slice's own label when a promo slice quotes this offer, else the
 * offer's first words (up to 4, about 22 characters), never ending on a small joining word. Either way
 * the label is the manager's words; the full offer always prints under it.
 */
export function dealLabel(offer: string, slices: readonly { kind: string; label: string; text: string }[] = []): string {
  const slice = slices.find((s) => s.kind === "promo" && s.text.trim() === offer.trim());
  if (slice?.label.trim()) return slice.label.trim();
  const words = offer.trim().split(/\s+/);
  const picked: string[] = [];
  for (const word of words) {
    const next = [...picked, word].join(" ");
    if (picked.length === 4 || (picked.length > 0 && next.length > LABEL_MAX)) break;
    picked.push(word);
  }
  const clean = picked.map((w) => w.replace(/[,;:.!(]+$/, ""));
  while (clean.length > 1 && TRAILING.test(clean[clean.length - 1]!)) clean.pop();
  return clean.join(" ").slice(0, 40) || offer.slice(0, LABEL_MAX);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "Saturday, November 7" from "2026-11-07", read as a calendar day (no time zone can shift it). */
export function eventDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[day.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

const clock = (minutes: number) => {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return { text: `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}`, period: h < 12 ? "am" : "pm" };
};

/** "12 to 4 pm", "11 am to 1 pm", "6:30 to 9 pm": the start time plus the duration. */
export function eventTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(":").map(Number) as [number, number];
  const start = clock(h * 60 + m);
  const end = clock(h * 60 + m + durationMinutes);
  return start.period === end.period ? `${start.text} to ${end.text} ${end.period}` : `${start.text} ${start.period} to ${end.text} ${end.period}`;
}

const CARRIER_NOTES: Record<Store["carrier"], string> = {
  metro: "Fictional store. Not affiliated with T-Mobile.",
  cricket: "Fictional store. Not affiliated with Cricket Wireless or AT&T.",
  boost: "Fictional store. Not affiliated with Boost Mobile.",
  other: "Fictional store. Not affiliated with any carrier.",
};

/**
 * Whether a plan is one of the fictional example stores. An example list entry marked `real: true` (a
 * real dealer who agreed to be shown) is not fictional and gets no such line: a real store adds its
 * own official assets.
 */
export function fictionalExample(meta: Pick<PlanReport["meta"], "kind" | "id">): boolean {
  if (meta.kind !== "example") return false;
  const slug = planExampleSlug(meta.id);
  const entry = PLAN_EXAMPLES.find((e) => e.slug === slug);
  return !(entry && "real" in entry && entry.real === true);
}

/** Plan text with its refs rendered for a poster: places by name, artists as "local music" (a poster never names a person). */
export function posterRefs(text: string, report: Pick<PlanReport, "local">): string {
  const names = new Map<string, string>();
  for (const place of report.local.block?.places ?? []) names.set(place.id, place.name);
  for (const artist of report.local.city?.artists ?? []) names.set(artist.id, "local music");
  return renderRefs(text, names);
}

/** The names of every artist and place this run measured, by id, for rendering refs. */
export function refNames(report: Pick<PlanReport, "local">): Map<string, string> {
  const names = new Map<string, string>();
  for (const artist of report.local.city?.artists ?? []) names.set(artist.id, artist.name);
  for (const place of report.local.block?.places ?? []) names.set(place.id, place.name);
  return names;
}

/** The kept concept, or null before the plan exists. */
export function keptConcept(report: Pick<PlanReport, "plan">) {
  const plan = report.plan;
  return plan ? (plan.concepts.find((c) => c.id === plan.conceptId) ?? plan.concepts.find((c) => c.kept) ?? null) : null;
}

/**
 * The concept an A/B test's variant B runs, when it is one of this plan's concepts (a generic or usual
 * variant B has no concept of its own to market).
 */
export function variantBConcept(report: Pick<PlanReport, "plan" | "test">): string | null {
  const b = report.test?.variants.find((v) => v.id === "b");
  return b?.source === "concept" && b.conceptId && report.plan?.concepts.some((c) => c.id === b.conceptId) ? b.conceptId : null;
}

/**
 * The same report with another of its concepts in front, so the poster and posts builders (which read
 * the kept concept) write variant B's. Unknown ids leave the report as it is.
 */
export function withFrontConcept<T extends Pick<PlanReport, "plan">>(report: T, conceptId: string): T {
  const plan = report.plan;
  if (!plan?.concepts.some((c) => c.id === conceptId)) return report;
  return { ...report, plan: { ...plan, conceptId } };
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function posterText(report: Pick<PlanReport, "inputs" | "plan" | "local" | "meta">): PosterText {
  const { inputs } = report;
  const concept = keptConcept(report);
  const offers = inputs.offers.map((o) => o.text);
  const slices = report.plan?.wheel?.slices ?? [];
  const what = wheelWhat(report.plan);
  return {
    title: concept ? tidy(posterRefs(concept.title, report)) : `Come by ${inputs.store.name}`,
    date: eventDate(inputs.date),
    time: eventTime(inputs.startTime, inputs.durationMinutes),
    store: inputs.store.name,
    address: inputs.store.address,
    phone: inputs.store.phone?.trim() || null,
    // A place typed in lower case ("a fall community fair on ...") still reads as a heading.
    location: inputs.location?.name.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase()) || null,
    offers,
    deals: offers.map((text) => ({ label: dealLabel(text, slices), text })),
    wheel: wheelLine(report.plan),
    wheelWhat: what ? what.charAt(0).toUpperCase() + what.slice(1) : null,
    carrier: inputs.store.carrier,
    disclaimer: fictionalExample(report.meta) ? CARRIER_NOTES[inputs.store.carrier] : null,
  };
}

/** The poster's alt text: what it says, in one line. */
export function posterAlt(text: PosterText): string {
  const offers = text.offers.length ? ` Offers: ${text.offers.join("; ")}.` : "";
  const where = `${text.location ? `${text.location}, hosted by ${text.store}` : `${text.store}, ${text.address}`}${text.phone ? `, ${text.phone}` : ""}`;
  return `Event poster: ${text.title}. ${text.date}, ${text.time} at ${where}.${offers}${text.wheel ? ` ${text.wheel}` : ""}`;
}
