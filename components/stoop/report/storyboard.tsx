import Image from "next/image";
import type { BriefCueView, ShotView, StoryboardFrameView, StoryboardView } from "@/lib/report/view/output";
import { cn } from "cn";
import { ScrollRegion } from "./output/scroll-region";
import { CueChips } from "./screening/cue-chip";

// The concept preview, shared by "Your ad", Output, the Screening Room and the theater: storyboard
// frames when they exist, otherwise the kept concept's shot list. It is the preview of the ad, never a
// fallback and never "missing".

const BEAT: Record<ShotView["beat"], string> = { hook: "Hook", product: "Product", cultural: "Cultural moment", escalation: "Escalation", payoff: "Payoff" };

/** "Shot 1 · Hook · 0 to 3 s". */
export function shotLabel(shot: Pick<ShotView, "number" | "beat" | "start" | "end">): string {
  return `Shot ${shot.number} · ${BEAT[shot.beat]} · ${shot.start} to ${shot.end} s`;
}

/** The Qloo-backed cues a shot carries, looked up in the world's brief (creative ones stay in the theater). */
export function carriedCues(slots: readonly string[], cues: readonly BriefCueView[], { qlooOnly }: { qlooOnly: boolean }): BriefCueView[] {
  const bySlot = new Map(cues.map((c) => [c.slot as string, c]));
  return slots.map((slot) => bySlot.get(slot)).filter((c): c is BriefCueView => Boolean(c) && (!qlooOnly || c!.receipt !== null));
}

function ShotCard({ shot, cues }: { shot: ShotView; cues: readonly BriefCueView[] }) {
  const carried = carriedCues(shot.carries, cues, { qlooOnly: true });
  return (
    <li className="flex w-[15.5rem] shrink-0 snap-start flex-col gap-2 rounded-xl border border-hairline bg-paper p-3 lg:w-auto lg:shrink">
      <p className="flex items-baseline justify-between gap-2 font-mono text-xs text-ink-soft">
        <span>{`Shot ${shot.number} · ${BEAT[shot.beat]}`}</span>
        <span className="shrink-0">{`${shot.start} to ${shot.end} s`}</span>
      </p>
      <p className="text-sm text-ink">{shot.action}</p>
      {shot.overlayText && (
        <p className="text-xs text-ink-soft">
          On screen: <span className="font-semibold text-ink">&ldquo;{shot.overlayText}&rdquo;</span>
        </p>
      )}
      {carried.length > 0 && <CueChips cues={carried} label="Carries from Qloo:" className="mt-auto border-t border-hairline pt-2.5" />}
    </li>
  );
}

/** The shot list as the concept preview: a sideways shelf on phones, a wrapping grid from lg up. */
export function ShotList({ shots, cues, label }: { shots: ShotView[]; cues: readonly BriefCueView[]; label: string }) {
  return (
    <ScrollRegion label={label} className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5 lg:mx-0 lg:overflow-visible lg:px-0">
      <ol className="flex snap-x gap-2 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
        {shots.map((shot) => (
          <ShotCard key={shot.scene} shot={shot} cues={cues} />
        ))}
      </ol>
    </ScrollRegion>
  );
}

export function FrameGrid({ frames, shots }: { frames: StoryboardFrameView[]; shots: ShotView[] }) {
  const byScene = new Map(shots.map((s) => [s.scene, s]));
  return (
    <ol className="grid grid-cols-4 gap-2">
      {frames.map((frame) => {
        const shot = byScene.get(frame.scene);
        return (
          <li key={frame.scene} className="flex min-w-0 flex-col gap-1">
            <div className="overflow-hidden rounded-xl bg-screen">
              <Image src={frame.src} alt={frame.alt} width={360} height={640} unoptimized className="aspect-[9/16] h-auto w-full object-cover" />
            </div>
            {shot && <p className="truncate font-mono text-[0.6875rem] text-ink-soft">{`${shot.number} · ${BEAT[shot.beat]}`}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The concept preview for one world: frames when they exist, otherwise the shot list. `label` names
 * the world for the shot list's scroll region.
 */
export function Storyboard({ view, cues, label }: { view: StoryboardView; cues: readonly BriefCueView[]; label: string }) {
  switch (view.kind) {
    case "frames":
      return <FrameGrid frames={view.frames} shots={view.shots} />;
    case "rendering":
      return (
        <div className="flex flex-col gap-2">
          <p role="status" className="font-mono text-xs text-ink-soft">
            Storyboard rendering. The shot list is the preview meanwhile.
          </p>
          <ShotList shots={view.shots} cues={cues} label={`Shot list, ${label}`} />
        </div>
      );
    case "shots":
      return (
        <div className="flex flex-col gap-2">
          {view.paused && <p className="font-mono text-xs text-ink-soft">{view.paused}</p>}
          <ShotList shots={view.shots} cues={cues} label={`Shot list, ${label}`} />
        </div>
      );
    case "none":
      return <p className="text-sm text-ink-soft">The concept preview appears once the Creative Director has picked a concept.</p>;
  }
}

/** The first frame when the storyboard has one: the poster for "Your ad" and the screens. */
export function firstFrame(view: StoryboardView): StoryboardFrameView | null {
  return view.kind === "frames" ? (view.frames[0] ?? null) : null;
}

/**
 * The 9:16 concept preview inside a dark screen, sized by its container: the frame 1 image when there
 * is one, otherwise a title card with the hook line and the first shot. Sits in VideoTile's `preview`
 * slot (the tile's own label sits over the top left, so the card leaves room for it).
 */
export function ConceptPoster({
  view,
  hookLine,
  fallbackTitle,
  className,
}: {
  view: StoryboardView;
  hookLine: string | null;
  /** Shown when the first shot has no on-screen line: the concept's title. */
  fallbackTitle: string | null;
  className?: string;
}) {
  const frame = firstFrame(view);
  if (frame) {
    return <Image src={frame.src} alt={frame.alt} width={360} height={640} unoptimized className={cn("size-full object-cover", className)} />;
  }
  const shots = view.kind === "none" ? [] : view.shots;
  const first = shots[0];
  const line = hookLine ?? fallbackTitle;
  return (
    <div
      className={cn(
        "@container flex size-full flex-col justify-between gap-2 bg-screen-raised bg-[radial-gradient(130%_70%_at_50%_0%,rgb(251_245_236/0.10),transparent_65%)] px-[7cqw] pt-[max(2.375rem,22cqw)] pb-[7cqw] text-paper",
        className,
      )}
    >
      {line && (
        <p className="font-display text-[clamp(0.8125rem,9.5cqw,1.5rem)] leading-[1.05] font-extrabold tracking-tight text-balance [font-stretch:85%]">
          {hookLine ? <>&ldquo;{hookLine}&rdquo;</> : line}
        </p>
      )}
      {first && (
        <div className="flex min-h-0 flex-col gap-1">
          <p className="font-mono text-[clamp(0.625rem,5cqw,0.75rem)] text-paper-dim">
            {`Shot ${first.number} · ${BEAT[first.beat]}`}
            <span className="hidden @[10rem]:inline">{` · ${first.start} to ${first.end} s`}</span>
          </p>
          <p className="hidden text-[clamp(0.6875rem,5.5cqw,0.875rem)] leading-snug text-paper-dim @[9rem]:line-clamp-5">{first.action}</p>
          <p className="mt-1 font-mono text-[clamp(0.5625rem,4.5cqw,0.6875rem)] tracking-wider text-paper-dim uppercase">Concept preview</p>
        </div>
      )}
    </div>
  );
}
