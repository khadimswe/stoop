// "My stores": one row per store for the store, multi-store and district views. Built from each
// store's plan view, so every name and distance comes from that store's own run.
import type { PlanView } from "./plan";

export interface StoreRowView {
  slug: string;
  storeName: string;
  /** The dealer's internal number ("Store 1234"), for managers only. */
  storeNumber: string | null;
  city: string;
  address: string;
  dateShort: string;
  timeText: string;
  eventTitle: string | null;
  /** The block place the plan buys from, with its distance ("Honky Tonk BBQ, 30 m"). */
  block: string | null;
  music: string | null;
  poster: { src: string; alt: string } | null;
  /** "Ready to post" or what is left to do. */
  status: string;
  planHref: string;
  eventHref: string;
  /** Example stores say they are fictional. */
  note: string | null;
}

export function storeRow(slug: string, view: PlanView, planHref: string): StoreRowView {
  const snacks = view.tiles.find((t) => t.key === "snacks");
  const music = view.tiles.find((t) => t.key === "music");
  const posted = view.marketing.posts !== null;
  return {
    slug,
    storeName: view.header.storeName,
    storeNumber: view.header.storeNumber,
    city: view.header.cityLine,
    address: view.header.address,
    dateShort: view.header.dateShort,
    timeText: view.header.timeText,
    eventTitle: view.concept?.title ?? null,
    block: snacks?.qloo ? [snacks.value, snacks.note?.replace(" away", "")].filter(Boolean).join(", ") : null,
    music: music?.qloo ? music.value : null,
    poster: view.marketing.poster.src ? { src: view.marketing.poster.src, alt: view.marketing.poster.alt } : null,
    status: view.concept === null ? "No plan yet" : posted ? "Ready to post" : "Make the poster",
    planHref,
    eventHref: view.marketing.eventPath,
    note: view.header.fictional,
  };
}
