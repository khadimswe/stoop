"use client";

// Posting mode, "Post it for me", behind ENABLE_META_POSTING: the store's accounts (the Facebook Page,
// its Instagram, and WhatsApp's share sheet), then the same day-grouped timeline as share mode: the
// announcement now and a reminder at each of the plan's times, each with its own caption, each ticked,
// and one "Approve N posts". Every approval asks once more before anything goes. After it, each post
// says what happened: Posted (with its link when Meta gives one), Scheduled for its time, or Skipped
// and why. Instagram can't be scheduled through Meta's API, so it posts only with the announcement at
// approval time, and WhatsApp is the share sheet only; the screen says so. The announcement shows each
// channel's own words (what Facebook and Instagram post, and WhatsApp's message with its event link),
// switched like share mode, read-only: what is shown is exactly what goes. While posting is off on
// this server (the routes answer 404), and while that is being checked, it shows `fallback`: share mode.
import { Check, ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ActionBar, BUTTON2_SM, Fine, Notice, PRIMARY } from "@/components/stoop/floor/kit";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import type { PlanReport } from "@/lib/plan/schema";
import { apiMessageOf } from "@/lib/plan/view/live";
import type { MarketingView } from "@/lib/plan/view/plan";
import { channelDraft, channelMessage, timelineRows, whatsappShareUrl, type ShareChannel, type TimelineDay, type TimelineId, type TimelineRow } from "@/lib/plan/view/promote";
import { META_OUTCOMES, META_RETURN_PARAM, SOCIAL_ROUTES, socialPagesResponseSchema, socialPostResponseSchema, type MetaOutcome, type SocialPagesResponse, type SocialPostResult } from "@/lib/social/api";
import { suggestPostTimes } from "@/lib/social/schedule";
import type { SocialChannel } from "@/lib/social/trail";
import { cn } from "cn";
import { AccountNote, AccountRow, AccountsCard, ChannelSwitch, Chip, PostRow, ROW_BUTTON, Timeline, TwoColumns, useMinuteNow } from "./timeline";

type Page = SocialPagesResponse["pages"][number];
type Connection = { kind: "loading" } | { kind: "off" } | { kind: "error"; message: string } | { kind: "disconnected" } | { kind: "connected"; pages: Page[] };
type Sending = { kind: "idle" } | { kind: "confirm" } | { kind: "sending"; done: number; of: number } | { kind: "done" } | { kind: "error"; message: string };

const OUTCOME_TEXT: Readonly<Record<MetaOutcome, string>> = {
  connected: "Facebook is connected.",
  denied: "Facebook wasn't connected: the permissions weren't allowed.",
  expired: "That Facebook login expired. Connect again.",
  failed: "Facebook couldn't be connected. Try again in a moment.",
};

