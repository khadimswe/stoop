import { ArrowRight } from "lucide-react";
import Image from "next/image";
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
 * One example store's tab: the verdict (its title and its Qloo-backed picks, each opening a receipt),
 * the budget and date line, then its community map, five steps of its day and its approved poster,
 * and the four cells of how Stoop decided, each with the run's own numbers.
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
          <ul className="mt-3 flex flex-wrap gap-x-2 text-sm text-fl-dark-dim tabular-nums">
            {show.meta.map((m, i) => (
              <li key={m} className="flex gap-2">
                {i > 0 && <span aria-hidden="true">·</span>}
                {m}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_280px]">
          {show.map && (
            <div className="relative h-[300px] overflow-hidden rounded-[20px] md:col-span-2 md:h-[360px] lg:col-span-1 lg:h-auto lg:min-h-[420px]">
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

          <section aria-label={`The day at ${show.storeName}`} className="flex flex-col rounded-[20px] bg-white px-5 pt-4 pb-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[1.0625rem] font-semibold">The day</h3>
              <p className="text-[0.8125rem] text-fl-dim">
                {show.day.length < show.daySteps ? `${show.day.length} of ${show.daySteps} steps` : `${show.daySteps} steps`}
              </p>
            </div>
            <ol className="mt-1 text-sm leading-[1.4] [&>li+li]:border-t [&>li+li]:border-fl-rule">
              {show.day.map((d) => (
                <li key={d.time} className="flex gap-3 py-2.5">
                  <span className="w-11 shrink-0 font-semibold tabular-nums">{d.clock}</span>
                  <span className="min-w-0 text-pretty">
                    {d.label && <b className="font-semibold">{d.label}. </b>}
                    {d.text}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <figure className="flex flex-col items-center gap-2.5">
            {show.poster.src && (
              <Link href={show.hrefs.poster} className="block w-full max-w-[300px] rounded-[10px] md:max-w-none">
                <Image src={show.poster.src} alt={show.poster.alt} width={720} height={900} unoptimized loading="lazy" className="aspect-[4/5] h-auto w-full rounded-[10px] bg-fl-dark object-cover" />
              </Link>
            )}
            <figcaption className="text-center text-[0.8125rem] text-fl-dim">The poster and posts come with the plan</figcaption>
          </figure>
        </div>

        <dl className="grid gap-x-6 gap-y-4 rounded-[20px] bg-white px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {show.decided.map((c) => (
            <div key={c.eyebrow} className="flex flex-col gap-1">
              <dt className="text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">{c.eyebrow}</dt>
              <dd className="text-sm leading-[1.4] text-pretty">
                {c.text}
                {c.calls && <span className="text-fl-dim"> {c.calls}.</span>}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <Link href={show.hrefs.event} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
            Open {show.storeName}&apos;s whole plan
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          {show.fictional && <p className="text-xs text-fl-dim">{show.fictional}</p>}
        </div>
      </article>
    </FloorReceipts>
  );
}
