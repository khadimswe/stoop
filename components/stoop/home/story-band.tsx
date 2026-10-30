import Image from "next/image";
import { storyLines, type PilotPhoto, type StoreStory } from "@/lib/marketing/pilot";

/**
 * Right after the hero: the founder's story, a big line and its text, then his name. Words only: no
 * photo sits beside it, so no picture reads as the event it tells. Null renders nothing.
 */
export function StoryBand({ story }: { story: StoreStory | null }) {
  if (!story) return null;
  const { headline, body } = storyLines(story);
  return (
    <section id="story" aria-labelledby="story-title" className="mx-auto w-full max-w-[1248px] px-4 py-16 sm:px-8 lg:py-24">
      <div className="flex max-w-[56rem] flex-col gap-5">
        {/* One sentence per line ("Going outside works." then "Guessing doesn't."), never broken mid-sentence. */}
        <h2 id="story-title" className="font-serif text-[clamp(2rem,1rem+3.9vw,5.25rem)] leading-[1.04] font-normal tracking-[-0.02em]">
          {headline.split(/(?<=\.) /).map((sentence, i) => (
            <span key={sentence} className="block">
              {i > 0 ? ` ${sentence}` : sentence}
            </span>
          ))}
        </h2>
        <p className="max-w-[44rem] text-lg leading-[1.5] text-pretty text-fl-muted lg:text-[1.1875rem]">{body}</p>
        <p className="text-sm font-semibold">{story.credit}</p>
      </div>
    </section>
  );
}

/**
 * The real table: the photo with its caption beside its heading and the first result (always with its
 * label). Only once the store has agreed (PILOT_COPY); null renders nothing. The photo is below the fold
 * and lazy, so the hero's H1 stays the largest paint.
 */
export function RealTable({ title, photo, result, resultLabel }: { title: string; photo: (PilotPhoto & { width: number; height: number }) | null; result: { line: string } | null; resultLabel: string }) {
  if (!photo) return null;
  return (
    <section id="real-table" aria-labelledby="real-table-title" className="scroll-mt-20 border-t border-fl-rule">
      <div className="mx-auto grid max-w-[1248px] gap-8 px-4 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-24">
        <figure className="flex flex-col gap-2.5 lg:order-1">
          <Image src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} unoptimized loading="lazy" className="h-auto w-full rounded-[20px] bg-fl-band" />
          <figcaption className="text-[0.8125rem] text-pretty text-fl-dim">{photo.caption}</figcaption>
        </figure>
        <div className="flex flex-col gap-5 lg:order-2">
          <h2 id="real-table-title" className="font-serif text-[clamp(1.875rem,1.3rem+2.5vw,3.375rem)] leading-[1.06] font-normal tracking-[-0.01em] text-balance">
            {title}
          </h2>
          {result && (
            <p className="flex flex-col gap-2">
              <span className="text-xl leading-[1.4] font-semibold text-pretty lg:text-2xl">{result.line}</span>
              <span className="text-sm text-fl-dim">{resultLabel}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
