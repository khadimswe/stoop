// The reminder posts: one short caption per scheduled time (the evening before, the morning of, an hour
// before), each its own words, written by code from the plan's inputs only. No model writes them and
// nothing is invented: the day and time, where (the store and its address, or the event's place), the
// prize wheel's own line when the plan has a wheel, and the manager's offers word for word, as many as
// fit, then the store's phone when it gave one and an example store's fictional line. The announcement
// is the plan's own approved draft (lib/plan/posts.ts); these follow it. The same captions are copied
// in the share timeline and posted from Stoop, where the posts guard checks them once more
// (lib/social/posts-guard.ts checkReminder). A plain module: the screens import it.
import { gameOf } from "../plan/game";
import { disclaimerFor, eventTime, wheelLineOf } from "../plan/poster-text";
import type { PlanInputs, PlanReport } from "../plan/schema";
import type { PostTimeId } from "./schedule";

/** Everything a reminder may say, from the inputs and the wheel's slice kinds. */
export interface ReminderFacts {
  setting: PlanInputs["setting"];
  store: string;
  address: string;
  /** The event's place when it is not at the store. */
  location: string | null;
  phone: string | null;
  /** "12 to 4 pm" */
  time: string;
  /** "12 pm", "10:30 am" */
  start: string;
  wheel: string | null;
  offers: string[];
  disclaimer: string | null;
}

const startClock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};

/** A plan's reminder facts. `wheelKinds` are the kinds of its wheel's slices (null without a wheel); `meta` says whether it is an example store. */
export function reminderFacts(inputs: PlanInputs, wheelKinds: readonly string[] | null, meta: Pick<PlanReport["meta"], "kind" | "id">): ReminderFacts {
  return {
    setting: inputs.setting,
    store: inputs.store.name.trim(),
    address: inputs.store.address.trim(),
    location: inputs.location?.name.trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase()) || null,
    phone: inputs.store.phone?.trim() || null,
    time: eventTime(inputs.startTime, inputs.durationMinutes),
    start: startClock(inputs.startTime),
    wheel: wheelLineOf(wheelKinds, gameOf(inputs)),
    offers: inputs.offers.map((o) => o.text),
    disclaimer: disclaimerFor(meta, inputs.store.carrier),
  };
}

/** From a whole report (the server's view of a plan). */
export function reportReminderFacts(report: Pick<PlanReport, "inputs" | "plan" | "meta">): ReminderFacts {
  return reminderFacts(report.inputs, report.plan?.wheel?.slices.map((s) => s.kind) ?? null, report.meta);
}

/** The place mid-sentence: "a fall fair on Navigation Blvd", not "A fall fair". */
const inline = (place: string) => place.replace(/^(A|An|The)\s/, (word) => word.toLowerCase());

/** Where the table is, as the opening says it: no address (that is its own line). */
function wherePhrase(f: ReminderFacts): string {
  const location = f.location ? inline(f.location) : null;
  switch (f.setting) {
    case "sidewalk_table":
      return "our table is out front";
    case "in_store":
      return "come find us inside the store";
    case "nearby_venue":
      return location ? `we're at ${location}` : "we're just down the street";
    case "community_event":
      return location ? `our booth is at ${location}` : "our booth is at the community event";
  }
}

/** The one sentence each reminder opens with: the only line that is not a plain fact line. */
export function reminderOpening(f: ReminderFacts, id: PostTimeId): string {
  const where = wherePhrase(f);
  if (id === "evening_before") return `Tomorrow, ${f.time}: ${where}.`;
  if (id === "morning_of") return `Today, ${f.time}: ${where}.`;
  return `In an hour, at ${f.start}: ${where}. Come say hi.`;
}

/** The "Where:" line: the store and its address, or the event's place and its host. */
export function reminderWhere(f: ReminderFacts): string {
  return f.location ? `Where: ${f.location}, hosted by ${f.store}` : `Where: ${f.store}, ${f.address}`;
}

/** Offers shown per reminder: all of them the evening before and that morning, one an hour before. */
const OFFERS_SHOWN: Readonly<Record<PostTimeId, number>> = { evening_before: 8, morning_of: 8, hour_before: 1 };
/** Short enough to read at a glance; every network takes far more. */
const MAX_CHARS = 700;

/** Every line of one reminder, in order. Offers are never cut mid-line: whole ones drop, and one line says how many more. */
export function reminderLines(f: ReminderFacts, id: PostTimeId): string[] {
  const head = [reminderOpening(f, id), reminderWhere(f), ...(f.wheel ? [f.wheel] : [])];
  const tail = [...(id === "evening_before" && f.phone ? [`Call or text: ${f.phone}`] : []), ...(f.disclaimer ? [f.disclaimer] : [])];
  for (let shown = Math.min(OFFERS_SHOWN[id], f.offers.length); shown >= 0; shown--) {
    const more = f.offers.length - shown;
    const lines = [...head, ...f.offers.slice(0, shown).map((o) => `Offer: ${o}`), ...(more > 0 ? [`${more} more ${more === 1 ? "offer" : "offers"} at the table.`] : []), ...tail];
    if (lines.join("\n").length <= MAX_CHARS || shown === 0) return lines;
  }
  return [...head, ...tail];
}

/** One reminder caption, as it is copied and posted. */
export function reminderCaption(f: ReminderFacts, id: PostTimeId): string {
  return reminderLines(f, id).join("\n");
}
