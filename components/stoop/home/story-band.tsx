import Image from "next/image";
import { storyLines, type PilotPhoto, type StoreStory } from "@/lib/marketing/pilot";
import { cn } from "cn";

/**
 * Right after the hero: what happened at the founder's own store, a big line and its story, then his
 * name. With the real table photo (only once the dealer has agreed, PILOT_COPY), it sits beside the
 * words with its caption; without it the band is the words alone. Null renders nothing. The photo is
 * below the fold and lazy, so the hero's H1 stays the largest paint.
 */
export function StoryBand({ story, photo }: { story: StoreStory | null; photo: (PilotPhoto & { width: number; height: number }) | null }) {
  if (!story) return null;
  const { headline, body } = storyLines(story);
  return (
    <section id="story" aria-labelledby="story-title" className="mx-auto w-full max-w-[1248px] px-4 py-16 sm:px-8 lg:py-24">
      <div className={cn("grid gap-10", photo ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16" : "max-w-[52rem]")}>
        <div className="flex flex-col gap-5">
          {/* One sentence per line ("100 ice creams." then "About 5 people."), never broken mid-sentence. */}
          <h2 id="story-title" className="font-serif text-[clamp(2rem,1rem+3.9vw,5.25rem)] leading-[1.04] font-normal tracking-[-0.02em]">
            {headline.split(/(?<=\.) /).map((sentence, i) => (
              <span key={sentence} className="block">
                {i > 0 ? ` ${sentence}` : sentence}
              </span>
            ))}
          </h2>
          <p className="max-w-[40rem] text-lg leading-[1.5] text-pretty text-fl-muted lg:text-[1.1875rem]">{body}</p>
          <p className="text-sm font-semibold">{story.credit}</p>
        </div>
        {photo && (
          <figure className="flex flex-col gap-2.5">
            <Image src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} unoptimized loading="lazy" className="h-auto w-full rounded-[20px] bg-fl-band" />
            <figcaption className="text-[0.8125rem] text-pretty text-fl-dim">{photo.caption}</figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}
