"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { PilotMedia } from "@/lib/marketing/pilot";

const noSubscription = () => () => {};

/**
 * The founder's landscape video, filling its 16:9 frame: a muted loop that plays inline once it is on
 * screen (so it never competes with the hero for the first paint) and pauses when it scrolls away,
 * with a button for sound. Under reduced motion it waits on its first frame with a play button.
 * Without JavaScript the browser's own controls show instead.
 */
export function PilotVideo({ media }: { media: PilotMedia }) {
  const video = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  // Once someone pauses it, scrolling back never starts it again.
  const userPaused = useRef(false);

  useEffect(() => {
    const v = video.current;
    if (!v || reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !userPaused.current) void v.play().catch(() => undefined);
        else if (!entry?.isIntersecting) v.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <>
      <video
        ref={video}
        muted={muted}
        loop
        playsInline
        preload="none"
        poster={media.poster}
        controls={!hydrated}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label={media.caption}
        className="absolute inset-0 size-full object-cover"
      >
        {media.webm && <source src={media.webm} type="video/webm" />}
        <source src={media.src} type="video/mp4" />
        {media.captions && <track kind="captions" src={media.captions} srcLang="en" label="English" default />}
      </video>
      {hydrated && !playing && reduced && (
        <button
          type="button"
          onClick={() => {
            userPaused.current = false;
            void video.current?.play().catch(() => undefined);
          }}
          aria-label="Play the video"
          className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-fl-dark text-fl-dark-bright hover:bg-fl-dark-2"
        >
          <Play aria-hidden="true" className="ml-1 size-7" />
        </button>
      )}
      {hydrated && (
        <div className="absolute right-3 bottom-3 flex gap-2 sm:right-5 sm:bottom-5">
          {/* Pause and play: the loop moves on its own, so it can always be stopped (and stays stopped). */}
          <button
            type="button"
            onClick={() => {
              const v = video.current;
              if (!v) return;
              if (v.paused) {
                userPaused.current = false;
                void v.play().catch(() => undefined);
              } else {
                userPaused.current = true;
                v.pause();
              }
            }}
            aria-label={playing ? "Pause the video" : "Play the video"}
            className="flex size-11 items-center justify-center rounded-full bg-fl-dark text-fl-dark-bright hover:bg-fl-dark-2"
          >
            {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="ml-0.5 size-5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              const v = video.current;
              setMuted((m) => !m);
              if (v?.paused) {
                userPaused.current = false;
                void v.play().catch(() => undefined);
              }
            }}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            aria-pressed={!muted}
            className="flex size-11 items-center justify-center rounded-full bg-fl-dark text-fl-dark-bright hover:bg-fl-dark-2"
          >
            {muted ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
          </button>
        </div>
      )}
    </>
  );
}
