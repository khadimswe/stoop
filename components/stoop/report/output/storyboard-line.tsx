import Image from "next/image";
import { STRIP_FRAMES, storyboardSummary, type BriefCueView, type StoryboardView } from "@/lib/report/view/output";
import { Storyboard } from "../storyboard";
import { Disclosures } from "./disclosures";

// The Output section's "Storyboard" line, one line: a strip of up to four frame thumbnails (or
// "Shot list: 5 shots" while no frames exist), and "Full board", which opens the whole board below
// the line: the frames with their shots, or every shot with the Qloo cues it carries.

function boardLine(view: StoryboardView, isControl: boolean): string {
  if (view.kind === "frames") return "The concept preview: the storyboard frames from this pack.";
  if (isControl) return "The concept preview, shot by shot. Its brief came from an LLM with no Qloo data, so no shot carries a Qloo cue.";
  return "The concept preview, shot by shot, with the Qloo cues each shot carries.";
}

export function StoryboardLine({ view, cues, label, isControl }: { view: StoryboardView; cues: readonly BriefCueView[]; label: string; isControl: boolean }) {
  const summary = storyboardSummary(view);
  if (view.kind === "none" || summary === null) {
    return <p className="flex min-h-11 items-center text-sm text-ink-soft sm:min-h-9">The concept preview appears once the Creative Director has picked a concept.</p>;
  }
  const lead = (
    <p className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 pl-3 text-sm sm:min-h-9">
      {view.kind === "frames" && (
        // Decorative: the full board below names every frame.
        <span aria-hidden="true" className="flex gap-1">
          {view.frames.slice(0, STRIP_FRAMES).map((frame) => (
            <span key={frame.scene} className="block h-10 w-[1.375rem] overflow-hidden rounded-[3px] bg-screen">
              <Image src={frame.src} alt="" width={44} height={80} unoptimized className="size-full object-cover" />
            </span>
          ))}
        </span>
      )}
      <span>{summary}</span>
      {view.kind === "shots" && view.paused && <span className="font-mono text-xs text-ink-soft">{view.paused}</span>}
    </p>
  );
  return (
    <Disclosures
      className="-ml-3"
      lead={lead}
      items={[
        {
          key: "board",
          label: "Full board",
          name: `Full board, ${label}`,
          content: (
            <div className="flex flex-col gap-2 pl-3">
              <p className="text-sm text-ink-soft">{boardLine(view, isControl)}</p>
              <Storyboard view={view} cues={cues} label={label} />
            </div>
          ),
        },
      ]}
    />
  );
}
