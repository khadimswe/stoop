"use client";

import { ChevronLeft, Download, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useMarketing, versioned } from "@/components/stoop/promote/use-marketing";
import { posterRoute } from "@/lib/plan/view/plan";
import type { PosterScreenView } from "@/lib/plan/view/promote";
import { cn } from "cn";
import { ActionBar, BUTTON2, Fine, FloorHeader, IconSlot, Notice, PRIMARY, ScreenTitle, type Step } from "./kit";

type Format = "portrait" | "wide";

/** The poster at the size it shows: a 360 or 720 px WebP, never the full PNG (that is only for Download). */
function PosterImage({ id, alt, version, format, dim }: { id: string; alt: string; version: string | null; format: Format; dim: boolean }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = format === "portrait" ? versioned(posterRoute(id, "medium"), version)! : versioned(posterRoute(id, "og"), version)!;
  const srcSet = format === "portrait" ? `${versioned(posterRoute(id, "thumb"), version)} 360w, ${src} 720w` : undefined;
  return (
    <div className={cn("relative w-full overflow-hidden rounded-[8px] bg-fl-dark-2", format === "portrait" ? "aspect-[4/5]" : "aspect-[1.91/1]")}>
      {loaded !== src && <div aria-hidden="true" className="absolute inset-0 motion-safe:animate-pulse bg-fl-dark-2" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- the poster route already answers sized WebPs; srcset picks one */}
      <img
        key={src}
        src={src}
        srcSet={srcSet}
        sizes="(min-width: 1024px) 640px, calc(100vw - 64px)"
        alt={alt}
        width={format === "portrait" ? 1080 : 1200}
        height={format === "portrait" ? 1350 : 630}
        decoding="async"
        // An image the browser finished before the page hydrated fires no load event: check it once mounted.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && loaded !== src) setLoaded(src);
        }}
        onLoad={() => setLoaded(src)}
        className={cn("relative h-full w-full object-cover transition-opacity", loaded === src ? "opacity-100" : "opacity-0", dim && "opacity-40")}
      />
    </div>
  );
}

/**
 * Step 4, the poster, on a dark stage so the neon carries: Portrait 4:5 or Wide 1.91:1 (the link
 * preview), Download, and for a live plan "New version" (new background art, same words). While the
 * poster and posts are being made it says so; when the art could not be painted it says why. For
 * anyone but a live plan's owner (`shared`, the notice they see) nothing is made or polled: the
 * poster shows only once it is done, with the notice in place of the "making" state.
 */
export function PosterScreen({ view, hrefs, live, shared = null }: { view: PosterScreenView; hrefs: { back: string; promote: string; steps: Partial<Record<Step, string>> }; live: boolean; shared?: ReactNode }) {
  const [format, setFormat] = useState<Format>("portrait");
  const m = useMarketing(view, live && !shared);
  const poster = m.marketing.poster;
  const making = m.phase === "making" || m.remaking;
  const title = view.concept?.title ?? view.header.storeName;
  const settled = poster.status === "ready" || poster.status === "skipped" || poster.status === "failed";
  const hasPoster = poster.src !== null && (!shared || settled);
  const download = shared && !hasPoster ? null : format === "portrait" ? versioned(posterRoute(view.id), m.version) : versioned(posterRoute(view.id, "og"), m.version);
  const plain = !making && (poster.status === "skipped" || poster.status === "failed");

  const primary = (
    <Link href={hrefs.promote} className={PRIMARY}>
      Promote it
    </Link>
  );

  return (
    <>
      <FloorHeader
        left={
          <IconSlot href={hrefs.back} label="Back to the event">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Poster"
        store={{ name: view.header.storeName, city: view.header.cityLine }}
        step="Poster"
        hrefs={hrefs.steps}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-5 pb-8 lg:max-w-[1200px] lg:px-8">
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-10 lg:gap-y-6">
          <div className="lg:col-span-2">
            <ScreenTitle
              title="Poster"
              meta={shared ? `Shared plan · ${title}` : making ? (m.remaking ? `Painting a new background · ${title}` : `Making your poster and posts · ${title}`) : m.phase === "stalled" ? `Still working · ${title}` : `Ready · ${title}`}
            />
          </div>

          <div className="floor-dark -mx-4 bg-fl-dark px-8 pt-6 pb-6 lg:mx-0 lg:rounded-[20px] lg:px-10 lg:py-10">
            <div className={cn("relative mx-auto flex flex-col items-center", format === "portrait" ? "max-w-md lg:max-w-[min(520px,calc((100dvh-17rem)*0.8))]" : "max-w-[720px]")}>
              {hasPoster ? (
                <PosterImage id={view.id} alt={poster.alt} version={m.version} format={format} dim={making} />
              ) : (
                <div className="flex aspect-[4/5] w-full items-center justify-center rounded-[8px] bg-fl-dark-2 text-sm text-fl-dark-dim">No poster yet</div>
              )}
              {making && (
                <div role="status" className="absolute inset-0 flex items-center justify-center px-6">
                  {/* A solid card, so the message never sits on the poster's own words. */}
                  <div className="flex max-w-[20rem] flex-col items-center gap-3 rounded-[12px] bg-fl-dark px-6 py-5 text-center text-fl-dark-bright">
                    <Loader2 aria-hidden="true" className="size-6 motion-safe:animate-spin" />
                    <p className="text-[0.9375rem] font-semibold">{m.remaking ? "Painting a new background" : "Making your poster and posts"}</p>
                    <p className="text-sm text-fl-dark-dim">About a minute. Your words are set by code; only the background art is drawn.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-20">
            {shared}
            <div role="radiogroup" aria-label="Poster format" className="inline-grid grid-flow-col gap-0.5 self-center rounded-[10px] bg-fl-band p-[3px] lg:self-start">
              {(
                [
                  ["portrait", "Portrait 4:5"],
                  ["wide", "Wide 1.91:1"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={format === id}
                  onClick={() => setFormat(id)}
                  className={cn("h-9 rounded-[8px] px-3.5 text-sm font-medium", format === id ? "bg-white font-semibold text-fl-ink" : "text-fl-muted hover:text-fl-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[0.8125rem] text-fl-dim">{format === "portrait" ? "For Instagram and printing. 1080 by 1350." : "The link preview on Facebook and WhatsApp. 1200 by 630."}</p>
            <div className="flex gap-3">
              {download && !making && (
                <a href={download} download={format === "portrait" ? "event-poster.png" : "event-poster-wide.png"} className={cn(BUTTON2, "flex-1")}>
                  <Download aria-hidden="true" />
                  Download
                </a>
              )}
              {m.remake && !making && (
                <button type="button" onClick={m.remake} className={cn(BUTTON2, "flex-1")}>
                  <RefreshCw aria-hidden="true" />
                  {poster.status === "failed" ? "Try the art again" : "New version"}
                </button>
              )}
            </div>
            {m.remake && !making && <Fine>New version paints a new background. The words stay exactly the same.</Fine>}
            {plain && poster.reason && <Notice title="Clean background">{poster.reason}</Notice>}
            {m.phase === "stalled" && <Notice title="This is taking longer than usual">Reload the page in a minute to see the poster.</Notice>}
            {m.message && (
              <Notice tone={m.message.tone} title={m.message.title}>
                {m.message.text}
              </Notice>
            )}
            <div className="hidden lg:block">{primary}</div>
            {view.header.fictional && <Fine>{view.header.fictional}</Fine>}
          </div>
        </div>
      </main>
      <div className="contents lg:hidden">
        <ActionBar>{primary}</ActionBar>
      </div>
    </>
  );
}
