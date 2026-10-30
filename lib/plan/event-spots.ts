// Places on the Community step a manager can take the table to ("Plan it here"): a venue or a park
// Qloo returned with a point, so the plan can read the community around it. Never a chain (a chain
// is for gift cards and snack runs, not a partner), never a place built around alcohol, tobacco or
// nightlife, and never one aimed at minors, read from Qloo's own tags and description. Pure.
import type { Place } from "./schema";
import type { PlaceView } from "./view/plan";

/** A place the table can go to, as the Create step needs it: Qloo's own name and point. */
export interface EventSpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Tags that rule a place out: drinking and nightlife, smoking, gambling, adult venues, and places for kids. */
const NOT_HERE_TAG =
  /\b(bars?|pubs?|gastropubs?|brew(ery|eries|pub)|tap ?rooms?|winer(y|ies)|wine|beer|cocktails?|lounges?|night ?clubs?|nightlife|clubs?|liquor|spirits|distiller(y|ies)|hookah|cigars?|smoke shops?|tobacco|vape|dispensar(y|ies)|cannabis|casinos?|gambling|strip|adult|schools?|kids?|children'?s?|child|youth|teens?|daycare|preschool|kindergarten|playgrounds?|toy stores?|tour agency|swimming pools?)\b/i;

/** Qloo's description gives the rest away: a BYOB theater, a club-style room, "a bar" on site, kids' camps. */
const NOT_HERE_WHY = /\b(byob|bars?|pubs?|night ?clubs?|nightlife|club-style|cocktails?|brew(ery|eries|pub)|tap ?rooms?|beer|wine|liquor|hookah|cigars?|kids?|children'?s?|youth|teens?|schools?|daycare|camps?)\b/i;

/** Whether "Plan it here" shows on a place: a venue or park with a point, no chain, nothing for alcohol or minors. */
export function canPlanAt(place: Pick<Place, "kind" | "tags" | "why" | "point" | "chain">): boolean {
  if (place.kind !== "venue" && place.kind !== "park") return false;
  if (!place.point || place.chain === true) return false;
  if (place.tags.some((tag) => NOT_HERE_TAG.test(tag))) return false;
  return !(place.why && NOT_HERE_WHY.test(place.why));
}

/** The community's places that show "Plan it here", for the Create step to look a picked id up in. */
export function eventSpots(places: readonly PlaceView[]): EventSpot[] {
  return places.flatMap((p) => (p.eventSpot && p.point ? [{ id: p.id, name: p.name, lat: p.point.lat, lon: p.point.lon }] : []));
}

/** Where "Plan it here" goes: the Create step with the place's Qloo id (never its name) in the link. */
export const planHereHref = (createHref: string, placeId: string): string => `${createHref}?at=${encodeURIComponent(placeId)}`;
