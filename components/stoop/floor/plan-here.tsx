"use client";

import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import type { EventSpot } from "@/lib/plan/event-spots";
import { CreateScreen } from "./create-screen";

/**
 * The Create step, set to a place picked on the Community step: "?at=<place id>" names one of this
 * community's own Qloo places, so the name and point come from Qloo, never from the link. An unknown
 * id is ignored. Wrap it in <Suspense> with the plain form as the fallback: the prerendered shell is
 * the same for every link, and the part that reads "?at" renders per request.
 */
export function CreateAt({ spots, ...props }: ComponentProps<typeof CreateScreen> & { spots: readonly EventSpot[] }) {
  const id = useSearchParams().get("at");
  const spot = id ? spots.find((s) => s.id === id) : undefined;
  return <CreateScreen key={spot?.id ?? "door"} {...props} at={spot ? { name: spot.name, lat: spot.lat, lon: spot.lon } : props.at} />;
}
