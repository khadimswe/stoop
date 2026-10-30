"use client";

// The Promote step's shared pieces: the accounts card, the day-grouped timeline of posts (the same rows
// in share mode and when posting from Stoop), the clock the timeline reads, the two-column desktop
// layout, and the calendar file of reminders.
import { useSyncExternalStore, type ReactNode } from "react";
import { StatusPill } from "@/components/stoop/floor/kit";
import { remindersCalendar, type TimelineDay, type TimelineRow } from "@/lib/plan/view/promote";
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

/** A row's small action buttons: compact enough that five fit in two lines on a phone. */
export const ROW_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-fl-line bg-white px-2.5 text-[0.8125rem] font-semibold text-fl-ink hover:bg-fl-sunk disabled:opacity-60 [&_svg]:size-4";

/** One post: its time and name, a status chip, the channels, then its caption and whatever the mode adds, and its actions across the row. */
export function PostRow({ row, channels, chip, lead, media, children, actions }: { row: TimelineRow; channels: string; chip: ReactNode; lead?: ReactNode; media?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-[20px] bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        {lead}
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] leading-5 font-semibold">
            <span className="tabular-nums">{row.clock}</span> · {row.name}
          </p>
          <p className="text-[0.8125rem] text-fl-dim">{channels}</p>
        </div>
        <div className="shrink-0">{chip}</div>
      </div>
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