export interface MetaConnectProps {
  planId: string;
  /** The plan's inputs, for which of its times Meta can still schedule. */
  inputs: PlanReport["inputs"];
  days: readonly TimelineDay[];
  marketing: MarketingView;
  /** The poster and posts are still being made. */
  making: boolean;
  storeName: string;
  /** The public event page, the last line of the WhatsApp message. */
  eventUrl: string;
  header: ReactNode;
  /** Where Facebook sends the manager back; defaults to this page. */
  returnTo?: string;
  /** Shown while posting is off on this server, and while that is being checked: share mode. */
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

const Connected = ({ children = "Connected" }: { children?: ReactNode }) => (
  <Chip tone="ok">
    <Check aria-hidden="true" className="mr-1 size-3.5" />
    {children}
  </Chip>
);

/** "Post 1 now and schedule 3 on 18th Street Wireless?", from what is ticked. */
export function confirmLine(now: boolean, scheduled: number, pageName: string): string {
  const parts = [...(now ? ["post 1 now"] : []), ...(scheduled > 0 ? [`schedule ${scheduled}`] : [])];
  const text = `${parts.join(" and ")} on ${pageName}?`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One post's chip after approval, from what Meta answered for its channels. */
function resultChip(results: readonly SocialPostResult[] | undefined, row: TimelineRow): ReactNode {
  if (!results?.length) return null;
  const posted = results.find((r) => r.status === "posted");
  const scheduled = results.find((r) => r.status === "scheduled");
  const failed = results.find((r) => r.status === "failed");
  if (posted) return <Connected>Posted</Connected>;
  if (scheduled) return <Chip tone="ready">Scheduled for {row.clock}</Chip>;
  if (failed) return <Chip tone="draft">Not posted</Chip>;
  return <Chip tone="draft">Skipped</Chip>;
}

export function MetaConnect({ planId, inputs, days, marketing, making, storeName, eventUrl, header, returnTo, fallback = null }: MetaConnectProps) {
  const [connection, setConnection] = useState<Connection>({ kind: "loading" });
  const [announceShows, setAnnounceShows] = useState<ShareChannel>("facebook");
  const [outcome, setOutcome] = useState<MetaOutcome | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Partial<Record<TimelineId, boolean>>>({});
  const [sending, setSending] = useState<Sending>({ kind: "idle" });
  const [results, setResults] = useState<Partial<Record<TimelineId, SocialPostResult[]>>>({});
  const now = useMinuteNow();

  useEffect(() => {
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
        setConnection({ kind: "off" });
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  // Share mode until the server says posting is on: no flash of a Meta screen that then goes away.
  if (connection.kind === "loading" || connection.kind === "off") return <>{fallback}</>;

  const page = connection.kind === "connected" ? (connection.pages.find((p) => p.id === pageId) ?? null) : null;
  const back = returnTo ?? (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`);
  const rows = timelineRows(days);
  // The times Meta can still schedule right now (at least 10 minutes ahead, with a margin).
  const schedulable = new Set(now === null ? [] : suggestPostTimes({ inputs }, now).map((t) => t.at));
  const canGo = (row: TimelineRow) => row.at === null || schedulable.has(row.at);
  const isOn = (row: TimelineRow) => canGo(row) && picked[row.id] !== false && !results[row.id];
  const chosen = rows.filter(isOn);
  const nowChosen = chosen.some((r) => r.at === null);
  const ready = marketing.posts !== null && marketing.poster.src !== null && !making;
  const canPost = ready && page !== null && page.canPost && chosen.length > 0;
  const finished = sending.kind === "done";

  const send = async () => {
    if (!page) return;
    const list = chosen;
    setSending({ kind: "sending", done: 0, of: list.length });
    for (const [i, row] of list.entries()) {
      // A time is checked again at the tap: a page left open for hours may hold one that has passed.
      if (row.at !== null && !suggestPostTimes({ inputs }).some((t) => t.at === row.at)) {
        setResults((r) => ({ ...r, [row.id]: [{ channel: "facebook", status: "skipped", message: `${row.name}: that time is too close or has passed.`, link: null, error: "schedule" }] }));
        continue;
      }
      const channels: SocialChannel[] = row.at === null && page.instagram ? ["facebook", "instagram"] : ["facebook"];
      try {
        const response = await fetch(SOCIAL_ROUTES.post(planId), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ pageId: page.id, channels, when: row.at ?? "now" }),
        });
        const body: unknown = await response.json().catch(() => null);
        const parsed = socialPostResponseSchema.safeParse(body);
        if (response.status === 404) return setConnection({ kind: "off" });
        if (response.status === 401) setConnection({ kind: "disconnected" });
        if (!response.ok || !parsed.success) return setSending({ kind: "error", message: apiMessageOf(body) ?? "That didn't go through. Nothing else was posted. Try again." });
        setResults((r) => ({ ...r, [row.id]: parsed.data.results }));
      } catch {
        return setSending({ kind: "error", message: "No connection. Nothing else was posted. Try again." });
      }
      setSending({ kind: "sending", done: i + 1, of: list.length });
    }
    setSending({ kind: "done" });
  };

  const disconnect = async () => {
    try {
      const response = await fetch(SOCIAL_ROUTES.disconnect, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) return setSending({ kind: "error", message: "Facebook couldn't be disconnected right now. Try again." });
      setConnection({ kind: "disconnected" });
      setSending({ kind: "idle" });
      setPageId(null);
    } catch {
      setSending({ kind: "error", message: "No connection. Facebook is still connected. Try again." });
    }
  };

  const approveLabel = sending.kind === "sending" ? `Posting ${Math.min(sending.done + 1, sending.of)} of ${sending.of}...` : finished ? "Approved" : `Approve ${chosen.length} ${chosen.length === 1 ? "post" : "posts"}`;
  const primary =
    sending.kind === "confirm" ? (
      <div className="flex flex-col gap-2">
        <p className="text-center text-sm text-fl-muted">{confirmLine(nowChosen, chosen.length - (nowChosen ? 1 : 0), page?.name ?? "the Page")}</p>
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" onClick={() => setSending({ kind: "idle" })} className="h-13 rounded-[12px] border border-fl-line bg-white text-base font-semibold">
            Cancel
          </button>
          <button type="button" onClick={send} className={PRIMARY}>
            Yes, approve
          </button>
        </div>
      </div>
    ) : (
      <button type="button" onClick={() => setSending({ kind: "confirm" })} disabled={!canPost || sending.kind === "sending" || finished} className={PRIMARY}>
        {approveLabel}
      </button>
    );

  const side = (
    <>
      {outcome && <Notice title={OUTCOME_TEXT[outcome]} />}
      {connection.kind === "error" && (
        <Notice tone="bad" title="Facebook check failed">
          {connection.message}
        </Notice>
      )}
      <AccountsCard>
        <AccountRow
          glyph={<FacebookGlyph />}
          on={connection.kind === "connected"}
          title="Facebook Page"
          sub={page ? page.name : connection.kind === "connected" ? "No Page you can post to" : "Not connected"}
          trail={
            page ? (
              <Connected />
            ) : (
              <a href={SOCIAL_ROUTES.start(back)} className={BUTTON2_SM}>
                Connect
              </a>
            )
          }
        />
        <AccountRow
          glyph={<InstagramGlyph />}
          on={Boolean(page?.instagram)}
          title="Instagram"
          sub={page?.instagram ? (page.instagram.username ? `@${page.instagram.username}` : "Linked to the Page") : "Not linked"}
          trail={
            page?.instagram ? (
              <Connected>Linked to the Page</Connected>
            ) : connection.kind === "connected" ? (
              <a href={SOCIAL_ROUTES.start(back)} className={BUTTON2_SM}>
                Connect
              </a>
            ) : null
          }
        />
        <AccountRow glyph={<WhatsAppGlyph />} on={false} title="WhatsApp" sub="Share sheet only: you pick the chats" trail={<AccountNote>From the announcement</AccountNote>} />
      </AccountsCard>
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
      <div className="hidden lg:block">{primary}</div>
      {sending.kind === "error" && (
        <Notice tone="bad" title="Not everything went out">
          {sending.message}
        </Notice>
      )}
      <Fine>Instagram posts only with the announcement, at approval time: Meta&apos;s API can&apos;t schedule it. Scheduled reminders go to the Facebook Page. Times are the store&apos;s local time.</Fine>
      {connection.kind === "connected" && (
        <button type="button" onClick={disconnect} className="self-start text-sm text-fl-dim underline underline-offset-[3px]">
          Disconnect Facebook
        </button>
      )}
    </>
  );

  const main = making ? (
    <Notice title="Writing your posts">About a minute. They go out exactly as you see them here, and only once you approve.</Notice>
  ) : (
    <>
      <Timeline
        days={days}
        label={`The agent's plan: ${chosen.length} of ${rows.length} ${rows.length === 1 ? "post" : "posts"} ticked`}
        renderRow={(row) => {
          const done = results[row.id];
          const go = canGo(row);
          const chip = resultChip(done, row) ?? (go ? <Chip tone={isOn(row) ? "ok" : "draft"}>{isOn(row) ? (row.at === null ? "Posts on approve" : "Scheduled on approve") : "Not included"}</Chip> : <Chip tone="draft">Too soon to schedule</Chip>);
          // The announcement shows each channel's own words; a reminder goes to the Facebook Page only.
          const announcement = row.at === null;
          const channels: ShareChannel[] = announcement ? ["facebook", ...(page?.instagram ? (["instagram"] as const) : []), "whatsapp"] : ["facebook"];
          const shows = channels.includes(announceShows) && announcement ? announceShows : "facebook";
          const message = channelMessage(shows, channelDraft(row, shows), eventUrl);
          return (
            <PostRow
              key={row.id}
              row={row}
              channels={announcement ? undefined : "Facebook"}
              bar={announcement ? <ChannelSwitch label="Channel for the announcement" channels={channels} value={shows} onChange={setAnnounceShows} /> : undefined}
              chip={chip}
              lead={
                <input
                  type="checkbox"
                  aria-label={`Include the ${row.name.toLowerCase()} post`}
                  checked={isOn(row)}
                  disabled={!go || Boolean(done) || sending.kind === "sending"}
                  onChange={(e) => setPicked((v) => ({ ...v, [row.id]: e.target.checked }))}
                  className="mt-0.5 size-5 shrink-0 accent-fl-ink"
                />
              }
            >
              <p data-post-text={shows} className="text-[0.875rem] leading-5 break-words whitespace-pre-line text-fl-muted">
                {message}
              </p>
              {announcement && shows === "whatsapp" && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs leading-4 text-fl-dim">Stoop doesn&apos;t post to WhatsApp. This opens your share sheet with exactly this message: you pick the chats.</p>
                  <a href={whatsappShareUrl(message)} target="_blank" rel="noopener noreferrer" aria-label="Send on WhatsApp: the announcement, opens in a new tab" className={cn(ROW_BUTTON, "self-start")}>
                    <WhatsAppGlyph />
                    Send on WhatsApp
                  </a>
                </div>
              )}
              {done?.map((r, i) => (
                <p key={i} className={cn("text-[0.8125rem]", r.status === "failed" ? "text-fl-bad" : r.status === "skipped" ? "text-fl-dim" : "text-fl-ok")}>
                  {r.message}
                  {r.link && (
                    <>
                      {" "}
                      <a href={r.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-[3px]">
                        Open the post
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </>
                  )}
                </p>
              ))}
            </PostRow>
          );
        }}
      />
      {!ready && <Fine>The poster and posts go out exactly as you see them, once they are ready.</Fine>}
      <Fine>{storeName}&apos;s posts go out only after you approve them, here.</Fine>
    </>
  );

  return (
    <>
      <TwoColumns header={header} side={side} main={main} />
      <div className="contents lg:hidden">
        <ActionBar>{primary}</ActionBar>
      </div>
    </>
  );
}
