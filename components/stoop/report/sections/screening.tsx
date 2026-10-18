import { Maximize2 } from "lucide-react";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import type { ScreeningView, ScreeningWorldView, TheaterView } from "@/lib/report/view/screening";
import type { ReceiptView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { CueChips } from "../screening/cue-chip";
import { ConceptPoster } from "../storyboard";
import { Theater } from "../theater";

// The Screening Room, demo beat 2: a dark screen on the paper page. The generic Control is pinned
// once in concrete, then one row per measured world with its skew, its setting city and the Qloo
// cues its ad stands on. One clip plays at a time (VideoTile pauses the others). Until clips are
// approved, each screen shows the concept preview, never a "clip coming" tile. "Open" shows the
// theater: why this ad, shot by shot, and the prompt that made it.

function Fact({ text, receipt }: { text: string; receipt: ReceiptView | null }) {
  if (!receipt) return <span>{text}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button type="button" className="relative rounded-sm underline decoration-paper-dim decoration-1 underline-offset-4 after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:text-paper hover:decoration-paper">
        {text}
        <span className="sr-only"> (open receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}

function Tile({ theater, label, tone, clip }: { theater: TheaterView | null; label: string; tone: "culture" | "control"; clip: ScreeningWorldView["clip"] }) {
  return (
    <VideoTile
      label={label}
      tone={tone}
      src={clip?.src}
      poster={clip?.poster ?? undefined}
      captions={clip?.captions ?? undefined}
      preview={theater ? <ConceptPoster view={theater.storyboard} hookLine={theater.hookLine} fallbackTitle={theater.conceptTitle} /> : undefined}
    />
  );
}

function OpenButton({ theater, name }: { theater: TheaterView | null; name: string }) {
  if (!theater) return null;
  return (
    <Theater view={theater}>
      <Button variant="screen" className="h-11 gap-1.5 self-start focus-visible:outline-solid" aria-label={`Open ${name}: why this ad`}>
        <Maximize2 aria-hidden="true" className="size-4" />
        Open
      </Button>
    </Theater>
  );
}

function WorldRow({ world }: { world: ScreeningWorldView }) {
  return (
    <li className="flex gap-3 rounded-xl bg-screen-raised p-2.5 sm:gap-4 sm:p-3">
      <div className="w-28 shrink-0 sm:w-32">
        <Tile theater={world.theater} label="Culture-made" tone="culture" clip={world.clip} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
        <h3 className="font-display text-base leading-snug font-bold text-paper [font-stretch:90%] sm:text-lg">{world.label}</h3>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-paper-dim">
          {world.skewText && <Fact text={world.skewText} receipt={world.skewReceipt} />}
          {world.topCities && <Fact text={`top cities by lift: ${world.topCities}`} receipt={world.topCitiesReceipt} />}
          {world.settingCity && <Fact text={`set in ${world.settingCity}`} receipt={world.settingReceipt} />}
        </p>
        <CueChips cues={world.cues} surface="screen" label="From Qloo:" />
        <div className="mt-auto pt-1">
          <OpenButton theater={world.theater} name={world.label} />
        </div>
      </div>
    </li>
  );
}

export function ScreeningSection({ view }: { view: ScreeningView }) {
  return (
    <ReportSection
      id={REPORT_SECTIONS.screening}
      title="Screening Room"
      kicker="Data, not stereotypes."
      description="Same product. Same video model. Only the brief changed."
    >
      <Screen variant="app" className="flex flex-col gap-4 p-3 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-5">
          {view.control && (
            <section aria-labelledby="screening-control" className="flex gap-3 rounded-xl border-[1.5px] border-dashed border-concrete-screen p-2.5 sm:gap-4 sm:p-3 lg:flex-col">
              <div className="w-28 shrink-0 sm:w-32 lg:w-full">
                <Tile theater={view.control.theater} label="Control" tone="control" clip={view.control.clip} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h3 id="screening-control" className="text-xs font-bold tracking-wide text-concrete-screen uppercase">
                  Control · shown once
                </h3>
                <p className="text-xs text-paper-dim">Brief written by an LLM with no Qloo data. Same template, model and settings as the others.</p>
                <div className="mt-auto pt-1">
                  <OpenButton theater={view.control.theater} name="the Control" />
                </div>
              </div>
            </section>
          )}
          <section aria-labelledby="screening-worlds" className="flex min-w-0 flex-col gap-3">
            <h3 id="screening-worlds" className="text-xs font-bold tracking-wide text-paper-dim uppercase">
              Culture-made, one per measured audience
            </h3>
            <ul className="flex flex-col gap-3">
              {view.worlds.map((world) => (
                <WorldRow key={world.segmentId} world={world} />
              ))}
            </ul>
          </section>
        </div>
        <p className="text-xs text-paper-dim">One clip plays at a time. Open one to see why each shot was chosen, with the receipts.</p>
      </Screen>
    </ReportSection>
  );
}
