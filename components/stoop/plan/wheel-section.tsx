"use client";

import { Printer } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { WheelSliceView, WheelView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { OriginTag } from "./origin-tag";
import { PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

// Print: only the label sheet, on letter paper, nine labels a page. Each label is sized for one
// slice of a common 12 to 18 inch tabletop prize wheel with 8 to 12 slices.
const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 0.35in; }
  body > *:not([data-print-sheet]) { display: none !important; }
  [data-print-sheet] { display: block !important; }
}
@media screen { [data-print-sheet] { display: none !important; } }
`;

function Label({ slice, print = false }: { slice: WheelSliceView; print?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between border-[1.5px] border-dashed border-concrete-line bg-surface text-ink",
        print ? "h-[3.25in] w-[2.45in] break-inside-avoid p-[0.18in]" : "aspect-[2.45/3.25] rounded-md p-3",
      )}
    >
      <span className={cn("font-mono text-ink-soft", print ? "text-[9pt]" : "text-[0.6875rem]")}>
        {slice.n} · {slice.kindLabel}
      </span>
      <span className={cn("font-display leading-[1.02] font-extrabold text-balance [font-stretch:80%]", print ? "text-[26pt]" : "text-[1.375rem]")}>{slice.label}</span>
      <span className={cn("leading-snug text-pretty", print ? "text-[8.5pt]" : "text-[0.6875rem] text-ink-soft")}>{slice.text}</span>
    </div>
  );
}

/** The print sheet, in a portal on body so the print rules can hide everything else. */
function PrintSheet({ wheel, onDone }: { wheel: WheelView; onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener("afterprint", done);
    // One frame for the portal to paint, then the browser's print dialog.
    const frame = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
    };
  }, [onDone]);
  return createPortal(
    <div data-print-sheet>
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap gap-[0.12in]">
        {wheel.slices.map((s) => (
          <Label key={s.n} slice={s} print />
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The prize wheel at the table: the physical tabletop wheel the store already owns. Each slice as the
 * label that goes on it (short label on top, the full terms in small type), in order clockwise from
 * the top, then the rules. Promo slices quote the store's promo exactly; gift-card slices name the
 * Qloo place with its receipt. "Print slice labels" prints one label per slice; there is no digital
 * spinner.
 */
export function WheelSection({ wheel }: { wheel: WheelView }) {
  const [printing, setPrinting] = useState(false);
  const done = useCallback(() => setPrinting(false), []);
  return (
    <PlanSection
      id="wheel"
      kicker="At the table"
      title="Your wheel"
      description={`${wheel.slices.length} slices for the prize wheel you already have, clockwise from the top. Print the labels and tape one on each slice.`}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setPrinting(true)}>
          <Printer aria-hidden="true" />
          Print slice labels
        </Button>
      }
    >
      <ol aria-label="Wheel slices" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {wheel.slices.map((s) => (
          <li key={s.n}>
            <Label slice={s} />
          </li>
        ))}
      </ol>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <ul aria-label="What each slice says, with where it came from" className="flex flex-col border-b border-hairline">
          {wheel.slices.map((s) => (
            <li key={s.n} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-t border-hairline py-3">
              <span className="font-mono text-sm text-ink-soft">{s.n}</span>
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p className="text-pretty">
                  <span className="font-semibold">{s.label}: </span>
                  <RichText parts={s.parts} />
                </p>
                <div>
                  <OriginTag origin={s.origin} receiptKey={s.receipt} context={`slice ${s.n}`} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Wheel rules</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {wheel.rules.map((r) => (
              <li key={r} className="text-pretty before:mr-2 before:content-['•']">
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {printing && <PrintSheet wheel={wheel} onDone={done} />}
    </PlanSection>
  );
}
