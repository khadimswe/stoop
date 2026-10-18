"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserStorage } from "@/lib/run/recents";
import { createRunStream, emptySnapshot, type ResumeOutcome, type RunSnapshot, type RunStream } from "@/lib/run/stream";

export type RunEvents = RunSnapshot & {
  /** POST resume, then follow the next attempt. */
  resume: () => Promise<ResumeOutcome>;
  /** Reconnect at once after the stream was lost. */
  retry: () => void;
};

/**
 * Follows one run's server-sent events (lib/run/stream.ts): EventSource, reduced with the shared
 * reducer, resumed across reloads from sessionStorage with Last-Event-ID, reconnected with backoff.
 * The first render (server and client) is the empty snapshot; the stream starts after mount.
 */
export function useRunEvents(runId: string): RunEvents {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(() => emptySnapshot(runId));
  const stream = useRef<RunStream | null>(null);

  useEffect(() => {
    const controller = createRunStream(
      runId,
      {
        createSource: (url) => new EventSource(url),
        fetch: (input, init) => window.fetch(input, init),
        storage: browserStorage("sessionStorage"),
        now: () => Date.now(),
        setTimer: (run, ms) => window.setTimeout(run, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
      },
      setSnapshot,
    );
    stream.current = controller;
    controller.start();
    // The page is going away (a reload, an app switch on phones): keep what arrived for the next view.
    const flush = () => controller.flush();
    const hidden = () => {
      if (document.visibilityState === "hidden") controller.flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      controller.stop();
      if (stream.current === controller) stream.current = null;
    };
  }, [runId]);

  const resume = useCallback(async (): Promise<ResumeOutcome> => {
    const controller = stream.current;
    return controller ? controller.resume() : { kind: "error", message: "This page is still loading. Try again in a moment." };
  }, []);
  const retry = useCallback(() => stream.current?.retry(), []);

  // A new run id shows the empty snapshot until its own stream reports.
  const current = snapshot.runId === runId ? snapshot : emptySnapshot(runId);
  return { ...current, resume, retry };
}
