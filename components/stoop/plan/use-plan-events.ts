"use client";

import { useEffect, useState } from "react";
import { reducePlan, type PlanEvent, type PlanState } from "@/lib/plan/events";
import type { PlanReport } from "@/lib/plan/schema";
import { endsRun, parsePlanEvent, readPlanResponse } from "@/lib/plan/view/live";

export type PlanFeed =
  | { phase: "connecting" }
  | { phase: "streaming" | "ended"; state: PlanState }
  /** `owner`: the plan route said this browser started the plan (anyone else gets the public view). */
  | { phase: "report"; report: PlanReport; owner: boolean }
  | { phase: "not-found" }
  | { phase: "error"; message: string };

/** The event names a plan stream may use; plain `message` events count too. */
const NAMED = ["plan", "run", "event"] as const;

/**
 * Follows one plan's server-sent events (GET /api/plan/[id]/events), folded with the shared reducer,
 * so a live plan fills in section by section. The stream closes on the run's last event. If it can
 * not be opened at all, the plan route (GET /api/plan/[id]) is read once instead: a finished plan
 * still shows, and an unknown id says so.
 */
export function usePlanEvents(id: string): PlanFeed {
  const [feed, setFeed] = useState<{ id: string; value: PlanFeed }>({ id, value: { phase: "connecting" } });

  useEffect(() => {
    let stopped = false;
    const events: PlanEvent[] = [];
    let ended = false;
    const set = (value: PlanFeed) => {
      if (!stopped) setFeed({ id, value });
    };

    const readOnce = async () => {
      try {
        const response = await fetch(`/api/plan/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
        if (response.status === 404) return set({ phase: "not-found" });
        if (!response.ok) return set({ phase: "error", message: "This plan could not be loaded right now. Try again in a minute." });
        const body: unknown = await response.json();
        const read = readPlanResponse(body);
        if (!read) return set({ phase: "error", message: "This plan could not be read." });
        if ("report" in read) return set({ phase: "report", report: read.report, owner: (body as { owner?: unknown } | null)?.owner === true });
        set({ phase: "ended", state: reducePlan(read.events) });
      } catch {
        set({ phase: "error", message: "No connection. Check your signal and reload." });
      }
    };

    const source = new EventSource(`/api/plan/${encodeURIComponent(id)}/events`);
    const onMessage = (message: MessageEvent) => {
      const event = parsePlanEvent(String(message.data));
      if (!event) return;
      events.push(event);
      if (endsRun(event)) ended = true;
      // The poster and posts land after run.done, so the stream stays open: the server ends it, and a
      // later reconnect gets 204, which stops the EventSource.
      set({ phase: ended ? "ended" : "streaming", state: reducePlan(events) });
    };
    source.addEventListener("message", onMessage);
    for (const name of NAMED) source.addEventListener(name, onMessage);
    source.addEventListener("error", () => {
      if (source.readyState !== EventSource.CLOSED) return; // The browser is reconnecting by itself.
      if (events.length === 0) void readOnce();
      else set({ phase: "ended", state: reducePlan(events) });
    });

    return () => {
      stopped = true;
      source.close();
    };
  }, [id]);

  return feed.id === id ? feed.value : { phase: "connecting" };
}

