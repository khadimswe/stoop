// Small formatters for the store-events pages. Pure and client-safe, with a fixed locale and time
// zone, so the server and the browser print the same text.
import type { AgeBucket } from "../../qloo/constants";
import { ageBandLabel } from "../../types";
import type { CARRIERS, ITEM_KINDS, PLACE_KINDS, PLAN_STAGES, SETTINGS } from "../schema";

type Carrier = (typeof CARRIERS)[number];
type Setting = (typeof SETTINGS)[number];
type ItemKind = (typeof ITEM_KINDS)[number];
type PlaceKind = (typeof PLACE_KINDS)[number];
type PlanStage = (typeof PLAN_STAGES)[number];

/** The carrier in words. Stoop names it in text and never draws its logo. */
export const CARRIER_LABELS: Readonly<Record<Carrier, string>> = {
  metro: "Metro by T-Mobile",
  cricket: "Cricket Wireless",
  boost: "Boost Mobile",
  other: "Wireless store",
};

/** Who an example store must say it is not affiliated with. */
const CARRIER_OWNERS: Readonly<Record<Carrier, string>> = {
  metro: "T-Mobile",
  cricket: "Cricket Wireless or AT&T",
  boost: "Boost Mobile",
  other: "any carrier",
};

/** "Fictional store. Not affiliated with or endorsed by T-Mobile." on every example store. */
export function fictionalNotice(carrier: Carrier): string {
  return `Fictional store. Not affiliated with or endorsed by ${CARRIER_OWNERS[carrier]}.`;
}

export const SETTING_LABELS: Readonly<Record<Setting, string>> = {
  sidewalk_table: "Sidewalk table",
  in_store: "In the store",
  nearby_venue: "At a nearby venue",
  community_event: "A fair or community event",
};

/** Settings that happen away from the store, so the form asks where. */
export const AWAY_SETTINGS: readonly Setting[] = ["nearby_venue", "community_event"];

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  theme: "Theme",
  music: "Playlist",
  food: "Food",
  partner: "Partner",
  venue: "Venue",
  giveaway: "Giveaway",
  activity: "Activity",
  setup: "Setup",
  signage: "Signage",
  timing: "Timing",
};

/** A place's kind in plain words, singular. */
export const PLACE_KIND_LABELS: Readonly<Record<PlaceKind, string>> = {
  food: "Food spot",
  venue: "Venue",
  park: "Park",
  shop: "Shop",
  other: "Place",
};

/** Each stage as the trace and the progress rail name it. */
export const PLAN_STAGE_LABELS: Readonly<Record<PlanStage, string>> = {
  store: "The store",
  city: "City playlist",
  block: "The community",
  concepts: "Event concepts",
  plan: "The plan",
  baseline: "Generic AI plan",
  marketing: "Poster and posts",
};

const WEEKDAY_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Saturday, Nov 1" from an ISO date ("2026-11-01"), read as the store's local calendar day. */
export function eventDate(isoDate: string, style: "long" | "short" = "long"): string {
  const day = new Date(`${isoDate}T12:00:00Z`);
  return (style === "long" ? WEEKDAY_DATE : SHORT_DATE).format(day);
}

/** "Oct 28, 2026" from an ISO timestamp. */
export function stampDate(iso: string): string {
  return STAMP.format(new Date(iso));
}

function clock(minutes: number): { text: string; meridiem: "am" | "pm" } {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: min === 0 ? String(h12) : `${h12}:${String(min).padStart(2, "0")}`, meridiem: h24 < 12 ? "am" : "pm" };
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "2 pm" or "11:30 am" from "14:00" or "11:30". */
export function timeOfDay(hhmm: string): string {
  const { text, meridiem } = clock(minutesOf(hhmm));
  return `${text} ${meridiem}`;
}

/** "12 to 4 pm", "11:30 am to 2 pm": the meridiem once when both ends share it. */
export function timeRange(startHhmm: string, durationMinutes: number): string {
  const start = clock(minutesOf(startHhmm));
  const end = clock(minutesOf(startHhmm) + durationMinutes);
  return start.meridiem === end.meridiem ? `${start.text} to ${end.text} ${end.meridiem}` : `${start.text} ${start.meridiem} to ${end.text} ${end.meridiem}`;
}

/** "$150" (whole dollars), "$0" included. */
export function usd(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** "350 m" under a kilometer, else "1.2 km". */
export function distanceText(meters: number): string {
  // US managers read feet and miles: "300 ft" under a tenth of a mile, then "0.3 mi", "1.2 mi".
  const miles = meters / M_PER_MI;
  if (miles < 0.1) return `${Math.max(50, Math.round((meters * FT_PER_M) / 50) * 50)} ft`;
  return miles < 10 ? `${(Math.round(miles * 10) / 10).toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;

/** A search radius in plain words: 1.5 km is "about 1 mile", 1609 m is "1 mile", 4 km "about 2.5 miles". */
export function radiusText(meters: number): string {
  const miles = meters / M_PER_MI;
  const half = Math.max(0.5, Math.round(miles * 2) / 2);
  const words = half === 1 ? "1 mile" : `${half} miles`;
  return Math.abs(half - miles) < 0.02 ? words : `about ${words}`;
}

/**
 * Recorded lines (the trace, the comparison) were written in meters; on screen they read in US units:
 * "440 m" becomes "0.3 mi", "1.5 km" becomes "about 1 mile".
 */
export function usUnits(text: string): string {
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s?km\b/g, (_, n: string) => {
      const m = Number(n) * 1000;
      return m % 500 === 0 ? radiusText(m) : distanceText(m);
    })
    .replace(/\b(\d+)\s?m\b/g, (_, n: string) => distanceText(Number(n)));
}

/** Names as Qloo has them, minus invisible emoji variation selectors ("The Right Greens️"). */
export function cleanName(name: string): string {
  return name.replace(/[︎️‍]/g, "").trim();
}

/** "18 to 24, 25 to 29 and 30 to 34": adult bands only, the youngest always "18 to 24". */
export function ageBandsText(bands: readonly AgeBucket[]): string {
  const labels = bands.map(ageBandLabel);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** "1 store" or "3 stores". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A fall community fair on Navigation Blvd": a place typed in lower case, shown with a capital, as the poster does. */
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
