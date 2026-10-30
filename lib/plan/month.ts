// A month of Saturdays for one store, from one plan: four weeks, each with its own theme, so a
// store (or a district manager looking at several) never runs the same table twice in a row. Week 1
// runs the kept concept, weeks 2 and 3 the other scored concepts, and week 4 repeats whatever the
// logged results say worked (or the kept concept again). Each week rotates the city's most-loved
// artists, the block's places and the manager's promos, so every pick still has a Qloo receipt.
// Deterministic and free: no Qloo or Claude calls.
import { dayContext } from "./calendar";
import type { PlanReport } from "./schema";

export interface MonthWeek {
  date: string;
  /** "Saturday, November 7, 2026" */
  label: string;
  /** What the date means (holidays, paydays, the season). */
  notes: string[];
  /** The concept this week runs, by id, or null when the plan has none. */
  conceptId: string | null;
  title: string;
  /** Artists to lead the playlist with (ids in local.city), strongest first. */
  artistIds: string[];
  /** Places to buy from or point people to (ids in local.block). */
  placeIds: string[];
  /** The promo to lead the sign with, verbatim, or null. */
  offer: string | null;
  /** Why this week runs what it runs. */
  why: string;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The plan's day and the three Saturdays after it. */
export function saturdaysFrom(date: string, weeks = 4): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const first = addDays(date, (6 - day + 7) % 7);
  return Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
}

const rotate = <T>(list: readonly T[], start: number, count: number): T[] => (list.length === 0 ? [] : Array.from({ length: Math.min(count, list.length) }, (_, i) => list[(start + i) % list.length] as T));

export function planMonth(report: Pick<PlanReport, "inputs" | "local" | "plan" | "results">): MonthWeek[] {
  const concepts = [...(report.plan?.concepts ?? [])].sort((a, b) => Number(b.kept) - Number(a.kept) || b.total - a.total);
  const artists = report.local.city?.artists.map((a) => a.id) ?? [];
  const places = [...(report.local.block?.places ?? [])].sort((a, b) => a.rank - b.rank || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)).map((p) => p.id);
  const offers = report.inputs.offers.map((o) => o.text);
  const best = [...report.results].sort((a, b) => (b.walkIns ?? -1) - (a.walkIns ?? -1))[0];
  return saturdaysFrom(report.inputs.date).map((date, week) => {
    const day = dayContext(date);
    const repeat = week === 3;
    const concept = repeat ? concepts[0] : concepts[week] ?? concepts[0];
    return {
      date,
      label: day.label,
      notes: [...day.notes, ...day.hints],
      conceptId: concept?.id ?? null,
      title: concept?.title ?? "A table for the community",
      artistIds: rotate(artists, week * 3, 3),
      placeIds: rotate(places, week * 2, 2),
      offer: offers.length ? (offers[week % offers.length] as string) : null,
      why:
        week === 0
          ? "The kept concept, as planned."
          : repeat
            ? best
              ? `Repeat what worked: the best logged Saturday had ${best.walkIns ?? "no counted"} walk-ins.`
              : "Repeat the kept concept, or whichever week brought the most walk-ins."
            : concept && !concept.kept
              ? `The concept that scored ${concept.total}, so the community sees something new.`
              : "The kept concept again, with new artists, places and promo.",
    };
  });
}
