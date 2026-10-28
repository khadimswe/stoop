// The poster's text layer: every word on the poster, composited by code (lib/plan/poster-image.tsx) over
// the background art, so the text is always exact. The event title is the kept concept's title, with
// any "[[id]]" ref rendered from this run's Qloo results; the date and time come from the inputs; the
// store name and address are the store's own; offers are the manager's words, verbatim. Example stores
// are fictional and say so. No carrier logo is ever drawn: a real store adds its official assets itself.
// A plain module (no server imports), so the UI can show the same lines as text.
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
  /** The manager's offers, verbatim, in the order typed. */
  offers: string[];
  /** Example stores only: they are fictional and not affiliated with the carrier. */
  disclaimer: string | null;
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

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function posterText(report: Pick<PlanReport, "inputs" | "plan" | "local" | "meta">): PosterText {
  const { inputs } = report;
  const concept = keptConcept(report);
  return {
    title: concept ? tidy(renderRefs(concept.title, refNames(report))) : `Come by ${inputs.store.name}`,
    date: eventDate(inputs.date),
    time: eventTime(inputs.startTime, inputs.durationMinutes),
    store: inputs.store.name,
    address: inputs.store.address,
    offers: inputs.offers.map((o) => o.text),
    disclaimer: report.meta.kind === "example" ? CARRIER_NOTES[inputs.store.carrier] : null,
  };
}

/** The poster's alt text: what it says, in one line. */
export function posterAlt(text: PosterText): string {
  const offers = text.offers.length ? ` Offers: ${text.offers.join("; ")}.` : "";
  return `Event poster: ${text.title}. ${text.date}, ${text.time} at ${text.store}, ${text.address}.${offers}`;
}
