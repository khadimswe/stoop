"use client";

// "Post it for me": connect the store's Facebook Page, pick the Page and the channels, then Post now or
// Schedule at one of the suggested times. Structure and logic only: plain class names (meta-connect,
// meta-connect__*) for the redesign to style. Not wired into any page yet.
//
// Nothing posts without the manager's tap, and every post asks once more before it goes. While posting
// is off on this server (the routes answer 404), or for an example plan, it shows `fallback` (the
// page's one-tap share links) instead.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { planExampleSlug } from "@/lib/plan/example-list";
import type { PlanReport } from "@/lib/plan/schema";
import { apiMessageOf } from "@/lib/plan/view/live";
import { META_OUTCOMES, META_RETURN_PARAM, SOCIAL_ROUTES, socialPagesResponseSchema, socialPostResponseSchema, type MetaOutcome, type SocialPagesResponse, type SocialPostResult } from "@/lib/social/api";
import { suggestPostTimes, type PostTime } from "@/lib/social/schedule";
import { SOCIAL_CHANNEL_LABELS, type SocialChannel } from "@/lib/social/trail";

type Page = SocialPagesResponse["pages"][number];
type Connection = { kind: "loading" } | { kind: "off" } | { kind: "error"; message: string } | { kind: "disconnected" } | { kind: "connected"; pages: Page[] };
type When = { kind: "now" } | { kind: "scheduled"; time: PostTime };
type Sending = { kind: "idle" } | { kind: "confirm"; when: When } | { kind: "sending" } | { kind: "done"; results: SocialPostResult[] } | { kind: "error"; message: string };

const OUTCOME_TEXT: Readonly<Record<MetaOutcome, string>> = {
  connected: "Facebook is connected.",
  denied: "Facebook was not connected: the permissions were not allowed.",
  expired: "That Facebook login expired. Try connecting again.",
  failed: "Facebook could not be connected. Try again in a moment.",
};

export interface MetaConnectProps {
  planId: string;
  /** The plan's inputs, for the suggested post times in the store's own time zone. */
  inputs: PlanReport["inputs"];
  /** True once the plan's poster and posts are ready to go out. */
  ready: boolean;
  /** Where Facebook sends the manager back; defaults to this page. */
  returnTo?: string;
  /** Shown instead while posting is off on this server, and for example plans: the one-tap share links. */
  fallback?: ReactNode;
}

function readOutcome(): MetaOutcome | null {
  const value = new URLSearchParams(window.location.search).get(META_RETURN_PARAM);
  return META_OUTCOMES.find((o) => o === value) ?? null;
}

/** Takes ?meta=<outcome> off the address, so a reload does not say it again. */
function clearOutcome() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(META_RETURN_PARAM)) return;
  url.searchParams.delete(META_RETURN_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
}

