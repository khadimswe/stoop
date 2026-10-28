"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { cn } from "cn";
import { ActionBar, AppBar, Fine, FloorMark, IconSlot, PRIMARY, ScreenBody, ScreenTitle, StatusPill } from "./kit";

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
}

/**
 * My stores, for multi-store and district managers: every store's next event on one list, with its
 * poster, the status as a small pill and one fact. A store with no event yet says so and offers one.
 * One action: "New event".
 */
export function StoresScreen({ stores, nextEvent, note, today }: { stores: readonly StoreCard[]; nextEvent: string | null; note: string; today: string }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const shown = stores.filter((s) => (tab === "upcoming" ? !s.date || s.date >= today : s.date !== null && s.date < today));
  return (
    <>
      <AppBar
        left={
          <IconSlot href="/" label="Stoop home">
            <FloorMark />
          </IconSlot>
        }
        title="Stoop"
        right={
          <IconSlot href="/#how" label="How it works">
            <Menu aria-hidden="true" />
          </IconSlot>
        }
      />
      <ScreenBody>
        <ScreenTitle title="My stores" meta={`${stores.length} stores${nextEvent ? ` · next event ${nextEvent}` : ""}`} />
        <div role="tablist" aria-label="Events" className="inline-grid grid-flow-col gap-0.5 self-start rounded-[10px] bg-fl-band p-[3px]">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("h-8 rounded-[8px] px-3.5 text-sm font-medium capitalize", tab === t ? "bg-white font-semibold text-fl-ink shadow-[0_0_0_1px_var(--color-fl-rule)]" : "text-fl-muted")}
            >
              {t}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-[20px] bg-white px-4 py-3.5 text-[0.9375rem] text-fl-muted">{tab === "past" ? "No past events yet. Log how an event went and it shows here." : "No upcoming events."}</p>
        ) : (
          <ul aria-label="Stores" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            {shown.map((s) => (
              <li key={s.slug}>
                <Link href={s.eventTitle ? s.href : s.blockHref} className="flex gap-4 px-4 py-4 hover:bg-fl-sunk">
                  {s.poster ? (
                    <Image src={s.poster.src} alt="" width={120} height={150} unoptimized className="aspect-[4/5] h-auto w-[60px] shrink-0 rounded-[6px] bg-fl-band object-cover" />
                  ) : (
                    <span aria-hidden="true" className="aspect-[4/5] w-[60px] shrink-0 rounded-[6px] bg-fl-band" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[0.9375rem] leading-5 font-semibold">{s.storeName}</span>
                    <span className="text-[0.8125rem] text-fl-dim">
                      {s.storeNumber && <span className="tabular-nums">{s.storeNumber} · </span>}
                      {s.cityLine}
                    </span>
                    {s.eventTitle ? (
                      <>
                        <span className="mt-1 font-serif text-lg leading-snug text-balance">{s.eventTitle}</span>
                        {s.when && <span className="text-[0.8125rem] text-fl-dim tabular-nums">{s.when}</span>}
                      </>
                    ) : (
                      <span className="mt-1 text-[0.9375rem] text-fl-muted">No event yet. Plan one from the block.</span>
                    )}
                    {(s.status || s.fact) && (
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        {s.status && <StatusPill tone={s.status.tone}>{s.status.label}</StatusPill>}
                        {s.fact && <span className="text-[0.8125rem] text-fl-dim tabular-nums">{s.fact}</span>}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Fine>{note}</Fine>
      </ScreenBody>
      <ActionBar>
        <Link href="/start" className={PRIMARY}>
          New event
        </Link>
      </ActionBar>
    </>
  );
}
