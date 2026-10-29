"use client";

import { Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { PILOT_MEDIA } from "@/lib/marketing/pilot";
import { cn } from "cn";

type Media = NonNullable<typeof PILOT_MEDIA>;

/**
 * The hero's 4:5 media slot in a dark frame with a caption bar: the founder's event video (muted loop,
 * plays inline, a poster frame first, tap for sound, captions), or a 3-photo crossfade (still under
 * reduced motion), or until then the lead example's poster.
 */
export function HeroMedia({ media, poster, caption, aside }: { media: Media | null; poster: { src: string; alt: string } | null; caption: string; aside: string }) {
  const reduced = usePrefersReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [photo, setPhoto] = useState(0);
  useEffect(() => {
    if (media?.kind !== "photos" || reduced || media.photos.length < 2) return;
    const t = window.setInterval(() => setPhoto((p) => (p + 1) % media.photos.length), 4000);
    return () => window.clearInterval(t);
  }, [media, reduced]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced) v.pause();
    else void v.play().catch(() => undefined);
  }, [reduced]);

  return (
    <figure className="floor-dark overflow-hidden rounded-[20px] bg-fl-dark">
      <div className="relative aspect-[4/5] w-full">
        {media?.kind === "video" ? (
          <>
            <video ref={video} src={media.src} poster={media.poster} muted={muted} loop playsInline autoPlay={!reduced} preload="metadata" className="absolute inset-0 size-full object-cover">
              {media.captions && <track kind="captions" src={media.captions} srcLang="en" label="English" default />}
            </video>
            <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full bg-fl-dark/80 text-fl-dark-bright">
              {muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
            </button>
          </>
        ) : media?.kind === "photos" ? (
          media.photos.map((p, i) => (
            <Image key={p.src} src={p.src} alt={p.alt} fill unoptimized priority={i === 0} sizes="(min-width: 1024px) 540px, 100vw" className={cn("object-cover transition-opacity duration-700 motion-reduce:transition-none", i === photo ? "opacity-100" : "opacity-0")} />
          ))
        ) : poster ? (
          <Image src={poster.src} alt={poster.alt} fill unoptimized priority sizes="(min-width: 1024px) 540px, 100vw" className="object-contain p-5" />
        ) : null}
      </div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-fl-dark-rule px-4 py-3 text-[0.8125rem]">
        <span className="text-fl-dark-bright">{media?.caption ?? caption}</span>
        <span className="text-fl-dark-dim">{aside}</span>
      </figcaption>
    </figure>
  );
}
