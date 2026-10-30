import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BlockMap } from "@/components/stoop/floor/block-map";
import { FloorReceipts } from "@/components/stoop/floor/receipts";
import type { StoreShowcase } from "@/lib/marketing/landing-stores";
import type { ReceiptView } from "@/lib/report/view/types";
import { CommunityPlot } from "./community-plot";
import { ReceiptLink } from "./receipt-link";

/**
 * One example store's tab: the event's title with its budget, free-to-play and date line, then its three
 * picks as cards (Music, Food, Prize game, every name and number from the recorded plan, each with its
 * "Why Qloo picked this" receipt) beside the map of the places Qloo found, and a way into the whole plan.
 */
export function StorePanel({ show, receipts }: { show: StoreShowcase; receipts: Readonly<Record<string, ReceiptView>> }) {
  return (
    <FloorReceipts receipts={receipts}>
      <article aria-label={`${show.storeName}, ${show.city}`} className="flex flex-col gap-4">
        <div className="floor-dark rounded-[20px] bg-fl-dark px-5 py-5 text-fl-dark-bright sm:px-7 sm:py-6">
          <p className="font-serif text-[1.5rem] leading-[1.2] text-balance sm:text-[1.875rem] lg:text-[2.25rem]">{show.title}</p>
          <ul className="mt-3 flex flex-col gap-0.5 text-sm text-fl-dark-dim tabular-nums sm:flex-row sm:flex-wrap sm:gap-x-2">
            {show.meta.map((m, i) => (
              <li key={m} className="flex gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="max-sm:hidden">
                    ·
                  </span>
                )}
                {m}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <ul aria-label={`What Qloo picked for ${show.storeName}`} className="flex flex-col gap-3">
            {show.picks.map((p) => (
              <li key={p.title} className="flex flex-col gap-1 rounded-[16px] bg-white px-5 py-4">
                <p className="text-xs font-semibold tracking-[0.06em] text-fl-dim uppercase">{p.title}</p>
                {/* The pick itself opens its receipt: why Qloo picked this, with the exact request one tap further. */}
                <p className="text-[1.0625rem] leading-[1.35] font-semibold text-pretty">
                  <ReceiptLink receiptKey={p.receipt} href={p.href} label={`Why Qloo picked this: ${p.title}`} className="rounded-[4px] underline decoration-fl-signal decoration-[3px] underline-offset-[5px] hover:decoration-[5px]">
                    {p.value}
                  </ReceiptLink>
                </p>
                <p className="font-mono text-[0.8125rem] leading-[1.45] text-pretty text-fl-dim">{p.note}</p>
              </li>
            ))}
          </ul>
          {show.map && (
            <div className="relative h-[280px] overflow-hidden rounded-[20px] md:h-[360px] lg:h-auto lg:min-h-[420px]">
              <BlockMap center={show.map.center} radiusM={show.map.radiusM} places={show.map.pins} interactive={false} label={show.map.label} className="h-full" />
              <noscript>
                <div className="absolute inset-0 z-10">
                  <CommunityPlot center={show.map.center} radiusM={show.map.radiusM} pins={show.map.pins} label={show.map.label} />
                </div>
              </noscript>
              <p className="pointer-events-none absolute top-3 left-3 z-20 inline-flex h-7 items-center gap-2 rounded-full border border-fl-line bg-white px-3 text-xs font-medium">
                <i aria-hidden="true" className="block size-2 rounded-[2px] bg-fl-ink" />
                {show.map.chip}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <Link
            href={show.hrefs.event}
            aria-label={`Open the plan for ${show.storeName}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            Open the plan
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          {show.fictional && <p className="text-xs text-pretty text-fl-dim">{show.fictional}</p>}
        </div>
      </article>
    </FloorReceipts>
  );
}
