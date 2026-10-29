"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "cn";
import { ActionBar, Fine, FloorHeader, FloorMark, IconSlot, PRIMARY, PRIMARY_INLINE, ScreenTitle, StatusPill, TEXT_LINK } from "./kit";

export interface StoreCard {
  slug: string;
  storeName: string;
  /** "Store 1234": the dealer's own number, for multi-store and district managers. */
  storeNumber: string | null;
  cityLine: string;
  eventTitle: string | null;
  when: string | null;
  /** ISO day of the next event, to split upcoming from past. */
  date: string | null;
  poster: { src: string; alt: string } | null;
  status: { tone: "ok" | "ready" | "draft"; label: string } | null;
  fact: string | null;
  href: string;
  blockHref: string;
  /** A new event for this store: its form. */
  createHref: string;
}

const TABS = ["upcoming", "past"] as const;
type Tab = (typeof TABS)[number];

/**
 * My stores, for multi-store and district managers: every store's next event on one list, with its
 * poster, the status as a small pill and one fact, and for each store its community and a new event.
 * A store with no event yet says so. On desktop the list reads as a table within 1200 px.
 */
export function StoresScreen({ stores, nextEvent, note, today }: { stores: readonly StoreCard[]; nextEvent: string | null; note: string; today: string }) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ upcoming: null, past: null });
  const shown = stores.filter((s) => (tab === "upcoming" ? !s.date || s.date >= today : s.date !== null && s.date < today));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    const next = e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1]! : TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <FloorHeader
        left={
          <IconSlot href="/" label="Stoop home">
            <FloorMark />
          </IconSlot>
        }
        title="My stores"
        store={{ name: "Stoop", city: "My stores" }}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-4 pt-5 pb-8 lg:max-w-[1200px] lg:px-6 lg:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <ScreenTitle title="My stores" meta={`${stores.length} stores${nextEvent ? ` · next event ${nextEvent}` : ""}`} />
          <Link href="/start" className={cn(PRIMARY_INLINE, "hidden lg:inline-flex")}>
            Add a store
          </Link>
        </div>
        <div role="tablist" aria-label="Events" onKeyDown={onKey} className="inline-grid grid-flow-col gap-0.5 self-start rounded-[10px] bg-fl-band p-[3px]">
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={`tab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={cn("h-8 rounded-[8px] px-3.5 text-sm font-medium capitalize", tab === t ? "bg-white font-semibold text-fl-ink shadow-[0_0_0_1px_var(--color-fl-rule)]" : "text-fl-muted")}
            >
              {t}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="rounded-[20px] outline-offset-4">
          {shown.length === 0 ? (
            <p className="rounded-[20px] bg-white px-4 py-3.5 text-[0.9375rem] text-fl-muted">{tab === "past" ? "No past events yet." : "No upcoming events."}</p>
          ) : (
            <div className="overflow-hidden rounded-[20px] bg-white">
              <div aria-hidden="true" className="hidden border-b border-fl-rule px-4 py-2.5 text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase lg:grid lg:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] lg:gap-5">
                <span />
                <span>Store</span>
                <span>Next event</span>
                <span>Status</span>
                <span className="w-[10.5rem]" />
              </div>
              <ul aria-label="Stores" className="[&>li+li]:border-t [&>li+li]:border-fl-rule">
                {shown.map((s) => (
                  <li key={s.slug} className="relative grid grid-cols-[60px_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 hover:bg-fl-sunk lg:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-5">
                    <span className="row-span-3 block aspect-[4/5] w-[60px] self-start overflow-hidden rounded-[6px] bg-fl-dark lg:row-span-1 lg:w-[72px]">
                      {s.poster && <Image src={s.poster.src} alt="" width={144} height={180} unoptimized className="h-full w-full object-cover object-top" />}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Link href={s.eventTitle ? s.href : s.blockHref} className="text-[0.9375rem] leading-5 font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                        {s.storeName}
                        {s.eventTitle && <span className="sr-only">: {s.eventTitle}</span>}
                      </Link>
                      <span className="text-[0.8125rem] text-fl-dim">
                        {s.storeNumber && <span className="tabular-nums">{s.storeNumber} · </span>}
                        {s.cityLine}
                      </span>
                    </span>
                    <span className="col-start-2 flex min-w-0 flex-col gap-0.5 lg:col-start-auto">
                      {s.eventTitle ? (
                        <>
                          <span className="font-serif text-lg leading-snug text-balance">{s.eventTitle}</span>
                          {s.when && <span className="text-[0.8125rem] text-fl-dim tabular-nums">{s.when}</span>}
                        </>
                      ) : (
                        <span className="text-[0.9375rem] text-fl-muted">No event yet.</span>
                      )}
                    </span>
                    <span className="col-start-2 flex flex-wrap items-center gap-2 lg:col-start-auto">
                      {s.status && <StatusPill tone={s.status.tone}>{s.status.label}</StatusPill>}
                      {s.fact && <span className="text-[0.8125rem] text-fl-dim tabular-nums">{s.fact}</span>}
                    </span>
                    <span className="relative z-10 col-start-2 flex items-center gap-4 text-sm lg:col-start-auto lg:w-[10.5rem] lg:justify-end">
                      <Link href={s.blockHref} className={TEXT_LINK}>
                        Community<span className="sr-only"> of {s.storeName}</span>
                      </Link>
                      <Link href={s.createHref} className={TEXT_LINK}>
                        New event<span className="sr-only"> for {s.storeName}</span>
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Fine>{note}</Fine>
      </main>
      <ActionBar className="lg:hidden">
        <Link href="/start" className={PRIMARY}>
          Add a store
        </Link>
      </ActionBar>
    </>
  );
}
