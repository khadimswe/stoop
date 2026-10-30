import type { DemoVideo, PilotMedia } from "@/lib/marketing/pilot";
import { PilotVideo } from "./pilot-video";

/**
 * The founder's landscape video of a real table, full width under the hero (16:9, edge to edge on
 * phones), with his caption under it. Null renders nothing: the example stores follow the hero
 * directly, so the page never shows an empty band or a placeholder.
 */
export function MediaBand({ media }: { media: PilotMedia | null }) {
  if (!media) return null;
  return (
    <section aria-label="A real table" className="mx-auto w-full max-w-[1248px] sm:px-8">
      <figure className="floor-dark overflow-hidden bg-fl-dark text-fl-dark-bright sm:rounded-[24px]">
        <div className="relative aspect-video w-full">
          <PilotVideo media={media} />
        </div>
        <figcaption className="px-4 py-3 text-sm sm:px-6">{media.caption}</figcaption>
      </figure>
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
