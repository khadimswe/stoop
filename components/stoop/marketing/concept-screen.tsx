import Image from "next/image";
import { firstFrame } from "@/components/stoop/report/storyboard";
import type { ShotView } from "@/lib/report/view/output";
import type { TheaterView } from "@/lib/report/view/screening";
import { cn } from "cn";

const BEAT: Record<ShotView["beat"], string> = { hook: "Hook", product: "Product", cultural: "Cultural moment", escalation: "Escalation", payoff: "Payoff" };

/**
 * One landing screen's concept preview until its clip is approved, the report's "Your ad" poster in
 * small: frame 1 when the storyboard has frames, else the hook line and the first shot. Always labeled
 * as a concept preview; the Control's label adds, in gray, that it is not from Qloo. Sits in
 * VideoTile's `preview` slot (the tile's own label sits over the top left, so the card leaves room).
 */
export function ConceptScreen({ theater, control = false }: { theater: Pick<TheaterView, "storyboard" | "hookLine" | "conceptTitle">; control?: boolean }) {
  const frame = firstFrame(theater.storyboard);
  const label = (
    <p className={cn("font-mono text-[clamp(0.625rem,4.5cqw,0.6875rem)] leading-snug tracking-wider uppercase", control ? "text-concrete-screen" : "text-paper-dim")}>
      Concept preview
      {control && <span className="block normal-case">Not from Qloo</span>}
    </p>
  );
  if (frame) {
    return (
      <div className="relative size-full">
        <Image src={frame.src} alt={frame.alt} width={360} height={640} unoptimized className="size-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-screen/85 px-[7cqw] py-[5cqw]">{label}</div>
      </div>
    );
  }
  const first = theater.storyboard.kind === "none" ? undefined : theater.storyboard.shots[0];
  const line = theater.hookLine ?? theater.conceptTitle;
  return (
    <div className="flex size-full flex-col justify-between gap-2 bg-screen-raised bg-[radial-gradient(130%_70%_at_50%_0%,rgb(251_245_236/0.10),transparent_65%)] px-[7cqw] pt-[max(2.375rem,22cqw)] pb-[7cqw] text-paper">
      {line && (
        <p className="font-display text-[clamp(0.8125rem,9.5cqw,1.5rem)] leading-[1.05] font-extrabold tracking-tight text-balance [font-stretch:85%]">
          {theater.hookLine ? <>&ldquo;{theater.hookLine}&rdquo;</> : line}
        </p>
      )}
      <div className="flex min-h-0 flex-col gap-1">
        {first && (
          <>
            <p className="font-mono text-[clamp(0.625rem,5cqw,0.75rem)] text-paper-dim">
              {`Shot ${first.number} · ${BEAT[first.beat]}`}
              <span className="hidden @[10rem]:inline">{` · ${first.start} to ${first.end} s`}</span>
            </p>
            <p className="line-clamp-4 text-[clamp(0.6875rem,5.5cqw,0.875rem)] leading-snug text-paper-dim @[12rem]:line-clamp-5">{first.action}</p>
          </>
        )}
        <div className="mt-1">{label}</div>
      </div>
    </div>
  );
}
