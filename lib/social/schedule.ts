// The scheduling agent: deterministic times to post a plan's poster, in the store's own time zone. No
// model and no data beyond the plan's inputs (the event's date, start time and the store's state), so
// the same plan always gets the same suggestions. Three moments: the evening before, the morning of,
// and an hour before the table opens. Each is offered only when Meta can still schedule it (at least
// 10 minutes ahead, at most 30 days) and it falls before the event starts. A plain module: the UI
// imports it to offer one-tap "Schedule".
import type { PlanReport } from "../plan/schema";

/** A scheduled Page post must be at least this far ahead when the request is made (Meta's rule). */
export const SCHEDULE_MIN_MS = 10 * 60_000;
/**
 * And at most this far. Meta's docs disagree (the Page feed reference says 75 days, the Pages API guide
 * 30; see lib/social/meta.ts), so Stoop keeps to the stricter 30 and Meta never refuses a time it offered.
 */
export const SCHEDULE_MAX_MS = 30 * 24 * 60 * 60_000;
/** Suggestions keep a margin past Meta's 10 minutes, so a tap a few minutes later still schedules. */
export const SUGGESTION_MARGIN_MS = 15 * 60_000;

/** The main time zone of each US state, district and territory, by postal code. A split state takes its most populous zone. */
const STATE_ZONES: Readonly<Record<string, string>> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver", PR: "America/Puerto_Rico", GU: "Pacific/Guam", VI: "America/St_Thomas",
};

const STATE_NAMES: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", guam: "GU",
};

type Store = PlanReport["inputs"]["store"];

/**
 * The store's time zone: from its state (postal code or name), else from its longitude (the four
 * mainland zones' rough bands), so a store outside the table still gets a sensible local day.
 */
export function storeTimeZone(store: Pick<Store, "region" | "point">): string {
  const region = store.region.trim();
  const code = region.length === 2 ? region.toUpperCase() : STATE_NAMES[region.toLowerCase()];
  const zone = code ? STATE_ZONES[code] : undefined;
  if (zone) return zone;
  const lon = store.point.lon;
  if (lon >= -87) return "America/New_York";
  if (lon >= -101) return "America/Chicago";
  if (lon >= -114.5) return "America/Denver";
  return "America/Los_Angeles";
}

const PARTS = new Map<string, Intl.DateTimeFormat>();
function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = PARTS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    PARTS.set(timeZone, format);
  }
  return format;
}

/** How far the zone's wall clock is ahead of UTC at an instant, in ms. */
function offsetMs(timeZone: string, at: number): number {
  const parts = partsFormat(timeZone).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The instant a wall-clock time ("2026-11-07", 720 minutes after midnight) happens in a time zone. */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const first = wall - offsetMs(timeZone, wall);
  // Once more at the first guess, so a day that changes the clocks lands on the right side.
  return new Date(wall - offsetMs(timeZone, first));
}

const tidy = (text: string) => text.replace(/[  ]/g, " ").replace(/\bAM\b/g, "am").replace(/\bPM\b/g, "pm");

/** "7:02 pm" in the store's time zone. */
export function localClock(at: Date, timeZone: string): string {
  return tidy(at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }));
}

/** "Thu, Oct 29" in the store's time zone. */
export function localDay(at: Date, timeZone: string): string {
  return tidy(at.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }));
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** When the event starts, as an instant. */
export function eventStart(report: Pick<PlanReport, "inputs">): Date {
  const { inputs } = report;
  return zonedInstant(inputs.date, minutesOf(inputs.startTime), storeTimeZone(inputs.store));
}

export const POST_TIME_IDS = ["evening_before", "morning_of", "hour_before"] as const;
export type PostTimeId = (typeof POST_TIME_IDS)[number];

export interface PostTime {
  id: PostTimeId;
  /** The instant, ISO with Z, as the post route takes it. */
  at: string;
  /** "Evening before" */
  name: string;
  /** "Fri, Nov 6, 7:00 pm", in the store's time zone. */
  label: string;
}

const NAMES: Readonly<Record<PostTimeId, string>> = { evening_before: "Evening before", morning_of: "Morning of", hour_before: "An hour before" };
/** The morning post is offered only when the table opens at least this long after it. */
const MORNING_LEAD_MINUTES = 90;

/**
 * Two or three times to post, in the store's local day: the evening before (7 pm), the morning of
 * (9 am, when the table opens after 10:30) and an hour before the start. Times Meta could no longer
 * schedule, or that fall after the start, are left out, so a plan for today may get fewer or none.
 */
export function suggestPostTimes(report: Pick<PlanReport, "inputs">, now: number = Date.now()): PostTime[] {
  const { inputs } = report;
  const zone = storeTimeZone(inputs.store);
  const start = minutesOf(inputs.startTime);
  const startAt = eventStart(report).getTime();
  const dayBefore = new Date(Date.parse(`${inputs.date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const candidates: { id: PostTimeId; at: Date }[] = [
    { id: "evening_before", at: zonedInstant(dayBefore, 19 * 60, zone) },
    ...(start - 9 * 60 >= MORNING_LEAD_MINUTES ? [{ id: "morning_of" as const, at: zonedInstant(inputs.date, 9 * 60, zone) }] : []),
    { id: "hour_before", at: new Date(startAt - 60 * 60_000) },
  ];
  return candidates
    .filter(({ at }) => at.getTime() - now >= SUGGESTION_MARGIN_MS && at.getTime() - now <= SCHEDULE_MAX_MS && at.getTime() < startAt)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ id, at }) => ({ id, at: at.toISOString(), name: NAMES[id], label: `${localDay(at, zone)}, ${localClock(at, zone)}` }));
}
