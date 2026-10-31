// The landing's "Same table. Different community." tabs and the posting times, built from an example
// store's recorded plan. Pure: every name and number comes from the plan view (lib/plan/view/plan.ts,
// names from the run's own Qloo results). Nothing is invented; a line with nothing behind it is left out.
import type { ReceiptView } from "../report/view/types";
import type { PlanReport } from "../plan/schema";
import { playView } from "../plan/view/floor";
import { exampleHrefs } from "../plan/view/hrefs";
import type { PlaceView, PlanView } from "../plan/view/plan";
import { ageSpan, listOf, usDistance, usRadius } from "./plain-words";

export { ageSpan, listOf } from "./plain-words";

/** A run of the verdict sentence: plain words, or a Qloo pick (underlined) that opens its receipt. */
export type VerdictPart = { kind: "text"; text: string } | { kind: "pick"; text: string; receipt: string | null; href: string };

export interface MapPin {
  id: string;
  n: number;
  name: string;
  point: { lat: number; lon: number } | null;
  distanceM: number | null;
  used: boolean;
}

export interface StoreShowcase {
  slug: string;
  storeName: string;
  city: string;
  title: string;
  verdict: VerdictPart[];
  /** "$49 of a $50 budget", "Free to play, no purchase needed" (and the venue, when there is one). */
  meta: string[];
  map: {
    center: { lat: number; lon: number; label: string };
    radiusM: number;
    radiusText: string;
    pins: MapPin[];
    /** "24 places from Qloo, within about 1 mile". */
    chip: string;
    label: string;
  } | null;
  /** The three picks as cards: Music, Food and Prize game, each with its receipt. */
  picks: PickRow[];
  hrefs: { event: string; block: string; poster: string; promote: string };
  fictional: string | null;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const placeByPin = (view: PlanView, n: number): PlaceView | undefined => view.local.block?.places.find((p) => p.n === n);

/** Where a place's name goes without JavaScript: its row on the store's community page. */
const placeHref = (view: PlanView, slug: string, p: PlaceView | undefined) => (p ? `${exampleHrefs(slug).block}#place-${p.id}` : exampleHrefs(slug).block);

/** The snack the plan buys from a community spot, with that spot. */
function snackPick(view: PlanView) {
  const snack = view.shopping.find((s) => !s.prize && s.from);
  if (!snack?.from) return null;
  return { item: snack.item.split(",")[0]!.trim(), from: snack.from, place: placeByPin(view, snack.from.n) };
}

/** The community spots the prizes come from: the wheel's gift-card slices, else the prize shopping. */
function prizePlaces(view: PlanView): PlaceView[] {
  const wheel = (view.wheel?.slices ?? []).flatMap((s) => (s.kind === "gift_card" && s.place ? [s.place.n] : []));
  const pins = wheel.length ? wheel : view.shopping.flatMap((s) => (s.prize && s.from ? [s.from.n] : []));
  return [...new Set(pins)].flatMap((n) => {
    const p = placeByPin(view, n);
    return p ? [p] : [];
  });
}

/**
 * The verdict: the event's title, then one sentence of its Qloo-backed picks, each name a link to
 * its receipt: the snack spot, the city's playlist, the gift cards.
 */
export function verdictParts(view: PlanView, slug: string, receipts: Readonly<Record<string, ReceiptView>> = view.receipts): VerdictPart[] {
  const title = view.concept?.title ?? view.header.storeName;
  const has = (key: string | null) => (key && receipts[key] ? key : null);
  const phrases: VerdictPart[][] = [];
  const snack = snackPick(view);
  if (snack) {
    phrases.push([
      { kind: "text", text: `${lowerFirst(snack.item)} from ` },
      { kind: "pick", text: snack.from.name, receipt: has(snack.from.receipt), href: placeHref(view, slug, snack.place) },
      ...(snack.place?.distanceM != null ? [{ kind: "text" as const, text: `, ${usDistance(snack.place.distanceM)} away` }] : []),
    ]);
  }
  const city = view.local.city;
  const play = playView(view);
  if (city && play.artists.length) {
    phrases.push([
      { kind: "text", text: "a playlist of artists " },
      { kind: "pick", text: `Qloo ranks for ${city.name}`, receipt: has(play.receipt), href: `${exampleHrefs(slug).event}#receipt-play` },
    ]);
  }
  const cards = prizePlaces(view);
  if (cards.length) {
    if (snack && cards.length === 1 && cards[0]!.n === snack.from.n) phrases.push([{ kind: "text", text: "gift cards to the same spot on the prize wheel" }]);
    else {
      const parts: VerdictPart[] = [{ kind: "text", text: "gift cards to " }];
      cards.forEach((p, i) => {
        if (i > 0) parts.push({ kind: "text", text: i === cards.length - 1 ? " and " : ", " });
        parts.push({ kind: "pick", text: p.name, receipt: has(p.receipt), href: placeHref(view, slug, p) });
      });
      phrases.push(parts);
    }
  }
  if (!phrases.length) return [{ kind: "text", text: `${title}.` }];
  const out: VerdictPart[] = [{ kind: "text", text: title.includes(":") ? `${title}. ` : `${title}: ` }];
  phrases.forEach((phrase, i) => {
    if (i > 0) out.push({ kind: "text", text: i === phrases.length - 1 ? (phrases.length > 2 ? ", and " : " and ") : ", " });
    // After a full stop, the sentence starts with a capital.
    if (i === 0 && title.includes(":") && phrase[0]?.kind === "text") out.push({ ...phrase[0], text: upperFirst(phrase[0].text) }, ...phrase.slice(1));
    else out.push(...phrase);
  });
  out.push({ kind: "text", text: "." });
  return out;
}

/** The verdict as one line of text, for screen readers and tests. */
export const verdictText = (parts: readonly VerdictPart[]) => parts.map((p) => p.text).join("");

/** One example store's showcase, for its tab: the verdict, its budget and date, and its community map. */
export function storeShowcase(view: PlanView, slug: string, city: string): StoreShowcase {
  const hrefs = exampleHrefs(slug);
  const block = view.local.block;
  const meta = [
    view.shoppingTotal ? `${view.shoppingTotal} of a ${view.header.budgetText}` : view.header.budgetText,
    // The prize game may be a wheel or a drop board, so the landing says "play" for the recorded "spin".
    view.wheel?.rules[0]?.split(". ")[0]?.replace(/\.$/, "").replace(/^Free to spin\b/i, "Free to play") ?? null,
    view.header.venue ? `At ${lowerFirst(view.header.venue)}` : null,
  ].filter((m): m is string => Boolean(m));
  return {
    slug,
    storeName: view.header.storeName,
    city,
    title: view.concept?.title ?? view.header.storeName,
    verdict: verdictParts(view, slug),
    meta,
    map: block
      ? {
          center: block.center,
          radiusM: block.radiusM,
          radiusText: usRadius(block.radiusM),
          pins: block.places.map((p) => ({ id: p.id, n: p.n, name: p.name, point: p.point, distanceM: p.distanceM, used: Boolean(view.placeUses[p.id]) })),
          chip: `${block.places.length} places from Qloo, within ${usRadius(block.radiusM)}`,
          label: `Map of the ${block.places.length} places Qloo found within ${usRadius(block.radiusM)} of ${view.header.venue ? "the event" : view.header.storeName}. Filled pins are the ones the plan uses.`,
        }
      : null,
    hrefs: { event: hrefs.event, block: hrefs.block, poster: hrefs.poster, promote: hrefs.promote },
    picks: tablePicks(view, slug),
    fictional: view.header.fictional,
  };
}

export interface PickRow {
  title: "Music" | "Food" | "Prize game";
  value: string;
  note: string;
  receipt: string | null;
  /** Where the receipt link goes without JavaScript. */
  href: string;
}

/**
 * The table's three picks as cards, all from the recorded plan: the city's artists with Qloo's own
 * ranks, the food spot nearby with what it serves and how far, and the prize game's deals with the
 * gift card spot. A pick the plan doesn't have is left out.
 */
export function tablePicks(view: PlanView, slug: string): PickRow[] {
  const rows: PickRow[] = [];
  const from = view.header.venue ? "the event" : "the door";
  const city = view.local.city;
  const play = playView(view);
  if (city && play.artists.length) {
    const music = view.concept?.items.find((i) => i.kind === "music");
    const ranks = (music?.parts ?? []).flatMap((p) => (p.kind === "ref" ? [city.artists.find((a) => a.id === p.id)?.rank] : [])).filter((r): r is number => typeof r === "number");
    const who = ranks.length === play.artists.length ? `Qloo's ${listOf(ranks.map((r) => `#${r}`))}` : "Artists Qloo ranks";
    rows.push({ title: "Music", value: listOf(play.artists), note: `${who} for ${city.name}, adults ${ageSpan(city.ageText)}`, receipt: play.receipt, href: `${exampleHrefs(slug).event}#receipt-play` });
  }
  const food = snackPick(view);
  if (food) {
    const distance = food.place?.distanceM != null ? `, ${usDistance(food.place.distanceM)} from ${from}` : "";
    rows.push({ title: "Food", value: food.from.name, note: `${upperFirst(food.item)}${distance}`, receipt: food.from.receipt, href: placeHref(view, slug, food.place) });
  }
  if (view.wheel) {
    const promos = view.wheel.slices.filter((s) => s.kind === "promo").length;
    const cards = view.wheel.slices.filter((s) => s.kind === "gift_card");
    const gifts = cards.map((s) => lowerFirst(s.text.replace(/\.$/, "")));
    // The receipt and the link without JavaScript both point at the same gift card.
    const backed = cards.find((s) => s.receipt);
    const spot = backed?.place ? placeByPin(view, backed.place.n) : undefined;
    rows.push({
      title: "Prize game",
      value: `Your ${promos} ${promos === 1 ? "deal" : "deals"}${gifts.length ? `, plus ${listOf(gifts)}` : ""}`,
      note: spot?.distanceM != null ? `${usDistance(spot.distanceM)} from ${from}` : "From a spot nearby",
      receipt: backed?.receipt ?? null,
      href: placeHref(view, slug, spot),
    });
  }
  return rows;
}

export interface TimelinePost {
  when: string;
  title: string;
  channels: string;
  status: "now" | "scheduled" | "share";
  statusText: string;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
function clockText(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${min === 0 ? h12 : `${h12}:${String(min).padStart(2, "0")}`} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The posts Stoop lines up for an event, at the times lib/social/schedule.ts uses: the announcement,
 * then reminders the evening before (7 pm), the morning of (9 am, when the table opens 90 minutes or
 * more after it) and an hour before. In the store's calendar, from the plan's inputs alone.
 *
 * `posting` is ENABLE_META_POSTING (lib/config.ts). On, the announcement posts to Facebook and
 * Instagram at approval and Meta's scheduled publishing sends the Facebook reminders; WhatsApp stays
 * the manager's own share sheet. Off (share mode), every post is written for each channel and waits
 * for the manager to share or copy it: nothing is scheduled.
 */
export function postTimeline(inputs: Pick<PlanReport["inputs"], "date" | "startTime">, posting: boolean): TimelinePost[] {
  const day = new Date(`${inputs.date}T12:00:00Z`);
  const before = new Date(day.getTime() - 86_400_000);
  const start = minutesOf(inputs.startTime);
  const reminders = [
    { when: `${WEEKDAY.format(before)} 7 pm`, title: "Evening before" },
    ...(start - 9 * 60 >= 90 ? [{ when: `${WEEKDAY.format(day)} 9 am`, title: "Morning of" }] : []),
    { when: `${WEEKDAY.format(day)} ${clockText(start - 60)}`, title: "An hour before" },
  ];
  if (!posting) {
    return [
      { when: "Now", title: "Announce", channels: "Facebook, Instagram, WhatsApp", status: "share", statusText: "Ready to share" },
      ...reminders.map((r) => ({ ...r, channels: "Facebook, Instagram, WhatsApp", status: "share" as const, statusText: "Ready to share" })),
    ];
  }
  return [
    { when: "Now", title: "Announce", channels: "Facebook, Instagram", status: "now", statusText: "Posts on approve" },
    ...reminders.map((r) => ({ ...r, channels: "Facebook", status: "scheduled" as const, statusText: "Scheduled" })),
    { when: "Any time", title: "Your groups", channels: "WhatsApp", status: "share", statusText: "One tap" },
  ];
}

/** Only the receipts a set of keys names, so a page sends no more than it shows. */
export function pickReceipts(receipts: Readonly<Record<string, ReceiptView>>, keys: readonly (string | null | undefined)[]): Record<string, ReceiptView> {
  const out: Record<string, ReceiptView> = {};
  for (const key of keys) if (key && receipts[key]) out[key] = receipts[key];
  return out;
}
