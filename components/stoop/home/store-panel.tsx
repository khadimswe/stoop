import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BlockMap } from "@/components/stoop/floor/block-map";
import { FloorReceipts } from "@/components/stoop/floor/receipts";
import type { StoreShowcase } from "@/lib/marketing/landing-stores";
import type { ReceiptView } from "@/lib/report/view/types";
import { CommunityPlot } from "./community-plot";
import { ReceiptLink } from "./receipt-link";

/** A Qloo pick in the dark verdict: underlined in the poster's lime, opening its receipt. */
export const PICK_LINK =
  "rounded-[4px] underline decoration-fl-signal decoration-[3px] underline-offset-[6px] hover:decoration-[5px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-fl-signal";

/**
 * One example store's tab, kept short: the verdict (its title and its Qloo-backed picks, each opening
 * a receipt), the budget and date line and its community map, then a way into the whole plan. The
 * day's timeline and the proof live on the plan itself and in the comparison below; the page's one
 * example poster sits in Promote.
 */
export function StorePanel({ show, receipts }: { show: StoreShowcase; receipts: Readonly<Record<string, ReceiptView>> }) {
  return (
    <FloorReceipts receipts={receipts}>
      <article aria-label={`${show.storeName}, ${show.city}`} className="flex flex-col gap-4">
        <div className="floor-dark rounded-[20px] bg-fl-dark px-5 py-5 text-fl-dark-bright sm:px-7 sm:py-6">
          <p className="font-serif text-[1.375rem] leading-[1.3] text-pretty sm:text-[1.75rem] lg:text-[2.125rem] lg:leading-[1.25]">
            {show.verdict.map((part, i) =>
              part.kind === "text" ? (
                <span key={i}>{part.text}</span>
              ) : (
                <ReceiptLink key={i} receiptKey={part.receipt} href={part.href} className={PICK_LINK} label={`${part.text}: why Qloo picked this`}>
                  {part.text}
                </ReceiptLink>
              ),
            )}
          </p>
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

        {show.map && (
          <div className="relative h-[280px] overflow-hidden rounded-[20px] md:h-[340px] lg:h-[380px]">
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
