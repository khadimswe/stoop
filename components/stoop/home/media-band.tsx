import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { NumBadge } from "@/components/stoop/floor/kit";
import { FloorReceipts } from "@/components/stoop/floor/receipts";
import type { PickRow } from "@/lib/marketing/landing-stores";
import type { DemoVideo, PilotMedia } from "@/lib/marketing/pilot";
import type { ReceiptView } from "@/lib/report/view/types";
import { PilotVideo } from "./pilot-video";
import { ReceiptLink } from "./receipt-link";

/** What any table gets, said plainly: the video's card, where no one recorded plan sits behind the footage. */
const ANY_TABLE = [
  { title: "Music", note: "Artists Qloo ranks for the city" },
  { title: "Snacks", note: "From a spot down the street, with a Qloo receipt" },
  { title: "Prize wheel", note: "The store's deals, plus local gift cards" },
] as const;

export interface LeadStill {
  title: string;
  /** "18th Street Wireless · Chicago · Sat, Nov 7, 12 to 4 pm". */
  line: string;
  poster: { src: string | null; alt: string };
  picks: PickRow[];
  href: string;
  fictional: string | null;
  receipts: Readonly<Record<string, ReceiptView>>;
}

/**
 * The heart of the landing, full width under the hero: the founder's landscape video of a real
 * table (16:9, edge to edge on phones), or until it is in, the lead example's real plan as a still:
 * its approved poster beside what Stoop picked for its table, each pick with its receipt.
 */
export function MediaBand({ media, still }: { media: PilotMedia | null; still: LeadStill }) {
  if (media) {
    return (
      <section aria-label="A real table" className="mx-auto w-full max-w-[1248px] sm:px-8">
        <figure className="floor-dark overflow-hidden bg-fl-dark text-fl-dark-bright sm:rounded-[24px]">
          <div className="relative aspect-video w-full">
            <PilotVideo media={media} />
            <div className="absolute top-6 right-6 hidden w-[330px] rounded-[20px] bg-white px-5 pt-4 pb-2 text-fl-ink [--ring:#111113] lg:block">
              <p className="text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">What Stoop plans for a table</p>
              <ul className="mt-1 [&>li+li]:border-t [&>li+li]:border-fl-rule">
                {ANY_TABLE.map((row, i) => (
                  <li key={row.title} className="flex items-start gap-3 py-3">
                    <NumBadge n={i + 1} on />
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-semibold">{row.title}</span>
                      <span className="block text-[0.8125rem] text-fl-dim">{row.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <figcaption className="px-4 py-3 text-sm sm:px-6">{media.caption}</figcaption>
        </figure>
      </section>
    );
  }

  return (
    <section aria-label={`A real plan: ${still.title}`} className="mx-auto w-full max-w-[1248px] sm:px-8">
      <FloorReceipts receipts={still.receipts}>
        <figure className="floor-dark relative overflow-hidden bg-fl-dark text-fl-dark-bright sm:rounded-[24px] lg:aspect-video">
          <div className="grid gap-6 px-4 py-8 sm:p-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] md:items-center md:gap-10 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-12">
            {still.poster.src && (
              <Link href={`${still.href}/poster`} className="mx-auto block w-[min(72%,300px)] rounded-[10px] md:w-full md:max-w-[360px] lg:flex lg:h-full lg:w-auto lg:max-w-none lg:items-center">
                <Image
                  src={still.poster.src}
                  alt={still.poster.alt}
                  width={720}
                  height={900}
                  unoptimized
                  loading="lazy"
                  className="aspect-[4/5] h-auto w-full rounded-[10px] bg-fl-dark-2 object-cover lg:h-full lg:max-h-[600px] lg:w-auto"
                />
              </Link>
            )}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-fl-dark-dim">A real plan Stoop made for an example store</p>
                <p className="font-serif text-[1.75rem] leading-[1.1] text-balance lg:text-[2.5rem]">{still.title}</p>
                <p className="text-sm text-fl-dark-dim tabular-nums">{still.line}</p>
              </div>
              <div className="rounded-[20px] bg-white px-5 pt-4 pb-1.5 text-fl-ink [--ring:#111113]">
                <p className="text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">What Stoop picked for this table</p>
                <ul className="mt-1 [&>li+li]:border-t [&>li+li]:border-fl-rule">
                  {still.picks.map((row) => (
                    <li key={row.title} className="flex items-start gap-3 py-3">
                      <NumBadge n={row.n} on />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-fl-dim">{row.title}</span>
                        <span className="block text-[0.9375rem] leading-5 font-semibold text-pretty">{row.value}</span>
                        <span className="mt-0.5 block text-[0.8125rem] leading-[18px] text-fl-dim">
                          {row.note}
                          {row.receipt && (
                            <>
                              {" · "}
                              <ReceiptLink receiptKey={row.receipt} href={row.href} className="font-medium whitespace-nowrap text-fl-ink underline underline-offset-[3px]" label={`Why Qloo picked this: ${row.title}`}>
                                Why Qloo picked this
                              </ReceiptLink>
                            </>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <Link href={still.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-fl-signal decoration-2 underline-offset-[5px] hover:decoration-[3px]">
                  See this plan
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                {still.fictional && <p className="text-xs text-fl-dark-dim">{still.fictional}</p>}
              </div>
            </div>
          </div>
        </figure>
      </FloorReceipts>
    </section>
  );
}

/** The longer walkthrough in "How it works": click to play, the browser's own controls, never autoplays. */
export function DemoVideoSlot({ video }: { video: DemoVideo | null }) {
  if (!video) return null;
  return (
    <figure className="overflow-hidden rounded-[20px] bg-fl-dark text-fl-dark-bright">
      <video controls playsInline preload="none" poster={video.poster} className="aspect-video w-full bg-fl-dark">
        {video.webm && <source src={video.webm} type="video/webm" />}
        <source src={video.src} type="video/mp4" />
        {video.captions && <track kind="captions" src={video.captions} srcLang="en" label="English" />}
      </video>
      <figcaption className="px-5 py-3 text-sm">{video.title}</figcaption>
    </figure>
  );
}
