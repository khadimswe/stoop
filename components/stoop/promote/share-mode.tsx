"use client";

// Share mode: the Promote step everywhere posting from Stoop is off (and for every example store). The
// same day-grouped timeline as posting mode. Each post shows one channel's own words at a time
// (Facebook, Instagram with its hashtags, WhatsApp with the event link), switched per post, and every
// button sends exactly the words shown: Copy, Facebook's share dialog (the words are copied first,
// since Facebook takes only the link), WhatsApp's share sheet, Instagram's caption to copy, and the
// poster to save. Edits are per post and per channel, checked with the posts guard before anything can
// go, and kept in this browser tab (sessionStorage) so a reload keeps them. A chip says "Ready to
// share", then "Copied" or "Shared" after a tap, and the channel switch marks each channel used (kept
// in this browser only). "Share the event" opens the device's share sheet, or, where the browser has
// none, a small menu: Facebook, WhatsApp, Copy link. "Remind me" saves a calendar file with an alert at
// each post's time. Nothing is sent to Stoop.
import { CalendarPlus, Check, Copy, Download, Link2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import { ActionBar, BUTTON2, Fine, Notice, PRIMARY, TEXT_LINK } from "@/components/stoop/floor/kit";
import { typedTextIssues } from "@/lib/plan/guard";
import { posterRoute, type MarketingView } from "@/lib/plan/view/plan";
import {
  CHANNEL_NAMES,
  channelDraft,
  channelMessage,
  facebookShareUrl,
  postNoun,
  SHARE_CHANNELS,
  timelineRows,
  whatsappShareUrl,
  type ShareChannel,
  type TimelineDay,
  type TimelineId,
  type TimelineRow,
} from "@/lib/plan/view/promote";
import { cn } from "cn";
import { AccountNote, AccountRow, AccountsCard, ChannelSwitch, Chip, PostRow, ROW_BUTTON, saveReminders, Timeline, TwoColumns } from "./timeline";

/** Where a post went: a channel, or the device's share sheet (the app it went to is unknown). */
type Outlet = ShareChannel | "sheet";
type Use = "copied" | "shared";
type Uses = Partial<Record<Outlet, Use>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const OUTLETS: readonly string[] = [...SHARE_CHANNELS, "sheet"];

/** What one browser remembers of its taps, per plan and per channel: never sent anywhere. */
function useTapped(planId: string) {
  const key = `stoop:promote:taps:${planId}`;
  const [tapped, setTapped] = useState<Partial<Record<TimelineId, Uses>>>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
      if (!isRecord(saved)) return;
      const clean: Partial<Record<TimelineId, Uses>> = {};
      for (const [id, uses] of Object.entries(saved)) {
        if (!isRecord(uses)) continue;
        const kept = Object.fromEntries(Object.entries(uses).filter(([outlet, use]) => OUTLETS.includes(outlet) && (use === "copied" || use === "shared")));
        clean[id as TimelineId] = kept as Uses;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage after the first render
      setTapped(clean);
    } catch {
      // Storage off or unreadable: taps are kept for this visit only.
    }
  }, [key]);
  const mark = useCallback(
    (id: TimelineId, outlet: Outlet, use: Use) =>
      setTapped((prev) => {
        const uses = prev[id] ?? {};
        // Shared outranks copied.
        const next = { ...prev, [id]: { ...uses, [outlet]: uses[outlet] === "shared" ? "shared" : use } };
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

const editKey = (id: TimelineId, channel: ShareChannel) => `${id}:${channel}`;

/** The manager's edits, per post and per channel, kept in this browser tab so a reload keeps them. */
function useEdits(planId: string) {
  const key = `stoop:promote:edits:${planId}`;
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      if (!isRecord(saved)) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this tab's storage after the first render
      setEdits(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    } catch {
      // Storage off or unreadable: edits last until the page closes.
    }
  }, [key]);
  /** Sets one channel's words for a post; null (or the draft itself) drops the edit. */
  const setEdit = useCallback(
    (editId: string, text: string | null) =>
      setEdits((prev) => {
        const next = { ...prev };
        if (text === null) delete next[editId];
        else next[editId] = text;
        try {
          window.sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Kept until the page closes.
        }
        return next;
      }),
    [key],
  );
  return { edits, setEdit };
}

/** Why an edited post can't go out, in plain words, or null. */
function editProblem(text: string): string | null {
  if (!text.trim()) return "A post can't be empty. Write something, or tap Reset.";
  const issue = typedTextIssues(text)[0];
  return issue ? `This can't be shared: ${issue}` : null;
}

/** The chip: "Ready to share", "Copied", "Shared on WhatsApp", or "Shared" (more than one place, or the share sheet). */
function statusText(uses: Uses): string {
  const shared = (Object.keys(uses) as Outlet[]).filter((o) => uses[o] === "shared");
  if (shared.length === 1 && shared[0] !== "sheet") return `Shared on ${CHANNEL_NAMES[shared[0]!]}`;
  if (shared.length > 0) return "Shared";
  return Object.values(uses).includes("copied") ? "Copied" : "Ready to share";
}

const CHANNEL_NOTES: Readonly<Record<ShareChannel, string>> = {
  facebook: "Facebook opens its share box with the event page. This text is copied first, for you to paste.",
  instagram: "Instagram has no share link: copy this caption, save the poster, then post both in the app.",
  whatsapp: "Sent exactly as shown, with the event link. You pick the chats.",
};

const MENU_ITEM = "flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[0.9375rem] font-semibold text-fl-ink hover:bg-fl-sunk [&_svg]:size-[18px]";

const noSubscription = () => () => {};
/** Whether this browser has a share sheet; assumed yes on the server so nothing flashes. */
const useCanShare = () => useSyncExternalStore(noSubscription, () => typeof navigator.share === "function", () => true);

/** "Share the event", with the small menu that stands in for a missing share sheet (above the button in the phone's bottom bar). */
function SharePrimary({ disabled, open, menu, onTap, menuFirst = false }: { disabled: boolean; open: boolean; menu: ReactNode; onTap: () => void; menuFirst?: boolean }) {
  const id = useId();
  const canShare = useCanShare();
  const list = open ? (
    <div id={id} role="group" aria-label="Share the announcement on" data-share-menu="" className="flex flex-col rounded-[16px] border border-fl-line bg-white p-1">
      {menu}
    </div>
  ) : null;
  return (
    <div data-share-menu="" className="flex flex-col gap-2">
      {menuFirst && list}
      <button type="button" onClick={onTap} disabled={disabled} aria-expanded={canShare ? undefined : open} aria-controls={open ? id : undefined} className={PRIMARY}>
        Share the event
      </button>
      {!menuFirst && list}
    </div>
  );
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
  const { edits, setEdit } = useEdits(planId);
  const [shown, setShown] = useState<Partial<Record<TimelineId, ShareChannel>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: TimelineId; text: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [menuNote, setMenuNote] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<string | null>(null);
  const sharing = useRef(false);
  const rows = timelineRows(days);
  const posterFull = posterRoute(planId);

  const channelOf = (row: TimelineRow): ShareChannel => shown[row.id] ?? "facebook";
  const wordsOf = (row: TimelineRow, channel: ShareChannel) => edits[editKey(row.id, channel)] ?? channelDraft(row, channel);
  const problemOf = (row: TimelineRow, channel: ShareChannel) => {
    const edit = edits[editKey(row.id, channel)];
    return edit === undefined ? null : editProblem(edit);
  };
  /** Exactly what this channel sends for this post: the words shown, plus WhatsApp's event link line. */
  const messageOf = (row: TimelineRow, channel: ShareChannel) => channelMessage(channel, wordsOf(row, channel), eventUrl);
  const say = (id: TimelineId, text: string) => {
    setHint({ id, text });
    window.setTimeout(() => setHint((h) => (h?.id === id && h.text === text ? null : h)), 4000);
  };

  const copy = async (row: TimelineRow, channel: ShareChannel, note: string) => {
    if (await copyText(messageOf(row, channel))) {
      mark(row.id, channel, "copied");
      say(row.id, note);
    } else say(row.id, "Copy didn't work here. Press and hold the text to copy it.");
  };

  // The menu closes on Escape and on a tap anywhere outside it.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-share-menu]")) setMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menu]);

  const announce = rows.find((r) => r.id === "announce") ?? null;
  const announceChannel = announce ? channelOf(announce) : "facebook";
  const announceProblem = announce ? problemOf(announce, announceChannel) : null;
  // One tap, one share: a second tap while the first is opening does nothing. Without a share sheet,
  // the tap opens the menu instead and nothing is marked until a channel is picked.
  const shareEvent = async () => {
    if (!announce || announceProblem) return;
    setMenuNote(null);
    if (typeof navigator.share !== "function") return setMenu((open) => !open);
    if (sharing.current) return;
    sharing.current = true;
    try {
      await navigator.share({ title: eventTitle, text: wordsOf(announce, announceChannel), url: eventUrl });
      mark("announce", "sheet", "shared");
    } catch {
      // The manager closed the share sheet.
    } finally {
      window.setTimeout(() => (sharing.current = false), 1500);
    }
  };

  const menuItems = announce ? (
    <>
      <a
        href={problemOf(announce, "facebook") ? undefined : facebookShareUrl(eventUrl)}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={Boolean(problemOf(announce, "facebook"))}
        onClick={(e) => {
          if (problemOf(announce, "facebook")) return e.preventDefault();
          void copyText(messageOf(announce, "facebook"));
          mark("announce", "facebook", "shared");
          setShown((v) => ({ ...v, announce: "facebook" }));
          setMenu(false);
          setMenuNote("The announcement's Facebook text is copied. Paste it in Facebook's post box.");
        }}
        className={cn(MENU_ITEM, problemOf(announce, "facebook") && "pointer-events-none opacity-60")}
      >
        <FacebookGlyph />
        Facebook
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <a
        href={problemOf(announce, "whatsapp") ? undefined : whatsappShareUrl(messageOf(announce, "whatsapp"))}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={Boolean(problemOf(announce, "whatsapp"))}
        onClick={(e) => {
          if (problemOf(announce, "whatsapp")) return e.preventDefault();
          mark("announce", "whatsapp", "shared");
          setShown((v) => ({ ...v, announce: "whatsapp" }));
          setMenu(false);
          setMenuNote("WhatsApp opened with the announcement's WhatsApp text.");
        }}
        className={cn(MENU_ITEM, problemOf(announce, "whatsapp") && "pointer-events-none opacity-60")}
      >
        <WhatsAppGlyph />
        WhatsApp
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <button
        type="button"
        onClick={async () => {
          const ok = await copyText(eventUrl);
          setMenu(false);
          setMenuNote(ok ? "Event link copied." : "Copy didn't work here.");
        }}
        className={MENU_ITEM}
      >
        <Link2 aria-hidden="true" />
        Copy link
      </button>
    </>
  ) : null;

  const remind = () => {
    // The calendar carries each post's Facebook words as they stand, edits included.
    const saved = saveReminders(
      rows.map((r) => ({ ...r, text: messageOf(r, "facebook") })),
      { planId, storeName, eventUrl },
    );
    setCalendar(saved ? "Calendar file saved. Open it to add an alert at each post time." : "Every post time has passed, so there is nothing to add.");
  };

  const primaryDisabled = !announce || making || Boolean(announceProblem);
  const note = making ? "Your posts are being written. They show here when ready." : "Every post is ready. You choose where it goes.";
  const noteLine = menuNote ? (
    <p role="status" className="text-center text-xs text-fl-ok">
      {menuNote}
    </p>
  ) : null;
  const reminders = rows.filter((r) => r.at !== null).length;

  const side = (
    <>
      <AccountsCard>
        <AccountRow glyph={<FacebookGlyph />} on title="Facebook Page" sub="Share dialog: you post it" trail={<AccountNote>One tap</AccountNote>} />
        <AccountRow glyph={<InstagramGlyph />} on={false} title="Instagram" sub="Caption and poster" trail={<AccountNote>Copy and post</AccountNote>} />
        <AccountRow glyph={<WhatsAppGlyph />} on={false} title="WhatsApp" sub="Groups and status" trail={<AccountNote>Share sheet</AccountNote>} />
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
        <SharePrimary disabled={primaryDisabled} open={menu} menu={menuItems} onTap={shareEvent} />
        {noteLine}
        <p className="text-center text-xs text-fl-dim">{note}</p>
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
          const channel = channelOf(row);
          const name = CHANNEL_NAMES[channel];
          const id = editKey(row.id, channel);
          const noun = postNoun(row);
          const words = wordsOf(row, channel);
          const message = messageOf(row, channel);
          const problem = problemOf(row, channel);
          const uses = tapped[row.id] ?? {};
          const status = statusText(uses);
          const used = Object.fromEntries(SHARE_CHANNELS.flatMap((c) => (uses[c] ? [[c, uses[c]]] : []))) as Partial<Record<ShareChannel, Use>>;
          const isEditing = editing === id;
          return (
            <PostRow
              key={row.id}
              row={row}
              chip={
                <Chip tone={status === "Ready to share" ? "draft" : "ok"}>
                  {status !== "Ready to share" && <Check aria-hidden="true" className="mr-1 size-3.5" />}
                  {status}
                </Chip>
              }
              media={
                row.id === "announce" && marketing.poster.thumb ? (
                  <Image src={marketing.poster.thumb} alt="" width={128} height={160} unoptimized className="aspect-[4/5] h-auto w-16 rounded-[6px] bg-fl-band" />
                ) : undefined
              }
              bar={
                <ChannelSwitch
                  label={`Channel for the ${noun}`}
                  channels={SHARE_CHANNELS}
                  value={channel}
                  used={used}
                  onChange={(next) => {
                    setShown((v) => ({ ...v, [row.id]: next }));
                    if (editing?.startsWith(`${row.id}:`)) setEditing(null);
                  }}
                />
              }
              actions={
                <>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {channel === "facebook" && (
                      <a
                        href={problem ? undefined : facebookShareUrl(eventUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={Boolean(problem)}
                        onClick={(e) => {
                          if (problem) return e.preventDefault();
                          void copyText(message);
                          mark(row.id, "facebook", "shared");
                          say(row.id, "Text copied. Paste it in Facebook's post box.");
                        }}
                        aria-label={`Share on Facebook: the ${noun}, opens in a new tab`}
                        className={cn(ROW_BUTTON, problem && "pointer-events-none opacity-60")}
                      >
                        <FacebookGlyph />
                        Facebook
                      </a>
                    )}
                    {channel === "whatsapp" && (
                      <a
                        href={problem ? undefined : whatsappShareUrl(message)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={Boolean(problem)}
                        onClick={(e) => (problem ? e.preventDefault() : mark(row.id, "whatsapp", "shared"))}
                        aria-label={`Send on WhatsApp: the ${noun}, opens in a new tab`}
                        className={cn(ROW_BUTTON, problem && "pointer-events-none opacity-60")}
                      >
                        <WhatsAppGlyph />
                        WhatsApp
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(problem)}
                      onClick={() => copy(row, channel, channel === "instagram" ? "Caption copied. Save the poster, then post it in Instagram." : "Copied.")}
                      aria-label={channel === "instagram" ? `Copy caption: the Instagram text of the ${noun}` : `Copy the ${name} text of the ${noun}`}
                      className={ROW_BUTTON}
                    >
                      {channel === "instagram" ? <InstagramGlyph /> : <Copy aria-hidden="true" />}
                      {channel === "instagram" ? "Copy caption" : "Copy"}
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
              {isEditing ? (
                <>
                  <textarea
                    aria-label={`${name} text of the ${noun}`}
                    value={words}
                    rows={7}
                    maxLength={2000}
                    onChange={(e) => setEdit(id, e.target.value === channelDraft(row, channel) ? null : e.target.value)}
                    className="w-full rounded-[12px] border border-fl-line bg-white p-2 text-[0.875rem] leading-5 text-fl-ink"
                  />
                  {channel === "whatsapp" && <p className="text-[0.8125rem] break-all text-fl-dim">The event link goes on the last line: {eventUrl}</p>}
                </>
              ) : (
                <p data-post-text={channel} className="text-[0.875rem] leading-5 break-words whitespace-pre-line text-fl-muted">
                  {message}
                </p>
              )}
              {problem && (
                <p role="alert" className="text-sm text-fl-bad">
                  {problem}
                </p>
              )}
              <p className="text-xs leading-4 text-fl-dim">{CHANNEL_NOTES[channel]}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  onClick={() => setEditing(isEditing ? null : id)}
                  aria-label={isEditing ? `Done editing the ${name} text of the ${noun}` : `Edit the ${name} text of the ${noun}`}
                  className={cn(TEXT_LINK, "text-sm")}
                >
                  {isEditing ? "Done" : "Edit text"}
                </button>
                {edits[id] !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      setEdit(id, null);
                      setEditing(null);
                    }}
                    aria-label={`Reset the ${name} text of the ${noun}`}
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
      <Fine>Send WhatsApp messages only to people who asked for store texts. Your edits stay in this browser tab until you close it; nothing is sent to Stoop.</Fine>
      {fictional && <Fine>{fictional}</Fine>}
    </>
  );

  return (
    <>
      <TwoColumns header={header} side={side} main={main} />
      <div className="contents lg:hidden">
        <ActionBar note={noteLine ?? note}>
          <SharePrimary disabled={primaryDisabled} open={menu} menu={menuItems} onTap={shareEvent} menuFirst />
        </ActionBar>
      </div>
    </>
  );
}
