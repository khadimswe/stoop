"use client";

import { ChevronLeft, Download, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { apiMessageOf } from "@/lib/plan/view/live";
import { posterRoute, type PlanView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { ActionBar, AppBar, BUTTON2, Fine, IconSlot, Notice, PRIMARY, ScreenTitle, Stepper, type Step } from "./kit";

type Format = "portrait" | "wide";
type Remake = { kind: "idle" } | { kind: "working" } | { kind: "done"; message: string } | { kind: "error"; message: string };

/**
 * Step 4, the poster, on a dark stage so the neon carries: Portrait 4:5 or Wide 1.91:1 (the link
 * preview), Download, and for a live plan "New version". While it is being made it says so.
 */
export function PosterScreen({ view, hrefs, live }: { view: PlanView; hrefs: { back: string; promote: string; steps: Partial<Record<Step, string>> }; live: boolean }) {
  const [format, setFormat] = useState<Format>("portrait");
  const [remake, setRemake] = useState<Remake>({ kind: "idle" });
  const poster = view.marketing.poster;
  const making = poster.status === "queued" || remake.kind === "working";
  const src = format === "portrait" ? poster.src : poster.src ? posterRoute(view.id, "og") : null;
  const title = view.concept?.title ?? view.header.storeName;

  const newVersion = async () => {
    setRemake({ kind: "working" });
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(view.id)}/marketing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body: unknown = await response.json().catch(() => null);
      setRemake(response.ok ? { kind: "done", message: apiMessageOf(body) ?? "A new version is on the way. It shows here when ready." } : { kind: "error", message: apiMessageOf(body) ?? "The poster couldn't be remade. Try again in a minute." });
    } catch {
      setRemake({ kind: "error", message: "No connection. Try again." });
    }
  };

  return (
    <>
      <AppBar
        left={
          <IconSlot href={hrefs.back} label="Back to the event">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Poster"
      />
      <Stepper current="Poster" hrefs={hrefs.steps} />
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-xl px-4 pt-5">
          <ScreenTitle title="Poster" meta={making ? `Making your poster · ${title}` : `Ready · ${title}`} />
        </div>
        <div className="floor-dark mt-5 bg-fl-dark px-8 pt-6 pb-5">
          <div className="mx-auto flex max-w-md flex-col items-center gap-4">
            {making ? (
              <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-[8px] bg-fl-dark-2 text-center text-fl-dark-bright">
                <Loader2 aria-hidden="true" className="size-6 motion-safe:animate-spin" />
                <p className="text-[0.9375rem] font-semibold">Making your poster</p>
                <p className="max-w-[16rem] text-sm text-fl-dark-dim">About a minute. Your words are set by code; only the art is drawn.</p>
              </div>
            ) : src ? (
              <Image
                src={src}
                alt={poster.alt}
                width={format === "portrait" ? 1080 : 1200}
                height={format === "portrait" ? 1350 : 630}
                unoptimized
                priority
                className={cn("h-auto w-full rounded-[8px] bg-fl-dark-2", format === "portrait" ? "aspect-[4/5]" : "aspect-[1.91/1]")}
              />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center rounded-[8px] bg-fl-dark-2 text-sm text-fl-dark-dim">No poster yet</div>
            )}
            <div role="radiogroup" aria-label="Poster format" className="inline-grid grid-flow-col gap-0.5 rounded-[10px] bg-fl-dark-2 p-[3px]">
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
                  className={cn("h-8 rounded-[8px] px-3.5 text-sm font-medium", format === id ? "bg-fl-dark-bright font-semibold text-fl-ink" : "text-fl-dark-dim hover:text-fl-dark-bright")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-5 pb-8">
          <div className="flex gap-3">
            {src && !making && (
              <a href={src} download={format === "portrait" ? "event-poster.png" : "event-poster-wide.png"} className={cn(BUTTON2, "flex-1")}>
                <Download aria-hidden="true" />
                Download
              </a>
            )}
            {live && (
              <button type="button" onClick={newVersion} disabled={making} className={cn(BUTTON2, "flex-1")}>
                New version
              </button>
            )}
          </div>
          {remake.kind === "done" && <Notice title="A new version is on the way">{remake.message}</Notice>}
          {remake.kind === "error" && (
            <Notice tone="bad" title="That didn't work">
              {remake.message}
            </Notice>
          )}
          {view.header.fictional && <Fine>{view.header.fictional}</Fine>}
        </div>
      </main>
      <ActionBar>
        <Link href={hrefs.promote} className={PRIMARY}>
          Promote it
        </Link>
      </ActionBar>
    </>
  );
}
