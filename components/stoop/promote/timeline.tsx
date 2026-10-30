"use client";

// The Promote step's shared pieces: the accounts card, the day-grouped timeline of posts (the same rows
// in share mode and when posting from Stoop), the channel switch that shows each channel's own words,
// the clock the timeline reads, the two-column desktop layout, and the calendar file of reminders.
import { Check } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import { StatusPill } from "@/components/stoop/floor/kit";
import { CHANNEL_NAMES, remindersCalendar, type ShareChannel, type TimelineDay, type TimelineRow } from "@/lib/plan/view/promote";
import { cn } from "cn";

// --- The time, to the minute, once the browser knows it ----------------------------------------------

const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
function subscribeMinutes(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}

/** Now, to the minute, in the browser; null while the page renders on the server (every time shows then). */
export function useMinuteNow(): number | null {
  return useSyncExternalStore(subscribeMinutes, minuteNow, () => null);
}

// --- The accounts card --------------------------------------------------------------------------------

export function AccountRow({ glyph, on, title, sub, trail }: { glyph: ReactNode; on: boolean; title: string; sub?: string; trail: ReactNode }) {
  return (
    <li className="flex min-h-[60px] items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]", on ? "bg-fl-ink text-white" : "bg-fl-band text-fl-ink")}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] leading-5 font-medium">{title}</span>
        {sub && <span className="block truncate text-[0.8125rem] text-fl-dim">{sub}</span>}
      </span>
      {trail}
    </li>
  );
}

/** An account row's trailing words when there is nothing to tap: plain text, never styled as a button. */
export function AccountNote({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[0.8125rem] text-fl-dim">{children}</span>;
}

export function AccountsCard({ children }: { children: ReactNode }) {
  return (
    <ul aria-label="Accounts" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
      {children}
    </ul>
  );
}

// --- The timeline ----------------------------------------------------------------------------------

export function Chip({ tone, children }: { tone: "ok" | "ready" | "draft"; children: ReactNode }) {
  return <StatusPill tone={tone}>{children}</StatusPill>;
}

/** The posts by day: "Now", then each day's times, each row's caption in full. */
export function Timeline({ days, label, renderRow }: { days: readonly TimelineDay[]; label: string; renderRow: (row: TimelineRow) => ReactNode }) {
  return (
    <div aria-label={label} role="group" className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.label} aria-label={day.label} className="flex flex-col gap-2">
          <h3 className="px-1 text-xs leading-4 font-semibold tracking-[0.06em] text-fl-dim uppercase">{day.label}</h3>
          <ul className="flex flex-col gap-2">{day.rows.map((row) => renderRow(row))}</ul>
        </section>
      ))}
    </div>
  );
}

/** A row's small action buttons: compact enough that three fit on one line on a phone. */
export const ROW_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-fl-line bg-white px-2.5 text-[0.8125rem] font-semibold text-fl-ink hover:bg-fl-sunk disabled:opacity-60 [&_svg]:size-4";

const CHANNEL_GLYPHS: Readonly<Record<ShareChannel, ReactNode>> = { facebook: <FacebookGlyph />, instagram: <InstagramGlyph />, whatsapp: <WhatsAppGlyph /> };
export const channelGlyph = (channel: ShareChannel): ReactNode => CHANNEL_GLYPHS[channel];

/**
 * Which channel's words a post shows: one button per channel, the shown one pressed. A channel the
 * manager already used carries a check ("copied" or "shared", said to screen readers too).
 */
export function ChannelSwitch({ label, channels, value, onChange, used }: { label: string; channels: readonly ShareChannel[]; value: ShareChannel; onChange: (channel: ShareChannel) => void; used?: Partial<Record<ShareChannel, "copied" | "shared">> }) {
  return (
    <div role="group" aria-label={label} className="flex w-full gap-0.5 self-start rounded-[12px] bg-fl-band p-0.5 sm:w-auto">
      {channels.map((channel) => (
        <button
          key={channel}
          type="button"
          aria-pressed={channel === value}
          aria-label={used?.[channel] ? `${CHANNEL_NAMES[channel]}, ${used[channel]}` : undefined}
          onClick={() => onChange(channel)}
          className={cn(
            "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[0.8125rem] font-semibold whitespace-nowrap sm:flex-none [&_svg]:size-3.5",
            channel === value ? "bg-white text-fl-ink ring-1 ring-fl-line" : "text-fl-muted hover:bg-fl-sunk",
          )}
        >
          {channelGlyph(channel)}
          {CHANNEL_NAMES[channel]}
          {used?.[channel] && <Check aria-hidden="true" className="text-fl-ok" />}
        </button>
      ))}
    </div>
  );
}

/**
 * One post: its time and name, a status chip, the channels (or a full-width `bar`, the channel switch),
 * then its caption and whatever the mode adds, and its actions across the row.
 */
export function PostRow({ row, channels, chip, lead, bar, media, children, actions }: { row: TimelineRow; channels?: string; chip: ReactNode; lead?: ReactNode; bar?: ReactNode; media?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-[20px] bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        {lead}
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] leading-5 font-semibold">
            <span className="tabular-nums">{row.clock}</span> · {row.name}
          </p>
          {channels && <p className="text-[0.8125rem] text-fl-dim">{channels}</p>}
        </div>
        <div className="shrink-0">{chip}</div>
      </div>
      {bar}
      <div className={cn("grid items-start gap-3", media ? "grid-cols-[64px_minmax(0,1fr)]" : "grid-cols-1")}>
        {media}
        <div className="flex min-w-0 flex-col gap-2">{children}</div>
      </div>
      {actions}
    </li>
  );
}

// --- The layout: one column on a phone, two from 1024 px ------------------------------------------------

/**
 * The screen body: on a phone one column (header, side, main, in that order); from 1024 px a 1200 px
 * container with the main column on the left and the side column (accounts, poster, the primary
 * action) sticky on the right.
 */
export function TwoColumns({ header, side, main }: { header: ReactNode; side: ReactNode; main: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-5 pb-8 lg:max-w-[1200px] lg:px-8">
      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-10 lg:gap-y-6">
        <div className="lg:col-start-1 lg:row-start-1">{header}</div>
        <aside className="flex flex-col gap-5 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">{side}</aside>
        <div className="flex min-w-0 flex-col gap-7 lg:col-start-1 lg:row-start-2">{main}</div>
      </div>
    </div>
  );
}

// --- The calendar file -------------------------------------------------------------------------------

/** Saves one .ics file with an event at each reminder's time. False when there is no reminder left. */
export function saveReminders(rows: readonly TimelineRow[], options: { planId: string; storeName: string; eventUrl: string }): boolean {
  const ics = remindersCalendar(rows, { ...options, stamp: new Date() });
  if (!ics) return false;
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "post-reminders.ics";
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
