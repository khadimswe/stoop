// Plain words the landing uses for what a plan shows: lists, age spans, distances in US units and
// Qloo's check of the generic plan's artists. Pure, with no runtime imports, so the plan view's
// landing comparison (lib/plan/view/floor.ts) and the landing's own builders share one wording.
import type { PlanView } from "../plan/view/plan";

/** "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "25 to 29 and 30 to 34" as "25 to 34" when the bands run on; else the text as it is. */
export function ageSpan(text: string): string {
  const bands = [...text.matchAll(/(\d+) to (\d+)|(\d+) and older/g)].map((m) => (m[3] ? { from: Number(m[3]), to: null } : { from: Number(m[1]), to: Number(m[2]) }));
  if (bands.length < 2) return text;
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]!;
    if (prev.to === null || bands[i]!.from !== prev.to + 1) return text;
  }
  const last = bands.at(-1)!;
  return last.to === null ? `${bands[0]!.from} and older` : `${bands[0]!.from} to ${last.to}`;
}

/** A distance in US units: feet up close ("200 ft"), else miles to a tenth ("0.3 miles", "1 mile"). */
export function usDistance(meters: number): string {
  if (meters < 152) return `${Math.max(10, Math.round((meters * 3.28084) / 10) * 10)} ft`;
  const miles = Math.round((meters / 1609.344) * 10) / 10;
  return miles === 1 ? "1 mile" : `${miles} miles`;
}

/** The community's radius in words: "about 1 mile" for Qloo's 1,500 m. */
export function usRadius(meters: number): string {
  const miles = meters / 1609.344;
  const rounded = Math.abs(miles - Math.round(miles)) < 0.15 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `about ${rounded} ${rounded === 1 ? "mile" : "miles"}`;
}

/** One of the generic plan's artists, as Qloo's scoring call read it (the trace's "Checked a generic pick" steps). */
export interface GenericPick {
  name: string;
  /** How many of Qloo's own city picks it beats; null when Qloo has no measurable affinity for it. */
  beats: number | null;
  /** Out of how many of Qloo's own picks. */
  of: number | null;
  below: boolean;
}

/** The generic plan's artists: every name it was searched by, and what Qloo's one scoring call said of each. */
export function genericPicks(view: Pick<PlanView, "trace">): { searched: string[]; checked: GenericPick[] } {
  const searched = view.trace.flatMap((t) => {
    const name = t.stage === "baseline" && t.kind === "tool" ? /^Resolving the generic plan's "(.+)" to a Qloo artist$/.exec(t.label)?.[1] : undefined;
    return name ? [name] : [];
  });
  const checked = view.trace.flatMap((t) => {
    const m = t.stage === "baseline" && t.label === "Checked a generic pick against Qloo" && t.reason ? /^(.+?): (.+)$/.exec(t.reason) : null;
    if (!m) return [];
    const beat = /beats (\d+) of (\d+)/.exec(m[2]!);
    return [{ name: m[1]!, beats: beat ? Number(beat[1]) : null, of: beat ? Number(beat[2]) : null, below: /below their median|no measurable affinity/i.test(m[2]!) }];
  });
  return { searched, checked };
}

/**
 * Qloo's check of the generic playlist in plain words: "Qloo ranks all 3 below its own top 20 for
 * Chicago adults 25 to 34" when none beat a single one of Qloo's own picks, else "in the bottom half
 * of its own list"; an artist Qloo could not match is named. `ofIts` reads "all 3 of its artists".
 * Null when there is nothing checked to say.
 */
export function genericCheckWords(view: Pick<PlanView, "trace" | "local">, ofIts = false): string | null {
  const city = view.local.city;
  const { searched, checked } = genericPicks(view);
  const below = checked.filter((c) => c.below);
  if (!city || !searched.length || !below.length) return null;
  const top = Math.max(0, ...checked.map((c) => c.of ?? 0));
  const all = below.length === searched.length;
  const n = searched.length;
  const who = all ? (n === 2 ? (ofIts ? "both of its artists" : "both") : ofIts ? `all ${n} of its artists` : `all ${n}`) : listOf(below.map((c) => c.name));
  const where = top > 0 && below.every((c) => !c.beats) ? `below its own top ${top}` : "in the bottom half of its own list";
  const missing = searched.filter((name) => !checked.some((c) => c.name === name));
  return `Qloo ranks ${who} ${where} for ${city.name} adults ${ageSpan(city.ageText)}${missing.length ? `, and couldn't find ${listOf(missing)}` : ""}`;
}
