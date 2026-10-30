// Names Qloo returned for an example store, read from its recorded plan when a test runs. Tests check
// real names this way instead of writing them down, so no test file holds Qloo response data: the public
// mirror publishes the tests, never the recordings (MIRROR.md). Plain node, so unit and e2e tests share it.
import { readFileSync } from "node:fs";
import path from "node:path";

interface Recorded {
  local: { city: { artists: { name: string }[] } | null; block: { places: { id: string; name: string }[] } | null };
  plan: { shopping: { item: string; from?: string }[]; wheel?: { slices: { refs: string[] }[] } } | null;
  trace: { label: string }[];
}

/** "A, B and C", the way the pages list names. */
export const andList = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function recordedNames(slug = "chicago-18th-street", root = process.cwd()) {
  const report = JSON.parse(readFileSync(path.join(root, "data", "plans", slug, "plan.report.json"), "utf8")) as Recorded;
  const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p.name]));
  const snack = report.plan?.shopping.find((s) => s.from && places.has(s.from) && !/gift ?cards?/i.test(s.item));
  const giftCard = report.plan?.wheel?.slices.flatMap((s) => s.refs).find((id) => places.has(id));
  const generic = report.trace.flatMap((t) => /^Resolving the generic plan's "(.+)" to a Qloo artist$/.exec(t.label)?.[1] ?? []);
  return {
    /** The city's artists in Qloo's order. */
    artists: (report.local.city?.artists ?? []).map((a) => a.name),
    /** The place the plan buys its snacks from. */
    snackPlace: snack?.from ? places.get(snack.from)! : "",
    /** The place the prize wheel's gift card is for. */
    giftCardPlace: giftCard ? places.get(giftCard)! : "",
    /** The generic AI plan's artists, in the order it named them. */
    genericArtists: generic,
  };
}
