"use client";

// Share mode: the Promote step everywhere posting from Stoop is off (and for every example store). The
// same day-grouped timeline as posting mode, each post with its own caption in full and, per row, Copy,
// Facebook's share dialog (the caption is copied first, since Facebook takes only the link), WhatsApp's
// share sheet with that post's words and the event link, Instagram's caption to copy, and the poster
// to save. A chip says "Ready to share", then "Copied" or "Shared" after a tap (kept in this browser
// only). "Remind me" saves a calendar file with an alert at each post's time. Nothing is sent to Stoop.
import { CalendarPlus, Check, Copy, Download } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import { ActionBar, BUTTON2, Fine, Notice, PRIMARY, TEXT_LINK } from "@/components/stoop/floor/kit";
import { typedTextIssues } from "@/lib/plan/guard";
import { posterRoute, type MarketingView } from "@/lib/plan/view/plan";
import { rowShareLinks, timelineRows, type TimelineDay, type TimelineId, type TimelineRow } from "@/lib/plan/view/promote";
import { cn } from "cn";
import { AccountRow, AccountsCard, Chip, PostRow, ROW_BUTTON, saveReminders, Timeline, TwoColumns } from "./timeline";

type Status = "ready" | "copied" | "shared";
const STATUS_TEXT: Record<Status, string> = {
  ready: "Ready to share",
  copied: "Copied",
  shared: "Shared",
};

/** What one browser remembers of its taps, per plan: never sent anywhere. */
function useTapped(planId: string) {
  const key = `stoop:promote:${planId}`;
  const [tapped, setTapped] = useState<Partial<Record<TimelineId, Status>>>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage after the first render
      if (saved && typeof saved === "object") setTapped(saved as Partial<Record<TimelineId, Status>>);
    } catch {
      // Storage off or unreadable: taps are kept for this visit only.
    }
  }, [key]);
  const mark = useCallback(
    (id: TimelineId, status: Exclude<Status, "ready">) =>
      setTapped((prev) => {
        // Shared outranks copied.
        const next = {
          ...prev,
          [id]: prev[id] === "shared" ? "shared" : status,
        };
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Kept for this visit only.
        }
        return next;
      }),
    [key],
  );
  return { tapped, mark };
}

/** Why an edited post can't go out, in plain words, or null. */
function editProblem(text: string): string | null {
  if (!text.trim()) return "A post can't be empty. Write something, or tap Reset.";
  const issue = typedTextIssues(text)[0];
  return issue ? `This can't be shared: ${issue}` : null;
}

export interface ShareModeProps {
  planId: string;
  storeName: string;
  marketing: MarketingView;
  days: readonly TimelineDay[];
  eventUrl: string;
  eventTitle: string;
  /** The poster and posts are still being made (a live plan). */
  making: boolean;
  fictional: string | null;
  header: React.ReactNode;
}

