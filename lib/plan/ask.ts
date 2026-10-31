// "Get the OK": when the table goes away from the store (a fair, a nearby venue), two short drafts the
// manager sends first: one to the district manager (what, where, when, why there, the cost, the plan's
// link, and when the OK is needed) and one to the organizer (a polite vendor-table request, no budget).
// Plain code templates, not a model call: instant, the same every time, and nothing in them is made
// up. Names come from the plan's inputs and its Qloo results; the "why there" line quotes Qloo only
// when the event's place is one of the places Qloo returned. Nothing sends from Stoop: Copy, or an
// Email link that opens the manager's own mail app with no recipient filled in. Pure and client-safe.
import { normalizeName } from "../qloo/match";
import type { PlanInputs } from "./schema";
import { eventUrl } from "./share";
import { snackGroups } from "./view/floor";
import { CARRIER_LABELS, capitalizeFirst, distanceText, eventDate, usd } from "./view/format";
import { ordinal, type PlanView } from "./view/plan";

/** What both drafts are written from: the plan's own facts, small enough to send to the browser. */
export interface AskFacts {
  planId: string;
  storeName: string;
  /** The dealer's store number, for the district manager only. */
  storeNumber: string | null;
  /** "a Metro by T-Mobile store"; "a wireless store" for another carrier and for the fictional example stores. */
  storeKind: string;
  address: string;
  phone: string | null;
  /** Where the table goes, as the plan has it ("The Riverside Commons", "a fall community fair on Navigation Blvd"). */
  location: string;
  /** The event day, "YYYY-MM-DD", for the "Need your OK by" day. */
  date: string;
  /** "Saturday, Nov 21" and "Sat, Nov 21". */
  dateText: string;
  dateShort: string;
  /** "11 am to 4 pm". */
  timeText: string;
  /** The kept concept's title. */
  title: string;
  /** "0.1 mi from the store", when the place is not at the door. */
  fromStore: string | null;
  /** Qloo's own read of the place, when the event's place is one Qloo returned. */
  whyThere: { line: string; receipt: string | null } | null;
  /** "about $50 of a $50 budget". */
  cost: string;
  /** "a playlist of artists Qloo ranks for Houston", when Qloo measured the city. */
  music: string | null;
  /** "chips and warm queso from The Corner Cantina on Main". */
  snacks: string[];
  /** The plan has a prize game at the table (its prize wheel): free, no purchase needed. */
  game: boolean;
}

export interface AskDraft {
  /** "To your district manager", "To the organizer". */
  to: string;
  subject: string;
  body: string;
}

export interface AskDrafts {
  manager: AskDraft;
  organizer: AskDraft;
}

const AWAY: readonly PlanInputs["setting"][] = ["community_event", "nearby_venue"];
/** Closer than this, the place is at the store's door: no "from the store" distance. */
const AT_THE_DOOR_M = 30;
const REF = /\[\[([A-Za-z0-9-]+)\]\]/g;

/** "the riverside commons" and "Riverside Commons" match; so do "Rosa's" and "Rosas". */
export const placeKey = (name: string): string => normalizeName(name).replace(/^the /, "");

