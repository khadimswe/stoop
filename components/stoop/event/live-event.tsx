"use client";

import { useEffect, useState } from "react";
import { reducePlan } from "@/lib/plan/events";
import { eventPageView, type EventPageView } from "@/lib/plan/view/event-page";
import { readPlanResponse } from "@/lib/plan/view/live";
import { sourceFromReport, sourceFromState } from "@/lib/plan/view/plan";
import { EventPage } from "./event-page";

type Load = { kind: "loading" } | { kind: "ready"; view: EventPageView } | { kind: "missing" };

/** A live plan's event page: read once from GET /api/plan/[id] in the browser. */
export function LiveEvent({ planId }: { planId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const response = await fetch(`/api/plan/${encodeURIComponent(planId)}`, { headers: { accept: "application/json" } });
        const read = response.ok ? readPlanResponse(await response.json()) : null;
        const source = read ? ("report" in read ? sourceFromReport(read.report, planId) : sourceFromState(reducePlan(read.events), planId)) : null;
        if (!stopped) setLoad(source ? { kind: "ready", view: eventPageView(source) } : { kind: "missing" });
      } catch {
        if (!stopped) setLoad({ kind: "missing" });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [planId]);

  if (load.kind === "ready") return <EventPage view={load.view} />;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 px-4 pt-10 pb-12 sm:px-5">
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold [font-stretch:85%]">{load.kind === "loading" ? "Loading the event..." : "This event isn't here"}</h1>
      {load.kind === "missing" && <p className="text-sm text-ink-soft">The link may be old. Ask the store for a new one.</p>}
    </main>
  );
}