export function ShareMode({ planId, storeName, marketing, days, eventUrl, eventTitle, making, fictional, header }: ShareModeProps) {
  const { tapped, mark } = useTapped(planId);
  const [edits, setEdits] = useState<Partial<Record<TimelineId, string>>>({});
  const [editing, setEditing] = useState<TimelineId | null>(null);
  const [hint, setHint] = useState<{ id: TimelineId; text: string } | null>(null);
  const [calendar, setCalendar] = useState<string | null>(null);
  const sharing = useRef(false);
  const rows = timelineRows(days);
  const posterFull = posterRoute(planId);

  const textOf = (row: TimelineRow) => edits[row.id] ?? row.text;
  const problemOf = (row: TimelineRow) => (edits[row.id] === undefined ? null : editProblem(edits[row.id]!));
  const say = (id: TimelineId, text: string) => {
    setHint({ id, text });
    window.setTimeout(() => setHint((h) => (h?.id === id && h.text === text ? null : h)), 4000);
  };

  const copy = async (row: TimelineRow, text: string, note: string) => {
    if (await copyText(text)) {
      mark(row.id, "copied");
      say(row.id, note);
    } else say(row.id, "Copy didn't work here. Press and hold the text to copy it.");
  };

  const announce = rows.find((r) => r.id === "announce") ?? null;
  // One tap, one share: a second tap while the first is opening does nothing.
  const shareEvent = async () => {
    if (!announce || sharing.current || problemOf(announce)) return;
    sharing.current = true;
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: eventTitle,
            text: textOf(announce),
            url: eventUrl,
          });
          mark("announce", "shared");
        } catch {
          // The manager closed the share sheet.
        }
        return;
      }
      void copyText(textOf(announce));
      window.open(rowShareLinks({ ...announce, whatsapp: textOf(announce) }, eventUrl).facebook, "_blank", "noopener,noreferrer");
      mark("announce", "shared");
      say("announce", "Caption copied. Paste it in Facebook's post box.");
    } finally {
      window.setTimeout(() => (sharing.current = false), 1500);
    }
  };

  const remind = () => {
    const saved = saveReminders(rows, { planId, storeName, eventUrl });
    setCalendar(saved ? "Calendar file saved. Open it to add an alert at each post time." : "Every post time has passed, so there is nothing to add.");
  };

  const primary = (
    <button type="button" onClick={shareEvent} disabled={!announce || making || Boolean(announce && problemOf(announce))} className={PRIMARY}>
      Share the event
    </button>
  );
  const reminders = rows.filter((r) => r.at !== null).length;

  const side = (
    <>
      <AccountsCard>
        <AccountRow glyph={<FacebookGlyph />} on title="Facebook Page" sub="Share dialog: you post it" trail={<Chip tone="draft">One tap</Chip>} />
        <AccountRow glyph={<InstagramGlyph />} on={false} title="Instagram" sub="Caption and poster" trail={<Chip tone="draft">Copy and post</Chip>} />
        <AccountRow glyph={<WhatsAppGlyph />} on={false} title="WhatsApp" sub="Groups and status" trail={<Chip tone="draft">Share sheet</Chip>} />
      </AccountsCard>
      {marketing.poster.medium && (
        <div className="hidden items-center gap-3 rounded-[20px] bg-white p-3 lg:flex">
          <Image src={marketing.poster.thumb ?? marketing.poster.medium} alt="" width={96} height={120} unoptimized className="aspect-[4/5] h-auto w-16 rounded-[6px] bg-fl-band" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[0.9375rem] font-medium">The poster goes with every post</p>
            <a href={posterFull} download="event-poster.png" className={cn(TEXT_LINK, "inline-flex items-center gap-1.5 self-start text-sm")}>
              <Download aria-hidden="true" className="size-4" />
              Save the poster
            </a>
          </div>
        </div>
      )}
      <div className="hidden flex-col gap-2 lg:flex">
        {primary}
        <p className="text-center text-xs text-fl-dim">Every post is ready. You choose where it goes.</p>
      </div>
      {reminders > 0 && (
        <button type="button" onClick={remind} disabled={making} className={BUTTON2}>
          <CalendarPlus aria-hidden="true" />
          Remind me at each post time
        </button>
      )}
      {calendar && <Notice title={calendar} />}
      <Fine>Posting straight to your Facebook Page turns on once Meta approves the app.</Fine>
    </>
  );

  const main = making ? (
    <Notice title="Writing your posts">About a minute. The announcement and each reminder get their own words, with your offers exactly as you typed them.</Notice>
  ) : rows.length === 0 ? (
    <Notice title="No post drafts yet">They&apos;re written from the plan and your offers once the poster is ready.</Notice>
  ) : (
    <>
      <Timeline
        days={days}
        label="Posts and when to share them"
        renderRow={(row) => {
          const text = textOf(row);
          const problem = problemOf(row);
          const status: Status = tapped[row.id] ?? "ready";
          const links = rowShareLinks(
            {
              ...row,
              whatsapp: row.id === "announce" ? (edits.announce ?? row.whatsapp) : text,
            },
            eventUrl,
          );
          const ig = row.instagram.startsWith(row.text) ? `${text}${row.instagram.slice(row.text.length)}` : row.instagram;
          return (
            <PostRow
              key={row.id}
              row={row}
              channels="Facebook, Instagram, WhatsApp"
              chip={
                <Chip tone={status === "ready" ? "draft" : "ok"}>
                  {status !== "ready" && <Check aria-hidden="true" className="mr-1 size-3.5" />}
                  {STATUS_TEXT[status]}
                </Chip>
              }
              media={
                row.id === "announce" && marketing.poster.thumb ? (
                  <Image src={marketing.poster.thumb} alt="" width={128} height={160} unoptimized className="aspect-[4/5] h-auto w-16 rounded-[6px] bg-fl-band" />
                ) : undefined
              }
              actions={
                <>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" disabled={Boolean(problem)} onClick={() => copy(row, text, "Copied.")} className={ROW_BUTTON}>
                      <Copy aria-hidden="true" />
                      Copy
                      <span className="sr-only"> the {row.name.toLowerCase()} post</span>
                    </button>
                    <a
                      href={problem ? undefined : links.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={Boolean(problem)}
                      onClick={(e) => {
                        if (problem) return e.preventDefault();
                        void copyText(text);
                        mark(row.id, "shared");
                        say(row.id, "Caption copied. Paste it in Facebook's post box.");
                      }}
                      className={cn(ROW_BUTTON, problem && "pointer-events-none opacity-60")}
                    >
                      <FacebookGlyph />
                      Facebook
                      <span className="sr-only"> share for the {row.name.toLowerCase()} post (opens in a new tab)</span>
                    </a>
                    <a
                      href={problem ? undefined : links.whatsapp}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={Boolean(problem)}
                      onClick={(e) => (problem ? e.preventDefault() : mark(row.id, "shared"))}
                      className={cn(ROW_BUTTON, problem && "pointer-events-none opacity-60")}
                    >
                      <WhatsAppGlyph />
                      WhatsApp
                      <span className="sr-only"> share for the {row.name.toLowerCase()} post (opens in a new tab)</span>
                    </a>
                    <button type="button" disabled={Boolean(problem)} onClick={() => copy(row, ig, "Caption copied. Save the poster, then post it in Instagram.")} className={ROW_BUTTON}>
                      <InstagramGlyph />
                      Instagram
                      <span className="sr-only"> caption for the {row.name.toLowerCase()} post</span>
                    </button>
                    <a href={posterFull} download="event-poster.png" className={ROW_BUTTON}>
                      <Download aria-hidden="true" />
                      Poster<span className="sr-only"> (save the image)</span>
                    </a>
                  </div>
                  {hint?.id === row.id && (
                    <p role="status" className="text-[0.8125rem] text-fl-ok">
                      {hint.text}
                    </p>
                  )}
                </>
              }
            >
              {editing === row.id ? (
                <textarea
                  aria-label={`${row.name} post text`}
                  value={text}
                  rows={7}
                  maxLength={2000}
                  onChange={(e) => setEdits((v) => ({ ...v, [row.id]: e.target.value }))}
                  className="w-full rounded-[12px] border border-fl-line bg-white p-2 text-[0.875rem] leading-5 text-fl-ink"
                />
              ) : (
                <p className="text-[0.875rem] leading-5 whitespace-pre-line text-fl-muted">{text}</p>
              )}
              {problem && (
                <p role="alert" className="text-sm text-fl-bad">
                  {problem}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button type="button" onClick={() => (editing === row.id ? setEditing(null) : setEditing(row.id))} className={cn(TEXT_LINK, "text-sm")}>
                  {editing === row.id ? "Done" : "Edit text"}
                  <span className="sr-only"> of the {row.name.toLowerCase()} post</span>
                </button>
                {edits[row.id] !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      setEdits((v) => {
                        const rest = { ...v };
                        delete rest[row.id];
                        return rest;
                      });
                      setEditing(null);
                    }}
                    className={cn(TEXT_LINK, "text-sm")}
                  >
                    Reset
                  </button>
                )}
              </div>
            </PostRow>
          );
        }}
      />
      <Fine>
        WhatsApp opens your share sheet: you pick the chats. Send only to people who asked for store texts. Instagram has no share link, so copy the caption, save the poster and post it in the app.
      </Fine>
      {fictional && <Fine>{fictional}</Fine>}
    </>
  );

  return (
    <>
      <TwoColumns header={header} side={side} main={main} />
      <div className="contents lg:hidden">
        <ActionBar note="Every post is ready. You choose where it goes.">{primary}</ActionBar>
      </div>
    </>
  );
}