function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Built from its code point, so this file never holds the character itself. */
const LONG_DASH = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, "g");
const CURLY_SINGLE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, "g");
const CURLY_DOUBLE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d)}]`, "g");

/** Third-party text in an email, kept to the house rules: no long dash, straight quotes. */
const tidy = (text: string): string => text.replace(LONG_DASH, ", ").replace(CURLY_SINGLE, "'").replace(CURLY_DOUBLE, '"').replace(/\s+/g, " ").trim();

/** A shopping item's first clause, lowercased when it starts with a plain word ("Hot wings" to "hot wings"). */
function itemWords(item: string, names: readonly string[]): string {
  const first = item.split(",")[0]!.trim();
  if (names.some((n) => first.startsWith(n))) return first;
  return /^[A-Z][a-z]+\b/.test(first) ? first.charAt(0).toLowerCase() + first.slice(1) : first;
}

/**
 * The facts both drafts need, or null when the plan stays at the store (no "Get the OK" card) or has
 * no plan yet. `inputs` are the plan's own inputs; everything else is read from its view.
 */
export function askFacts(view: PlanView, inputs: PlanInputs): AskFacts | null {
  const location = inputs.location;
  if (!AWAY.includes(inputs.setting) || !location || !view.concept) return null;
  const places = view.local.block?.places ?? [];
  const artists = view.local.city?.artists ?? [];
  const nameOf = new Map<string, string>([...places.map((p) => [p.id, p.name] as const), ...artists.map((a) => [a.id, a.name] as const)]);

  const key = placeKey(location.name);
  const match = places.find((p) => placeKey(p.name) === key);
  const block = view.local.block;
  const whyThere = match
    ? {
        line: [
          `Qloo ranks it ${ordinal(match.rank)} among the ${match.search ?? "places"} it found${block ? ` within ${block.radiusText} of ${block.from}` : ""}.`,
          match.why ? `In Qloo's words: "${tidy(match.why).replace(/"/g, "'")}"` : null,
        ]
          .filter(Boolean)
          .join(" "),
        receipt: match.receipt,
      }
    : null;

  const away = metersBetween(inputs.store.point, location.point);
  const placeNames = places.map((p) => p.name);
  const snacks = snackGroups(view)
    .filter((g) => g.place)
    .slice(0, 2)
    .map((g) => `${g.items.slice(0, 2).map((s) => itemWords(s.item, placeNames)).join(" and ")} from ${g.place!.name}`);
  const spent = view.shoppingTotal;
  const budget = usd(inputs.budgetUsd);

  return {
    planId: view.id,
    storeName: inputs.store.name,
    storeNumber: inputs.store.storeNumber ?? null,
    // An example store is fictional: its copied drafts never name a carrier, so they can't read as the carrier's.
    storeKind: inputs.store.carrier === "other" || view.kind === "example" ? "a wireless store" : `a ${CARRIER_LABELS[inputs.store.carrier]} store`,
    address: view.header.address,
    phone: inputs.store.phone ?? null,
    location: tidy(location.name),
    date: inputs.date,
    dateText: view.header.dateText,
    dateShort: view.header.dateShort,
    timeText: view.header.timeText,
    title: tidy(view.concept.title.replace(REF, (_, id: string) => nameOf.get(id) ?? "a local spot")),
    fromStore: away >= AT_THE_DOOR_M ? `${distanceText(away)} from the store` : null,
    whyThere,
    cost: spent ? `about ${spent} of a ${budget} budget` : `a ${budget} budget`,
    music: view.local.city && artists.length > 0 ? `a playlist of artists Qloo ranks for ${view.local.city.name}` : null,
    snacks,
    game: view.wheel !== null,
  };
}

/** The day a week before the event, "YYYY-MM-DD". */
export function weekBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** "by Saturday, Nov 14", or "as soon as you can" once that day has passed (`today` is "YYYY-MM-DD"). */
export function okBy(isoDate: string, today: string | null): string {
  const by = weekBefore(isoDate);
  return today && by < today ? "as soon as you can" : `by ${eventDate(by)}`;
}

/** "a fall community fair on Navigation Blvd" inside a sentence; "The Riverside Commons" reads "the Riverside Commons". */
const inSentence = (place: string) => (/^(A|An|The) /.test(place) ? place.charAt(0).toLowerCase() + place.slice(1) : place);

/**
 * Both drafts, from the plan's facts. `origin` is the page's own origin (the plan's link is its public
 * event page); `today` is the manager's local day, or null before the browser knows it.
 */
export function askDrafts(facts: AskFacts, { origin, today }: { origin: string; today: string | null }): AskDrafts {
  const place = capitalizeFirst(facts.location);
  const at = inSentence(facts.location);
  const when = `${facts.dateText}, ${facts.timeText}`;
  // Only what the plan has: no line promises a game, music or snacks it doesn't.
  const table = [facts.music, ...facts.snacks, facts.game ? "a free prize game, no purchase needed" : null].filter((x): x is string => Boolean(x));
  const brief = [facts.game ? "a free prize game (no purchase needed)" : null, facts.music ? "music" : null, facts.snacks.length ? "food" : null].filter((x): x is string => Boolean(x));
  const briefLine = brief.length > 1 ? `${brief.slice(0, -1).join(", ")} and ${brief.at(-1)}` : (brief[0] ?? null);
  const manager = [
    "Hi,",
    "",
    `I'd like to take our table to ${at} on ${when}. Here is the plan.`,
    "",
    `What: our table, "${facts.title}"`,
    `Where: ${place}${facts.fromStore ? `, ${facts.fromStore}` : ""}`,
    `When: ${when}`,
    ...(facts.whyThere ? [`Why there: ${facts.whyThere.line}`] : []),
    `Cost: ${facts.cost}`,
    ...(table.length ? [`At the table: ${table.join("; ")}.`] : []),
    `The plan: ${eventUrl(origin, facts.planId)}`,
    "",
    `Need your OK ${okBy(facts.date, today)}.`,
    "",
    "Thanks,",
    facts.storeNumber ? `${facts.storeName} (${facts.storeNumber})` : facts.storeName,
  ].join("\n");
  const organizer = [
    "Hello,",
    "",
    `I'm writing from ${facts.storeName}, ${facts.storeKind} at ${facts.address}.`,
    "",
    `May we have a small table at ${at} on ${when}?`,
    "",
    ...(briefLine ? [`At the table: ${briefLine}.`] : []),
    "We bring our own table, about 6 feet, and clean up after.",
    "",
    "A few questions:",
    "- Is there space for a table?",
    "- Is there a vendor fee?",
    "- Do you need insurance or a permit from us?",
    "",
    ...(facts.phone ? [`You can reach the store at ${facts.phone}.`, ""] : []),
    "Thank you,",
    facts.storeName,
  ].join("\n");
  return {
    manager: { to: "To your district manager", subject: `Table request: ${place}, ${facts.dateShort}`, body: manager },
    organizer: { to: "To the organizer", subject: `Vendor table request: ${place}, ${facts.dateShort}`, body: organizer },
  };
}

/** A mailto: link with the subject and body filled in and no recipient: the manager picks who it goes to. */
export function mailtoHref(draft: Pick<AskDraft, "subject" | "body">): string {
  return `mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body.replace(/\r?\n/g, "\r\n"))}`;
}
