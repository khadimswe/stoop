"use client";

import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { ReceiptPanel } from "@/components/stoop/receipt-panel";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import type { ScreeningPreviewView } from "@/lib/marketing/landing";
import type { ReceiptView } from "@/lib/report/view/types";
import { cn } from "cn";

/** A measured fact on a tile (the age skew, the setting city): it opens its receipt, or shows nothing without one. */
function Fact({ text, receipt }: { text: string; receipt: ReceiptView | null }) {
  if (!receipt) return null;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button type="button" className="min-h-6 text-left underline decoration-paper-dim/60 underline-offset-2 hover:text-paper pointer-coarse:min-h-11">
        {text}
        <span className="sr-only">: see the receipt</span>
      </button>
    </ReceiptDrawer>
  );
}

/**
 * Beats 2 and 3 on the landing: the lead example's Screening Room (the Control once, then one tile
 * per concept world) with one receipt open next to it, music style by default. Each world's cues
 * switch the open receipt; "See the full receipt" opens every Qloo call behind it. Clips show only
 * once approved; until then each tile is a labeled "Clip coming" still, never an empty player.
 */
export function ScreeningStage({ view }: { view: ScreeningPreviewView }) {
  const { screening, cues } = view;
  const first = screening.worlds.find((w) => (cues[w.segmentId] ?? []).length > 0);
  const [selected, setSelected] = useState(first ? { segmentId: first.segmentId, field: cues[first.segmentId][0].field } : null);
  const open = selected ? cues[selected.segmentId]?.find((c) => c.field === selected.field) : undefined;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <Screen
        role="region"
        aria-label={`Screening Room clips, ${view.brand}`}
        tabIndex={0}
        className="relative flex min-w-0 flex-[1_1_34rem] snap-x scroll-px-4 gap-3 overflow-x-auto p-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:p-5"
      >
        {screening.control && (
          <div className="flex w-40 shrink-0 snap-start flex-col gap-2 sm:w-auto sm:min-w-0">
            <VideoTile label="Control" tone="control" src={screening.control.clip?.src} poster={screening.control.clip?.poster ?? undefined} />
            <p className="text-sm font-semibold text-concrete-screen">Control: the generic AI brief</p>
            <p className="text-xs text-paper-dim">LLM-only brief, same template and model. Not from Qloo.</p>
          </div>
        )}
        {screening.worlds.map((world) => (
          <div key={world.segmentId} className="flex w-40 shrink-0 snap-start flex-col gap-2 sm:w-auto sm:min-w-0">
            <VideoTile label="Culture-made" tone="culture" src={world.clip?.src} poster={world.clip?.poster ?? undefined} />
            <p className="text-sm leading-snug font-semibold text-paper">{world.label}</p>
            <p className="flex flex-wrap gap-x-2 text-xs text-paper-dim">
              {world.skewText && <Fact text={world.skewText} receipt={world.skewReceipt} />}
              {world.settingCity && <Fact text={`set in ${world.settingCity}`} receipt={world.settingReceipt} />}
            </p>
            <ul className="flex flex-col items-start gap-1.5" aria-label={`Receipts for ${world.label}`}>
              {(cues[world.segmentId] ?? []).map((cue) => {
                const pressed = selected?.segmentId === world.segmentId && selected.field === cue.field;
                return (
                  <li key={cue.field}>
                    <button
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => setSelected({ segmentId: world.segmentId, field: cue.field })}
                      className={cn(
                        "inline-flex min-h-9 items-center gap-1.5 rounded-full border-[1.5px] border-dusk-light px-3 text-[0.8125rem] font-semibold transition-colors pointer-coarse:min-h-11",
                        pressed ? "bg-dusk-light text-screen ring-2 ring-paper ring-offset-2 ring-offset-screen" : "text-dusk-light hover:bg-dusk-light/10",
                      )}
                    >
                      <BadgeCheck aria-hidden="true" className="size-3.5 shrink-0" />
                      {cue.label}
                      <span className="sr-only"> receipt, from Qloo</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Screen>
      <p className="-mt-2 w-full text-sm text-ink-soft sm:hidden">Swipe the screen to see each concept world.</p>
      {open && (
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-3 lg:max-w-[24rem]">
          <ReceiptPanel cue={open.summary.cue} title={open.summary.title} rows={open.summary.rows} note={open.summary.note} />
          <ReceiptDrawer receipt={open.receipt}>
            <Button variant="link" size="sm" className="h-11 self-start">
              See the full receipt ({open.receipt.calls} Qloo {open.receipt.calls === 1 ? "call" : "calls"})
            </Button>
          </ReceiptDrawer>
        </div>
      )}
    </div>
  );
}