export function MetaConnect({ planId, inputs, ready, returnTo, fallback = null }: MetaConnectProps) {
  const example = planExampleSlug(planId) !== null;
  const [connection, setConnection] = useState<Connection>({ kind: "loading" });
  const [outcome, setOutcome] = useState<MetaOutcome | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<SocialChannel, boolean>>({ facebook: true, instagram: false });
  const [sending, setSending] = useState<Sending>({ kind: "idle" });
  const ids = { page: useId(), facebook: useId(), instagram: useId() };
  const times = useMemo(() => suggestPostTimes({ inputs }), [inputs]);

  useEffect(() => {
    if (example) return;
    let stopped = false;
    (async () => {
      try {
        const response = await fetch(SOCIAL_ROUTES.pages, { headers: { accept: "application/json" }, cache: "no-store" });
        if (stopped) return;
        if (response.status === 404) return setConnection({ kind: "off" });
        // What the callback said (?meta=...), shown once whatever the Pages check says next.
        setOutcome(readOutcome());
        clearOutcome();
        const body: unknown = await response.json().catch(() => null);
        const parsed = socialPagesResponseSchema.safeParse(body);
        if (!response.ok || !parsed.success) return setConnection({ kind: "error", message: apiMessageOf(body) ?? "Facebook connection could not be checked. Reload to try again." });
        if (!parsed.data.connected) return setConnection({ kind: "disconnected" });
        setConnection({ kind: "connected", pages: parsed.data.pages });
        const first = parsed.data.pages.find((p) => p.canPost) ?? parsed.data.pages[0];
        if (first) {
          setPageId(first.id);
          setChannels({ facebook: true, instagram: first.instagram !== null });
        }
      } catch {
        if (stopped) return;
        setOutcome(readOutcome());
        clearOutcome();
        setConnection({ kind: "error", message: "No connection. Check your signal and reload." });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [example]);

  if (example || connection.kind === "off") return <>{fallback}</>;

  const page = connection.kind === "connected" ? (connection.pages.find((p) => p.id === pageId) ?? null) : null;
  const chosen = (Object.keys(channels) as SocialChannel[]).filter((c) => channels[c] && (c === "facebook" || page?.instagram));
  const back = returnTo ?? (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);

  /** A suggested time, checked again at the tap: a page left open for hours may hold one that has passed. */
  const stillOpen = (time: PostTime) => suggestPostTimes({ inputs }).find((t) => t.id === time.id && t.at === time.at) ?? null;
  const PASSED = "That time is too close or has passed. Pick another time, or post now.";

  const ask = (when: When) => {
    if (when.kind === "scheduled" && !stillOpen(when.time)) return setSending({ kind: "error", message: PASSED });
    setSending({ kind: "confirm", when });
  };

  const send = async (when: When) => {
    if (!page || chosen.length === 0) return;
    if (when.kind === "scheduled" && !stillOpen(when.time)) return setSending({ kind: "error", message: PASSED });
    setSending({ kind: "sending" });
    try {
      const response = await fetch(SOCIAL_ROUTES.post(planId), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ pageId: page.id, channels: chosen, when: when.kind === "now" ? "now" : when.time.at }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = socialPostResponseSchema.safeParse(body);
      if (response.ok && parsed.success) return setSending({ kind: "done", results: parsed.data.results });
      if (response.status === 401) setConnection({ kind: "disconnected" });
      setSending({ kind: "error", message: apiMessageOf(body) ?? "That did not go through. Nothing was posted. Try again." });
    } catch {
      setSending({ kind: "error", message: "No connection. Nothing was posted. Try again." });
    }
  };

  const disconnect = async () => {
    try {
      const response = await fetch(SOCIAL_ROUTES.disconnect, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) return setSending({ kind: "error", message: "Facebook could not be disconnected right now. Try again." });
      setConnection({ kind: "disconnected" });
      setSending({ kind: "idle" });
      setPageId(null);
    } catch {
      setSending({ kind: "error", message: "No connection. Facebook is still connected. Try again." });
    }
  };

  const channelWords = chosen.map((c) => SOCIAL_CHANNEL_LABELS[c]).join(" and ");

  return (
    <section className="meta-connect" aria-label="Post to Facebook and Instagram">
      {outcome && (
        <p className="meta-connect__outcome" role="status">
          {OUTCOME_TEXT[outcome]}
        </p>
      )}

      {connection.kind === "loading" && <p className="meta-connect__status">Checking your Facebook connection...</p>}
      {connection.kind === "error" && <p className="meta-connect__error">{connection.message}</p>}

      {connection.kind === "disconnected" && (
        <div className="meta-connect__connect">
          <a className="meta-connect__connect-link" href={SOCIAL_ROUTES.start(back)}>
            Connect Facebook
          </a>
          <p className="meta-connect__note">Connect the store&apos;s Facebook Page (and its Instagram account) to post the poster from here. Stoop posts only when you tap Post or Schedule.</p>
        </div>
      )}

      {connection.kind === "connected" && connection.pages.length === 0 && (
        <div className="meta-connect__empty">
          <p>No Pages came back from Facebook. Connect again and pick the store&apos;s Page.</p>
          <a className="meta-connect__connect-link" href={SOCIAL_ROUTES.start(back)}>
            Connect Facebook again
          </a>
        </div>
      )}

      {connection.kind === "connected" && connection.pages.length > 0 && (
        <div className="meta-connect__form">
          <label className="meta-connect__label" htmlFor={ids.page}>
            Page
          </label>
          <select
            id={ids.page}
            className="meta-connect__pages"
            value={pageId ?? ""}
            onChange={(e) => {
              const next = connection.pages.find((p) => p.id === e.target.value) ?? null;
              setPageId(next?.id ?? null);
              setChannels({ facebook: true, instagram: next?.instagram !== null && next?.instagram !== undefined });
              setSending({ kind: "idle" });
            }}
          >
            {connection.pages.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.canPost}>
                {p.name}
                {p.canPost ? "" : " (you can't post here)"}
              </option>
            ))}
          </select>

          <fieldset className="meta-connect__channels">
            <legend>Post to</legend>
            <label htmlFor={ids.facebook}>
              <input id={ids.facebook} type="checkbox" checked={channels.facebook} onChange={(e) => setChannels((c) => ({ ...c, facebook: e.target.checked }))} /> Facebook
            </label>
            <label htmlFor={ids.instagram}>
              <input id={ids.instagram} type="checkbox" disabled={!page?.instagram} checked={channels.instagram && Boolean(page?.instagram)} onChange={(e) => setChannels((c) => ({ ...c, instagram: e.target.checked }))} /> Instagram
              {page?.instagram ? (page.instagram.username ? ` (@${page.instagram.username})` : "") : " (no Instagram account linked to this Page)"}
            </label>
          </fieldset>

          {!ready && <p className="meta-connect__note">Make the poster and posts first. They go out exactly as you see them.</p>}

          {sending.kind === "confirm" ? (
            <div className="meta-connect__confirm" role="group" aria-label="Confirm">
              <p>
                {sending.when.kind === "now"
                  ? `Post the poster to ${page?.name} on ${channelWords} now?`
                  : `Schedule the poster on ${page?.name}'s Facebook for ${sending.when.time.label}?`}
              </p>
              <button type="button" className="meta-connect__yes" onClick={() => send(sending.when)}>
                {sending.when.kind === "now" ? "Yes, post it" : "Yes, schedule it"}
              </button>
              <button type="button" className="meta-connect__cancel" onClick={() => setSending({ kind: "idle" })}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="meta-connect__actions">
              <button type="button" className="meta-connect__post" disabled={!ready || !page || chosen.length === 0 || sending.kind === "sending"} onClick={() => ask({ kind: "now" })}>
                {sending.kind === "sending" ? "Posting..." : "Post now"}
              </button>
              {times.length > 0 && (
                <div className="meta-connect__schedule">
                  <p className="meta-connect__label">Schedule on Facebook</p>
                  <ul className="meta-connect__times">
                    {times.map((t) => (
                      <li key={t.id}>
                        <button type="button" className="meta-connect__time" disabled={!ready || !page || !channels.facebook || sending.kind === "sending"} onClick={() => ask({ kind: "scheduled", time: t })}>
                          Schedule: {t.name}, {t.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="meta-connect__note">Instagram&apos;s API can&apos;t schedule, so a scheduled post goes to Facebook only. Times are the store&apos;s local time.</p>
                </div>
              )}
            </div>
          )}

          {sending.kind === "done" && (
            <ul className="meta-connect__results" role="status">
              {sending.results.map((r) => (
                <li key={r.channel} className={`meta-connect__result meta-connect__result--${r.status}`}>
                  <span>{r.message}</span>
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noopener noreferrer">
                      {" "}
                      Open on {SOCIAL_CHANNEL_LABELS[r.channel]}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {sending.kind === "error" && (
            <p className="meta-connect__error" role="alert">
              {sending.message}
            </p>
          )}

          <button type="button" className="meta-connect__disconnect" onClick={disconnect}>
            Disconnect Facebook
          </button>
        </div>
      )}
    </section>
  );
}
