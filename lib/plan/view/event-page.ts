// The public event page (/e/[id]): what someone opening a Facebook or WhatsApp link needs, and
// nothing else. The poster, the event's name, when, where, the store and its promos word for word.
// No receipts, no plan internals, no Qloo names beyond the place the event is at.
import type { PlanSource } from "./plan";
import { capitalizeFirst, eventDate, fictionalNotice, timeRange } from "./format";
import { fullAddress, posterRoute } from "./plan";

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
  address: string;
  /** A maps search for the address (opens the visitor's own maps app). */
  mapsHref: string;
  offers: string[];
  poster: { src: string; alt: string } | null;
  /** Lane C's 1200 by 630 poster, for link previews. */
  ogImage: string;
  /** Example stores only. */
  fictional: string | null;
}

export function eventPageView(source: PlanSource): EventPageView {
  const { inputs, report, id } = source;
  const kept = report.plan?.concepts.find((c) => c.id === report.plan?.conceptId) ?? report.plan?.concepts.find((c) => c.kept) ?? null;
  const address = fullAddress(inputs.store);
  const place = inputs.location?.name ?? inputs.store.name;
  const where = capitalizeFirst(place);
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
    address,
    mapsHref: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inputs.location ? `${inputs.location.point.lat},${inputs.location.point.lon}` : address)}`,
    offers: inputs.offers.map((o) => o.text),
    poster: kept ? { src: report.poster.status === "ready" && report.poster.url ? report.poster.url : posterRoute(id, "medium"), alt: report.poster.alt || `Event poster: ${kept.title}, ${inputs.store.name}` } : null,
    ogImage: posterRoute(id, "og"),
    fictional: source.kind === "example" ? fictionalNotice(inputs.store.carrier) : null,
  };
}
