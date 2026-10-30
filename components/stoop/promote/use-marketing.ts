"use client";

// A live plan's poster and posts as the Poster and Promote steps show them. The plan starts them on
// the server as soon as it finishes, and they usually arrive on the plan's own event stream. This hook
// covers the rest: it reads GET /api/plan/<id>/marketing every few seconds while they are not done (a
// stream that already ended still gets them), asks POST /api/plan/<id>/marketing once if nothing has
// started after a short wait (the same call is safe twice: the server's lock makes one set), and asks
// for a new version of the art. Examples ship with theirs, so nothing runs for them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { posterSchema, postsSchema, type Poster } from "@/lib/plan/schema";
import { apiMessageOf } from "@/lib/plan/view/live";
import { marketingView, type MarketingView, type PlanView } from "@/lib/plan/view/plan";

const stateSchema = z.object({ a: z.object({ poster: posterSchema, posts: postsSchema.nullable() }).loose() }).loose();

const POLL_MS = 4_000;
/** How long the page waits for the server's own start before it asks. */
const KICK_AFTER_MS = 12_000;
/** Polling gives up after this long; the page says to reload. */
const POLL_LIMIT_MS = 4 * 60_000;

const FINAL = new Set(["ready", "skipped", "failed"]);
const rank = (status: string, posts: boolean) => (FINAL.has(status) && posts ? 2 : status === "queued" ? 1 : 0);

export type MarketingPhase = "ready" | "making" | "stalled";

export interface Marketing {
  marketing: MarketingView;
  phase: MarketingPhase;
  /** Something to tell the manager: why it has not started, or what a new version did. */
  message: { tone: "plain" | "bad"; title: string; text: string | null } | null;
  /** A new version of the art; null where that cannot change anything (examples, or art that is off). */
  remake: (() => Promise<void>) | null;
  remaking: boolean;
  /** Changes with the art, so the browser fetches the new poster instead of its cached one. */
  version: string | null;
}

/** The poster route with a version, so a new version of the art is never served from the cache. */
export function versioned(src: string | null, version: string | null): string | null {
  if (!src || !version) return src;
  return `${src}${src.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

/** What the hook reads from a plan's view. */
export type MarketingSubject = Pick<PlanView, "id" | "marketing"> & { header: Pick<PlanView["header"], "storeName">; concept: object | null };

export function useMarketing(view: MarketingSubject, live: boolean): Marketing {
  const base = view.marketing;
  const [polled, setPolled] = useState<{ poster: Poster; posts: z.infer<typeof postsSchema> | null } | null>(null);
  const [message, setMessage] = useState<Marketing["message"]>(null);
  const [remaking, setRemaking] = useState<{ from: string } | null>(null);
  const [stalled, setStalled] = useState(false);
  const kicked = useRef(false);

  const baseRank = rank(base.poster.status, base.posts !== null);
  const polledRank = polled ? rank(polled.poster.status, polled.posts !== null) : -1;
  const usePolled = polled !== null && (polledRank > baseRank || remaking !== null || (polledRank === baseRank && polled.poster.status !== base.poster.status));
  const marketing = useMemo(
    () => (usePolled && polled ? marketingView(view.id, view.header.storeName, polled.poster, polled.posts, Boolean(view.concept)) : base),
    [usePolled, polled, base, view.id, view.header.storeName, view.concept],
  );
  const status = marketing.poster.status;
  const done = FINAL.has(status) && marketing.posts !== null;
  const working = live && (!done || remaking !== null);

  const read = useCallback(async () => {
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(view.id)}/marketing`, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return null;
      const parsed = stateSchema.safeParse(await response.json());
      if (!parsed.success) return null;
      setPolled({ poster: parsed.data.a.poster, posts: parsed.data.a.posts });
      return parsed.data.a;
    } catch {
      return null;
    }
  }, [view.id]);

  const ask = useCallback(
    async (body: Record<string, string>) => {
      const response = await fetch(`/api/plan/${encodeURIComponent(view.id)}/marketing`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      const json: unknown = await response.json().catch(() => null);
      const code = (json as { error?: { code?: string } } | null)?.error?.code ?? null;
      return { ok: response.ok, code, text: apiMessageOf(json) };
    },
    [view.id],
  );

  // While the poster and posts are being made, read them every few seconds.
  useEffect(() => {
    if (!working) return;
    const started = Date.now();
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      if (Date.now() - started > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        setStalled(true);
        return;
      }
      const state = await read();
      if (state && remaking && state.poster.promptHash !== remaking.from && FINAL.has(state.poster.status)) setRemaking(null);
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [working, read, remaking]);

  // Nothing started on the server after a short wait (a plan that ran out of time, say): ask once.
  useEffect(() => {
    if (!live || kicked.current || status !== "none" || marketing.posts !== null) return;
    const timer = window.setTimeout(async () => {
      kicked.current = true;
      try {
        const answer = await ask({});
        if (!answer.ok && answer.code !== "busy") setMessage({ tone: "bad", title: "The poster and posts didn't start", text: answer.text ?? "Try again in a minute." });
        if (answer.code === "busy") kicked.current = false;
      } catch {
        kicked.current = false;
      }
    }, KICK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [live, status, marketing.posts, ask]);

  const canRemake = live && done && remaking === null && (status === "ready" || status === "failed");
  const remake = useCallback(async () => {
    const from = polled?.poster.promptHash ?? null;
    setMessage(null);
    try {
      const current = from ?? (await read())?.poster.promptHash ?? "";
      const answer = await ask({ remake: "art" });
      if (!answer.ok) return setMessage({ tone: "bad", title: "No new version this time", text: answer.text ?? "Try again in a minute." });
      setRemaking({ from: current });
      setMessage({ tone: "plain", title: "Painting a new background", text: "About a minute. Your words stay the same." });
    } catch {
      setMessage({ tone: "bad", title: "No connection", text: "Check your signal and try again." });
    }
  }, [ask, polled, read]);

  // A new version arrived: say so once.
  const lastHash = useRef<string | null>(null);
  useEffect(() => {
    const hash = polled?.poster.promptHash ?? null;
    if (hash && lastHash.current && hash !== lastHash.current && polled?.poster.status === "ready" && remaking === null) setMessage({ tone: "plain", title: "New version ready", text: null });
    if (hash && FINAL.has(polled?.poster.status ?? "")) lastHash.current = hash;
  }, [polled, remaking]);

  const phase: MarketingPhase = !live || (done && remaking === null) ? "ready" : stalled ? "stalled" : "making";
  return { marketing, phase, message, remake: canRemake ? remake : null, remaking: remaking !== null, version: usePolled && polled ? polled.poster.promptHash.slice(0, 12) || null : null };
}
