"use client";

// "Post it for me", in the floor's design: the store's accounts (the Facebook Page, its Instagram, and
// WhatsApp's share sheet), then the agent's plan (now, plus up to three suggested times in the store's
// own time zone), each ticked, and one "Approve N posts". Every approval asks once more before
// anything goes. Instagram can't be scheduled through Meta's API, so scheduled posts go to Facebook
// only and Instagram posts at approval time; the screen says so. While posting is off on this server
// (the routes answer 404), and for example plans (403), it shows `fallback`: the one-tap share screen.
import { Check } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionBar, BUTTON2_SM, Fine, Notice, PRIMARY, Section } from "@/components/stoop/floor/kit";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import { planExampleSlug } from "@/lib/plan/example-list";
import type { PlanReport } from "@/lib/plan/schema";
import { apiMessageOf } from "@/lib/plan/view/live";
import { META_OUTCOMES, META_RETURN_PARAM, SOCIAL_ROUTES, socialPagesResponseSchema, socialPostResponseSchema, type MetaOutcome, type SocialPagesResponse, type SocialPostResult } from "@/lib/social/api";
import { suggestPostTimes, type PostTime } from "@/lib/social/schedule";
import type { SocialChannel } from "@/lib/social/trail";
import { cn } from "cn";

type Page = SocialPagesResponse["pages"][number];
type Connection = { kind: "loading" } | { kind: "off" } | { kind: "error"; message: string } | { kind: "disconnected" } | { kind: "connected"; pages: Page[] };
type Slot = { id: string; when: "now" | PostTime; title: string; label: string };
type Sending = { kind: "idle" } | { kind: "confirm" } | { kind: "sending"; done: number } | { kind: "done"; results: SocialPostResult[] } | { kind: "error"; message: string; results: SocialPostResult[] };

const OUTCOME_TEXT: Readonly<Record<MetaOutcome, string>> = {
  connected: "Facebook is connected.",
  denied: "Facebook wasn't connected: the permissions weren't allowed.",
  expired: "That Facebook login expired. Connect again.",
  failed: "Facebook couldn't be connected. Try again in a moment.",
};

export interface MetaConnectProps {
  planId: string;
  /** The plan's inputs, for the suggested post times in the store's own time zone. */
  inputs: PlanReport["inputs"];
  /** True once the plan's poster and posts are ready to go out. */
  ready: boolean;
  /** Where Facebook sends the manager back; defaults to this page. */
  returnTo?: string;
  /** WhatsApp's share link (Meta can't post to WhatsApp groups; the manager picks the chats). */
  whatsappHref?: string | null;
  /** Shown instead while posting is off on this server, and for example plans: the one-tap share screen. */
  fallback?: ReactNode;
}

function readOutcome(): MetaOutcome | null {
  const value = new URLSearchParams(window.location.search).get(META_RETURN_PARAM);
  return META_OUTCOMES.find((o) => o === value) ?? null;
}

function clearOutcome() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(META_RETURN_PARAM)) return;
  url.searchParams.delete(META_RETURN_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
}

function AccountRow({ glyph, on, title, sub, action }: { glyph: ReactNode; on: boolean; title: string; sub: string; action: ReactNode }) {
  return (
    <li className="flex min-h-[64px] items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]", on ? "bg-fl-ink text-white" : "bg-fl-band text-fl-ink")}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] leading-5 font-medium">{title}</span>
        <span className="block text-[0.8125rem] text-fl-dim">{sub}</span>
      </span>
      {action}
    </li>
  );
}

const Connected = () => (
  <span className="inline-flex items-center gap-1 text-sm font-semibold text-fl-ok">
    <Check aria-hidden="true" className="size-4" />
    Connected
  </span>
);

