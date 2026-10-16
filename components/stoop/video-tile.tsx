"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { cn } from "cn";

/**
 * A 9:16 ad clip on a dark screen.
 * - tone "control": the generic ad, framed in concrete and labeled, never relying on color alone.
 * - tone "culture": a culture-made ad, framed in color.
 * - No src yet: a labeled "clip coming" placeholder (never fake media).
 * - Autoplay is muted, skipped under reduced motion, and falls back to "Tap to play" when blocked
 *   (iOS Low Power Mode, in-app browsers).
 */
export function VideoTile({
  label,
  tone,
  src,
  poster,
  captions,
  autoPlay = false,
  muted = true,
  onToggleSound,
  className,
}: {
  label: string;
  tone: "control" | "culture" | "neutral";
  src?: string;
  poster?: string;
  /** WebVTT captions for voiced clips. */
  captions?: string;
  autoPlay?: boolean;
  muted?: boolean;
  /** When provided, the tile shows a sound toggle. The parent decides which single tile has sound. */
  onToggleSound?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  // Set when the viewer pauses, so focus lands on "Tap to play" instead of dropping to the page.
  const focusTapNext = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  // `playing` mirrors the video element's own events; `blocked` means the browser refused autoplay.
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // A viewer's pause wins over autoplay (WCAG 2.2.2: looping motion must be pausable).
  const [userPaused, setUserPaused] = useState(false);
  const wantsAutoplay = autoPlay && !reducedMotion;
  const needsTap = !playing && (!wantsAutoplay || blocked || userPaused);

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    if (!wantsAutoplay) {
      video.pause();
      return;
    }
    if (userPaused) return;
    video.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  }, [wantsAutoplay, src, userPaused]);

  useEffect(() => {
    if (needsTap && focusTapNext.current) {
      focusTapNext.current = false;
      tapRef.current?.focus();
    }
  }, [needsTap]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  const frame =
    tone === "control"
      ? "border-concrete-screen"
      : tone === "culture"
        ? "border-sun"
        : "border-paper/20";

  return (
    <figure className={cn("@container relative aspect-[9/16] overflow-hidden rounded-2xl border-[3px] bg-screen-raised", frame, className)}>
      {src ? (
        <video
          ref={ref}
          className="size-full object-cover"
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload={autoPlay ? "metadata" : "none"}
          onPlay={() => {
            setPlaying(true);
            setUserPaused(false);
          }}
          onPause={() => setPlaying(false)}
          onEmptied={() => setPlaying(false)}
        >
          {captions && <track kind="captions" src={captions} srcLang="en" label="English" default />}
        </video>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
          <span className="font-mono text-[0.6875rem] tracking-widest text-paper-dim uppercase">Clip coming</span>
          <span className="hidden text-xs text-paper-dim @[10rem]:block">Rendered from an approved Production Pack</span>
        </div>
      )}

      <figcaption
        className={cn(
          "absolute top-2 left-2 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold tracking-wide",
          tone === "control" ? "bg-screen/85 text-concrete-screen" : "bg-screen/85 text-paper",
        )}
      >
        {label}
      </figcaption>

      {src && needsTap && (
        <button
          ref={tapRef}
          type="button"
          aria-label={`Tap to play ${label}`}
          onClick={() => {
            void ref.current?.play().catch(() => setBlocked(true));
          }}
          className="absolute inset-0 flex items-center justify-center bg-screen/40"
        >
          <span className="flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm font-bold text-ink">
            <Play aria-hidden="true" className="size-4" />
            Tap to play
          </span>
        </button>
      )}

      {src && playing && (
        <button
          type="button"
          onClick={() => {
            focusTapNext.current = true;
            setUserPaused(true);
            ref.current?.pause();
          }}
          aria-label={`Pause ${label}`}
          className="absolute bottom-2 left-2 flex size-9 items-center justify-center rounded-full bg-screen/85 text-paper"
        >
          <Pause aria-hidden="true" className="size-4" />
        </button>
      )}

      {src && onToggleSound && (
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={muted ? `Turn sound on for ${label}` : `Mute ${label}`}
          aria-pressed={!muted}
          className="absolute right-2 bottom-2 flex size-9 items-center justify-center rounded-full bg-screen/85 text-paper"
        >
          {muted ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}
        </button>
      )}
    </figure>
  );
}
