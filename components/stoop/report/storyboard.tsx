import Image from "next/image";
import type { ShotView, StoryboardView } from "@/lib/report/view/types";

// Stub (shared by "Your ad" and Output): the concept preview. Frames when they exist, the shot list
// otherwise. Never framed as a failure.
function Shots({ shots }: { shots: ShotView[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {shots.map((shot) => (
        <li key={shot.scene} className="flex flex-col gap-1 rounded-xl border border-hairline bg-surface p-3 text-sm">
          <span className="font-mono text-xs text-ink-soft">
            Shot {shot.number} · {shot.beat} · {shot.start} to {shot.end} s
          </span>
          <span>{shot.action}</span>
          {shot.overlayText && <span className="text-xs text-ink-soft">On screen: {shot.overlayText}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Storyboard({ view }: { view: StoryboardView }) {
  switch (view.kind) {
    case "frames":
      return (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.frames.map((frame) => (
            <li key={frame.scene} className="overflow-hidden rounded-xl bg-screen">
              <Image src={frame.src} alt={frame.alt} width={360} height={640} unoptimized className="aspect-[9/16] h-auto w-full object-cover" />
            </li>
          ))}
        </ol>
      );
    case "rendering":
      return (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-ink-soft">Storyboard rendering</p>
          <Shots shots={view.shots} />
        </div>
      );
    case "shots":
      return (
        <div className="flex flex-col gap-2">
          {view.paused && <p className="font-mono text-xs text-ink-soft">Storyboards paused today</p>}
          <Shots shots={view.shots} />
        </div>
      );
    case "none":
      return <p className="text-sm text-ink-soft">The concept preview appears once the Creative Director has picked a concept.</p>;
  }
}
