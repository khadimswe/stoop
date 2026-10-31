import type { DemoVideo, PilotMedia } from "@/lib/marketing/pilot";
import { cn } from "cn";
import { PilotVideo } from "./pilot-video";

/**
 * The founder's video of the first table Stoop planned, in the hero: a dark screen set into the page
 * (16:9, rounded), a muted loop that plays once in view, its poster
 * frame first. A small chip on it says where and when, with "How it went" jumping to the real table
 * section when that section is on the page.
 */
export function HeroVideo({ media, howItWent, className }: { media: PilotMedia; howItWent: string | null; className?: string }) {
  return (
    <figure aria-label={media.caption} className={cn("floor-dark relative overflow-hidden rounded-[20px] bg-fl-dark text-fl-dark-bright", className)}>
      <div className="relative aspect-video w-full">
        <PilotVideo media={media} />
      </div>
      {/* Under the video on smaller screens (it would cover too much of it), a chip on it from desktop up. */}
      <figcaption className="flex flex-wrap items-center gap-x-2 px-3 py-2 text-xs font-medium lg:absolute lg:top-3 lg:left-3 lg:max-w-[calc(100%-1.5rem)] lg:rounded-[10px] lg:bg-white/95 lg:px-2.5 lg:py-1 lg:text-fl-ink lg:[--ring:#111113]">
        <span>{media.caption}</span>
        {howItWent && (
          <a href={howItWent} className="inline-flex min-h-6 items-center font-semibold underline underline-offset-2">
            How it went
          </a>
        )}
      </figcaption>
    </figure>
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
