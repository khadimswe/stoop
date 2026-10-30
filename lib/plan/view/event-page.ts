// The public event page (/e/[id]): what someone opening a Facebook or WhatsApp link needs, and
// nothing else. The poster, the event's name, when, where, what is at the table (music from the city,
// snacks and the place they come from, the prize wheel) and the store's promos word for word. No
// receipts and no plan internals. Artists are not named here: a list of names on a public page would
// read as a lineup.
import type { PlanSource } from "./plan";
import { capitalizeFirst, distanceText, eventDate, fictionalNotice, timeRange } from "./format";
import { fullAddress, posterRoute } from "./plan";
import { gameOf, gameWords } from "../game";
import { splitRefs } from "../refs";

export interface EventPageView {
  id: string;
  title: string;
  hook: string | null;
  dateText: string;
  timeText: string;
  storeName: string;
  /** The store's public phone, when the manager gave one. Never the internal store number. */
  phone: string | null;
  /** Where to go: the event's own place when it is away from the store, else the store. */
  where: string;
  /** The event is away from the store: the store is named on its own line. */
  away: boolean;
  address: string;
  /** A maps search for the address (opens the visitor's own maps app). */
  mapsHref: string;
  offers: string[];
  /** What is at the table besides the promos. */
  draws: {
    music: string | null;
    /** "Snacks and drinks from Maple Corner Cafe, down the street" (a made-up name). */
    snacks: string | null;
    /** The table's game: `play` is "Spin the prize wheel" or "Drop a chip on the drop board". */
    wheel: { rule: string | null; prizes: string[]; play: string; listLabel: string } | null;
  };
  poster: { src: string; alt: string } | null;
  /** Lane C's 1200 by 630 poster, for link previews. */
  ogImage: string;
  /** Example stores only. */
  fictional: string | null;
}

/** A slice label with any "[[id]]" place token said by name (or dropped when the place is unknown). */
function named(text: string, names: ReadonlyMap<string, string>): string {
  return splitRefs(text)
    .map((p) => (p.kind === "text" ? p.text : (names.get(p.id) ?? "a local spot")))
    .join("")
    .trim();
}

export function eventPageView(source: PlanSource): EventPageView {
  const { inputs, report, id } = source;
  const plan = report.plan;
  const kept = plan?.concepts.find((c) => c.id === plan.conceptId) ?? plan?.concepts.find((c) => c.kept) ?? null;
  const address = fullAddress(inputs.store);
  const place = inputs.location?.name ?? inputs.store.name;
  const where = capitalizeFirst(place);
  const places = new Map((report.local.block?.places ?? []).map((p) => [p.id, p]));
  const names = new Map([...places.values()].map((p) => [p.id, p.name]));
  const snackFrom = [...new Set((plan?.shopping ?? []).filter((s) => s.from && places.has(s.from) && !/\b(gift ?cards?|prizes?|raffle|drawing)\b/i.test(s.item)).map((s) => s.from!))]
    .map((pid) => places.get(pid)!)
    .slice(0, 2);
  const snacks = snackFrom.length
    ? `Snacks and drinks from ${snackFrom.map((p) => p.name).join(" and ")}${snackFrom.length === 1 && snackFrom[0]!.distanceM !== null ? `, ${distanceText(snackFrom[0]!.distanceM!)} away` : ""}`
    : null;
  const wheel = plan?.wheel
    ? {
        rule: plan.wheel.rules[0]?.split(/(?<=\.)\s/)[0]?.replace(/\.$/, "") ?? null,
        prizes: plan.wheel.slices.map((s) => named(s.label, names)).filter(Boolean),
        play: gameWords(gameOf(inputs)).play,
        listLabel: gameOf(inputs) === "drop_board" ? "On the drop board" : "On the wheel",
      }
    : null;
  const music = kept?.items.some((i) => i.kind === "music") && report.local.city ? `Music ${report.local.city.city} plays` : null;
  return {
    id,
    title: kept?.title ?? `Saturday at ${inputs.store.name}`,
    // The hook can name a measured place by "[[id]]"; the public page keeps only hooks without one.
    hook: kept && !/\[\[/.test(kept.hook) ? kept.hook : null,
    dateText: eventDate(inputs.date),
    timeText: timeRange(inputs.startTime, inputs.durationMinutes),
    storeName: inputs.store.name,
    phone: inputs.store.phone ?? null,
    where,
    away: Boolean(inputs.location),
    address,
    mapsHref: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inputs.location ? `${inputs.location.point.lat},${inputs.location.point.lon}` : address)}`,
    offers: inputs.offers.map((o) => o.text),
    draws: { music, snacks, wheel },
    poster: kept ? { src: report.poster.status === "ready" && report.poster.url ? report.poster.url : posterRoute(id, "medium"), alt: report.poster.alt || `Event poster: ${kept.title}, ${inputs.store.name}` } : null,
    ogImage: posterRoute(id, "og"),
    fictional: source.kind === "example" ? fictionalNotice(inputs.store.carrier) : null,
  };
}
