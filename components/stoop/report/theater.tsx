"use client";

import { X } from "lucide-react";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { Chip } from "@/components/stoop/chip";
import { CopyButton } from "@/components/stoop/copy-button";
import { VideoTile } from "@/components/stoop/video-tile";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { TheaterShotView, TheaterView } from "@/lib/report/view/screening";
import { CueChip, CueChips } from "./screening/cue-chip";
import { Fact } from "./screening/fact";
import { carriedCues, ConceptPoster, shotLabel } from "./storyboard";

const noSubscription = () => () => {};

/** What the player shows, in words: the clip, frame 1 of the storyboard, or the title card. */
function playerCaption(view: TheaterView): string {
  if (view.clip) return "AI-generated, rendered from the approved Production Pack.";
  if (view.storyboard.kind === "frames") return "Storyboard frame 1, the concept preview. The prompt below renders the clip.";
  return "The concept preview: the hook line and the first shot. The prompt below renders the clip.";
}

/** Opening the theater stops whatever plays on the page: one clip at a time. */
function pauseAll() {
  for (const video of document.querySelectorAll("video")) video.pause();
}

function Shot({ shot, view }: { shot: TheaterShotView; view: TheaterView }) {
  const carried = carriedCues(shot.carries, view.cues, { qlooOnly: false });
  return (
    <li className="flex flex-col gap-1.5 border-b border-hairline py-3 last:border-b-0">
      <p className="font-mono text-xs text-ink-soft">{shotLabel(shot)}</p>
      <p className="text-sm text-ink">{shot.action}</p>
      {shot.overlayText && (
        <p className="text-xs text-ink-soft">
          On screen: <span className="font-semibold text-ink">&ldquo;{shot.overlayText}&rdquo;</span>
        </p>
      )}
      {shot.dialogue && (
        <p className="text-xs text-ink-soft">
          Line, in the brand&apos;s voice: <span className="font-semibold text-ink">&ldquo;{shot.dialogue}&rdquo;</span>
        </p>
      )}
      <ul aria-label={`What shot ${shot.number} carries`} className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-4">
        {carried.map((cue) => (
          <li key={cue.slot} className="flex max-w-full">
            <CueChip cue={cue} />
          </li>
        ))}
        <li className="flex max-w-full">
          <Chip origin="creative" showOrigin>
            Camera: {shot.camera}
          </Chip>
        </li>
      </ul>
    </li>
  );
}

function TheaterBody({ view }: { view: TheaterView }) {
  const qloo = view.cues.filter((c) => c.receipt !== null);
  const creative = view.cues.filter((c) => c.receipt === null);
  const tone = view.isControl ? "control" : "culture";
  return (
    <div className="grid min-h-0 md:h-[min(88dvh,50rem)] md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div data-surface="screen" className="flex flex-row items-center justify-center gap-4 bg-screen px-5 py-4 text-paper md:flex-col md:gap-3 md:py-8">
        <div className="w-full max-w-[8.5rem] shrink-0 md:max-w-[17rem]">
          <VideoTile
            label={view.isControl ? "Control" : "Culture-made"}
            tone={tone}
            src={view.clip?.src}
            poster={view.clip?.poster ?? undefined}
            captions={view.clip?.captions ?? undefined}
            preview={<ConceptPoster view={view.storyboard} hookLine={view.hookLine} fallbackTitle={view.conceptTitle} />}
          />
        </div>
        <p className="max-w-[17rem] text-xs text-paper-dim md:text-center">{playerCaption(view)}</p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col bg-surface">
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 pt-4 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="type-kicker text-ink-soft">Why this ad</p>
            <DialogTitle className="font-display text-xl leading-tight font-extrabold tracking-tight text-ink [font-stretch:85%]">{view.label}</DialogTitle>
            {view.isControl || view.facts.length === 0 ? (
              <DialogDescription className="text-sm text-ink-soft">
                {view.isControl ? "Brief written by an LLM with no Qloo data. Same template, model and settings as the others." : "A concept world Qloo measured."}
              </DialogDescription>
            ) : (
              // The same receipt-backed facts as the Screening Room row, each naming what it measures.
              <DialogDescription asChild>
                <ul className="-my-2 flex flex-wrap gap-x-3 text-sm text-ink-soft">
                  {view.facts.map((fact) => (
                    <li key={fact.text}>
                      <Fact text={fact.text} receipt={fact.receipt} surface="paper" />
                    </li>
                  ))}
                </ul>
              </DialogDescription>
            )}
          </div>
          <DialogClose className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-concrete-line text-ink hover:bg-fill" aria-label="Close">
            <X aria-hidden="true" className="size-4" />
          </DialogClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {view.conceptTitle && (
            <p className="text-sm text-ink-soft">
              <span className="font-semibold text-ink">{view.conceptTitle}</span>, a concept by Stoop&apos;s Creative Director{view.isControl ? "." : ", grounded only in this world's brief."}
            </p>
          )}
          {qloo.length > 0 && <CueChips cues={qloo} label="From Qloo, with receipts:" />}
          {creative.length > 0 && (
            <div className="flex flex-col gap-2">
              <CueChips cues={creative} label={view.isControl ? "The LLM-only brief, not from Qloo:" : "Not from Qloo:"} />
              <p className="text-xs text-ink-soft">Camera moves are creative choices in every ad.</p>
            </div>
          )}
          <section className="flex flex-col" aria-label="Shot by shot">
            <h3 className="text-sm font-semibold">Shot by shot</h3>
            <ol>
              {view.shots.map((shot) => (
                <Shot key={shot.number} shot={shot} view={view} />
              ))}
            </ol>
          </section>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-hairline bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:static">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {view.prompt && <CopyButton text={view.prompt.prompt} label="Copy the prompt that made this" variant="default" size="default" className="focus-visible:outline-solid" />}
            {view.script && <CopyButton text={view.script.script} label="Copy script" variant="ghost" size="default" className="focus-visible:outline-solid" />}
          </div>
          {view.prompt && (
            <p className="hidden text-xs text-ink-soft md:block">
              The {view.prompt.modelName} multi-shot prompt. Asset prompts, every scene prompt and the Director&apos;s Guide are under Export in the Output section.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The theater: the clip (or the concept preview) with "Why this ad" beside it. A dialog from md up, a
 * full-screen sheet on phones (the panel stacks under the player). Both are the same Radix dialog:
 * focus is trapped, Esc closes it and focus returns to the trigger, which is `children`.
 */
export function Theater({ view, children }: { view: TheaterView; children: ReactElement }) {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [open, setOpen] = useState(false);
  const onOpenChange = (next: boolean) => {
    if (next) pauseAll();
    setOpen(next);
  };

  return (
    <Dialog open={mounted && open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {desktop ? (
        <DialogContent showCloseButton={false} className="w-[min(64rem,calc(100%-2rem))] max-w-none gap-0 overflow-hidden rounded-2xl bg-surface p-0 ring-0 sm:max-w-none">
          <TheaterBody view={view} />
        </DialogContent>
      ) : (
        <SheetContent side="bottom" showCloseButton={false} className="h-[100dvh] max-h-[100dvh] gap-0 overflow-y-auto rounded-none border-0 bg-surface p-0">
          <TheaterBody view={view} />
        </SheetContent>
      )}
    </Dialog>
  );
}