export function MetaConnect({ planId, inputs, ready, returnTo, whatsappHref = null, fallback = null }: MetaConnectProps) {
  const example = planExampleSlug(planId) !== null;
  const [connection, setConnection] = useState<Connection>({ kind: "loading" });
  const [outcome, setOutcome] = useState<MetaOutcome | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<Sending>({ kind: "idle" });
  const times = useMemo(() => suggestPostTimes({ inputs }), [inputs]);
  const slots: Slot[] = useMemo(() => [{ id: "now", when: "now", title: "Announce", label: "Now" }, ...times.map((t) => ({ id: t.id, when: t, title: t.name, label: t.label }))], [times]);

  useEffect(() => {
    if (example) return;
    let stopped = false;
    (async () => {
      try {
        const response = await fetch(SOCIAL_ROUTES.pages, { headers: { accept: "application/json" }, cache: "no-store" });
        if (stopped) return;
        if (response.status === 404 || response.status === 403) return setConnection({ kind: "off" });
        setOutcome(readOutcome());
        clearOutcome();
        const body: unknown = await response.json().catch(() => null);
        const parsed = socialPagesResponseSchema.safeParse(body);
        if (!response.ok || !parsed.success) return setConnection({ kind: "error", message: apiMessageOf(body) ?? "The Facebook connection couldn't be checked. Reload to try again." });
        if (!parsed.data.connected) return setConnection({ kind: "disconnected" });
        setConnection({ kind: "connected", pages: parsed.data.pages });
        const first = parsed.data.pages.find((p) => p.canPost) ?? parsed.data.pages[0];
        if (first) setPageId(first.id);
      } catch {
        if (stopped) return;
        setConnection({ kind: "error", message: "No connection. Check your signal and reload." });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [example]);

  if (example || connection.kind === "off") return <>{fallback}</>;

  const page = connection.kind === "connected" ? (connection.pages.find((p) => p.id === pageId) ?? null) : null;
  const back = returnTo ?? (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);
  const isOn = (id: string) => picked[id] !== false;
  const chosen = slots.filter((s) => isOn(s.id));
  const canPost = ready && page !== null && page.canPost && chosen.length > 0;

  const send = async () => {
    if (!page) return;
    const results: SocialPostResult[] = [];
    setSending({ kind: "sending", done: 0 });
    for (const [i, slot] of chosen.entries()) {
      // A suggested time is checked again at the tap: a page left open for hours may hold one that has passed.
      if (slot.when !== "now") {
        const when = slot.when;
        if (!suggestPostTimes({ inputs }).some((t) => t.id === when.id && t.at === when.at)) {
          results.push({ channel: "facebook", status: "skipped", message: `${slot.title}: that time is too close or has passed.`, link: null, error: "schedule" });
          continue;
        }
      }
      const channels: SocialChannel[] = slot.when === "now" && page.instagram ? ["facebook", "instagram"] : ["facebook"];
      try {
        const response = await fetch(SOCIAL_ROUTES.post(planId), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ pageId: page.id, channels, when: slot.when === "now" ? "now" : slot.when.at }),
        });
        const body: unknown = await response.json().catch(() => null);
        const parsed = socialPostResponseSchema.safeParse(body);
        if (response.status === 404) return setConnection({ kind: "off" });
        if (response.status === 401) setConnection({ kind: "disconnected" });
        if (!response.ok || !parsed.success) return setSending({ kind: "error", message: apiMessageOf(body) ?? "That didn't go through. Nothing else was posted. Try again.", results });
        results.push(...parsed.data.results);
      } catch {
        return setSending({ kind: "error", message: "No connection. Nothing else was posted. Try again.", results });
      }
      setSending({ kind: "sending", done: i + 1 });
    }
    setSending({ kind: "done", results });
  };

  const disconnect = async () => {
    try {
      const response = await fetch(SOCIAL_ROUTES.disconnect, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) return setSending({ kind: "error", message: "Facebook couldn't be disconnected right now. Try again.", results: [] });
      setConnection({ kind: "disconnected" });
      setSending({ kind: "idle" });
      setPageId(null);
    } catch {
      setSending({ kind: "error", message: "No connection. Facebook is still connected. Try again.", results: [] });
    }
  };

  const results = sending.kind === "done" || sending.kind === "error" ? sending.results : [];
  return (
    <>
      {outcome && <Notice title={OUTCOME_TEXT[outcome]} />}
      {connection.kind === "error" && (
        <Notice tone="bad" title="Facebook check failed">
          {connection.message}
        </Notice>
      )}

      <Section title="Accounts">
        <ul aria-label="Accounts" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          <AccountRow
            glyph={<FacebookGlyph />}
            on={connection.kind === "connected"}
            title="Facebook Page"
            sub={connection.kind === "loading" ? "Checking..." : page ? page.name : connection.kind === "connected" ? "No Page you can post to" : "Not connected"}
            action={
              connection.kind === "connected" && page ? (
                <Connected />
              ) : connection.kind !== "loading" ? (
                <a href={SOCIAL_ROUTES.start(back)} className={BUTTON2_SM}>
                  Connect
                </a>
              ) : null
            }
          />
          <AccountRow
            glyph={<InstagramGlyph />}
            on={Boolean(page?.instagram)}
            title="Instagram"
            sub={page?.instagram ? (page.instagram.username ? `@${page.instagram.username}` : "Linked to the Page") : "Not connected"}
            action={
              page?.instagram ? (
                <Connected />
              ) : connection.kind === "connected" ? (
                <a href={SOCIAL_ROUTES.start(back)} className={BUTTON2_SM}>
                  Connect
                </a>
              ) : null
            }
          />
          <AccountRow
            glyph={<WhatsAppGlyph />}
            on={false}
            title="WhatsApp"
            sub="Groups and status"
            action={
              whatsappHref ? (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={BUTTON2_SM}>
                  Share<span className="sr-only"> on WhatsApp (opens in a new tab)</span>
                </a>
              ) : null
            }
          />
        </ul>
        {connection.kind === "connected" && connection.pages.length > 1 && (
          <label className="flex items-center gap-3 text-sm">
            <span className="text-fl-dim">Post as</span>
            <select value={pageId ?? ""} onChange={(e) => setPageId(e.target.value)} className="h-9 rounded-[12px] border border-fl-line bg-white px-2">
              {connection.pages.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.canPost}>
                  {p.name}
                  {p.canPost ? "" : " (you can't post here)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {connection.kind === "connected" && !page?.instagram && <Fine>Instagram not connected: posts go to Facebook only. Link the store&apos;s Instagram to its Facebook Page to add it.</Fine>}
      </Section>

      <Section title="The agent's plan" aside={`${slots.length} posts`}>
        <ul aria-label="Posts to approve" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          {slots.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-[64px] cursor-pointer items-center gap-3 px-4 py-3">
                <span className="w-[5.5rem] shrink-0 text-sm font-semibold tabular-nums">{s.label.replace(/^(\w{3}), \w{3} \d+, /, "$1 ")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] leading-5 font-semibold">{s.title}</span>
                  <span className="block text-[0.8125rem] text-fl-dim">{s.when === "now" && page?.instagram ? "Facebook, Instagram" : "Facebook"}</span>
                </span>
                <input type="checkbox" checked={isOn(s.id)} onChange={(e) => setPicked((v) => ({ ...v, [s.id]: e.target.checked }))} className="size-6 shrink-0 accent-fl-ink" />
              </label>
            </li>
          ))}
        </ul>
        <Fine>Instagram posts at approval time; Meta&apos;s API can&apos;t schedule it, so scheduled posts go to Facebook only. Times are the store&apos;s local time.</Fine>
        {!ready && <Fine>Make the poster and posts first. They go out exactly as you see them.</Fine>}
      </Section>

      {results.length > 0 && (
        <ul aria-label="What happened" role="status" className="flex flex-col gap-1.5 text-sm">
          {results.map((r, i) => (
            <li key={i} className={cn(r.status === "failed" ? "text-fl-bad" : r.status === "skipped" ? "text-fl-dim" : "text-fl-ok")}>
              {r.message}
              {r.link && (
                <>
                  {" "}
                  <a href={r.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-[3px]">
                    Open
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {sending.kind === "error" && (
        <Notice tone="bad" title="Not everything went out">
          {sending.message}
        </Notice>
      )}
      {connection.kind === "connected" && (
        <button type="button" onClick={disconnect} className="self-start text-sm text-fl-dim underline underline-offset-[3px]">
          Disconnect Facebook
        </button>
      )}

      <ActionBar note={sending.kind === "confirm" ? `Post 1 now and schedule ${chosen.length - (isOn("now") ? 1 : 0)} on ${page?.name ?? "the Page"}?` : undefined}>
        {sending.kind === "confirm" ? (
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <button type="button" onClick={() => setSending({ kind: "idle" })} className="h-13 rounded-[12px] border border-fl-line bg-white text-base font-semibold">
              Cancel
            </button>
            <button type="button" onClick={send} className={PRIMARY}>
              Yes, approve
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setSending({ kind: "confirm" })} disabled={!canPost || sending.kind === "sending" || sending.kind === "done"} className={PRIMARY}>
            {sending.kind === "sending" ? `Posting ${sending.done + 1} of ${chosen.length}...` : sending.kind === "done" ? "Approved" : `Approve ${chosen.length} ${chosen.length === 1 ? "post" : "posts"}`}
          </button>
        )}
      </ActionBar>
    </>
  );
}
