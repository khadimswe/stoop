"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CultureField } from "@/lib/types";

/** What "Not this vibe" turns down: one Culture Brief field, or the whole world. */
export type ReviseField = CultureField | "world";

/**
 * Where one world's storyboard request stands, before the frame job's own events take over.
 *   sending    the request is on its way
 *   starting   the API took it (202); the job's first event has not arrived yet
 *   note       the API answered with plain words instead (paused, a limit, live runs off)
 */
export interface FramesNote {
  state: "sending" | "starting" | "note";
  message: string | null;
}

/**
 * Where one world's revision stands.
 *   sending    the request is on its way
 *   revising   the agent is making new Qloo calls; the diff lands with the revision
 *   done       the revision arrived (the Culture Brief shows what changed)
 *   failed     the agent said it could not revise (its reason is the message)
 *   note       the API answered with plain words instead (the run's limit, a daily cap)
 */
export interface ReviseNote {
  state: "sending" | "revising" | "done" | "failed" | "note";
  field: ReviseField;
  revisionId: string | null;
  message: string | null;
}

export interface LiveActions {
  runId: string;
  frames: Readonly<Record<string, FramesNote>>;
  revisions: Readonly<Record<string, ReviseNote>>;
  requestFrames: (segmentId: string) => Promise<void>;
  /** Resolves with the API's words when the note must change before it can be sent (a guardrail). */
  requestRevision: (input: { segmentId: string; field: ReviseField; reason: string }) => Promise<{ ok: boolean; message: string | null }>;
}

const LiveActionsContext = createContext<LiveActions | null>(null);

/** Live reports only: example pages have no provider, so after-run controls render nothing there. */
export function LiveActionsProvider({ value, children }: { value: LiveActions; children: ReactNode }) {
  return <LiveActionsContext.Provider value={value}>{children}</LiveActionsContext.Provider>;
}

export function useLiveActions(): LiveActions | null {
  return useContext(LiveActionsContext);
}
