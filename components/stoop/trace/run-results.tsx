import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, SeedChip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { cn } from "cn";
import type { FieldResult, RealitySource, ResultsView, WorldResult } from "@/lib/run/results";

const SOURCE: Record<RealitySource, { label: string; className: string }> = {
  site: { label: "Read from your site · not from Qloo", className: "border-dashed border-concrete-line text-ink-soft" },
  you: { label: "You", className: "border-ink text-ink" },
  qloo: { label: "Qloo", className: "border-dusk bg-dusk text-paper" },
  generic: { label: "Generic AI brief · not from Qloo", className: "border-dashed border-concrete-line text-ink-soft" },
};

/** Grey bars the shape of what is coming; the card's title says what. */
function Bars({ widths }: { widths: string[] }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {widths.map((width, i) => (
        <span key={i} className={cn("h-3 rounded-full bg-fill", width)} />
      ))}
    </div>
  );
}

function Card({ title, kicker, waiting, children, className }: { title: ReactNode; kicker?: ReactNode; waiting?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-0.5">
        {kicker && <p className="font-mono text-xs text-ink-soft">{kicker}</p>}
        <h3 className="font-display text-lg leading-tight font-bold [font-stretch:90%]">{title}</h3>
        {waiting && <p className="sr-only">{waiting}</p>}
      </div>
      {children}
    </section>
  );
}

function FieldChip({ field }: { field: FieldResult }) {
  const label = `${field.label}${field.audienceWide ? " (whole audience)" : ""}${field.signal === "thin" ? " · thin" : ""}`;
  if (!field.origin)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-1 text-[0.8125rem] leading-none font-semibold text-ink-soft">
        {field.label} · No Qloo signal
      </span>
    );
  return <Chip origin={field.origin}>{label}</Chip>;
}

function WorldCard({ world }: { world: WorldResult }) {
  const meta = [world.ageBand && world.skew ? `${world.ageBand} ${world.skew}` : world.ageBand, world.setting ? `set in ${world.setting}` : null].filter(Boolean).join(" · ");
  return (
    <Card kicker={`World ${world.position}`} title={world.label} waiting={world.fields ? undefined : "Culture Brief not written yet."}>
      {meta && <p className="text-sm text-ink-soft">{meta}</p>}
      {world.fields ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Culture Brief fields">
          {world.fields.map((field) => (
            <FieldChip key={field.field} field={field} />
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="flex gap-1.5">
          {["w-16", "w-20", "w-14"].map((w) => (
            <span key={w} className={cn("h-6 rounded-full bg-fill", w)} />
          ))}
        </div>
      )}
      {world.concept ? (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-soft">
            Hook · {world.concept.title}
            <Chip origin="creative" showOrigin className="text-[0.75rem]">
              Concept
            </Chip>
          </p>
          <p className="font-display text-[1.0625rem] leading-snug font-bold [font-stretch:90%]">{world.concept.hook}</p>
        </div>
      ) : (
        world.fields && <Bars widths={["w-3/4", "w-1/2"]} />
      )}
      {world.packReady && (
        <p className="flex items-center gap-1.5 font-mono text-xs text-ink-soft">
          <Check aria-hidden="true" className="size-3.5" />
          Production Pack written
        </p>
      )}
      {world.partial && (
        <p className="text-sm text-ink-soft">
          This world stopped at {world.partial.stage}: {world.partial.reason}
        </p>
      )}
    </Card>
  );
}

/**
 * "Results so far": the taste neighborhood, the Reality Check, each concept world and the generic
 * brief's check, filling in as their events arrive. Skeletons hold the place of what has not.
 */
export function RunResults({ view, running }: { view: ResultsView; running: boolean }) {
  const { proof, reality, worlds, comparison } = view;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Taste neighborhood" waiting={proof ? undefined : "Qloo has not measured the audience yet."}>
        {proof ? (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-ink-soft">Qloo measured from these seeds</p>
              <ul className="flex flex-wrap gap-1.5">
                {proof.seeds.map((seed) => (
                  <li key={seed.id} className="max-w-full">
                    <SeedChip origin={seed.origin} name={seed.name} kind={seed.kind} />
                  </li>
                ))}
              </ul>
            </div>
            {proof.cities.length > 0 && (
              <p className="text-sm">
                <span className="text-ink-soft">Where it clusters: </span>
                {proof.cities.map((city) => `${city.label} #${city.rank}`).join(" · ")}
                {proof.comparedWith && <span className="text-ink-soft"> (ranked by lift against {proof.comparedWith} reference audiences)</span>}
              </p>
            )}
          </>
        ) : (
          <Bars widths={["w-1/2", "w-3/4"]} />
        )}
      </Card>

      <Card title="Reality Check" waiting={reality ? undefined : "The Reality Check comes after the audience is measured."}>
        {reality ? (
          <ul className="flex flex-col gap-3">
            {reality.lines.map((line, i) => (
              <li key={`${i}-${line.kind}`} className="flex flex-col items-start gap-1.5 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
                <p className={cn("text-sm text-pretty", line.kind === "measured" && "font-semibold")}>{line.text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {line.source && <span className={cn("rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold", SOURCE[line.source].className)}>{SOURCE[line.source].label}</span>}
                  {line.receipt && (
                    <ReceiptDrawer receipt={line.receipt}>
                      <button type="button" className="-my-1.5 inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
                        See the receipts
                      </button>
                    </ReceiptDrawer>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Bars widths={["w-2/3", "w-full", "w-1/2"]} />
        )}
      </Card>

      {worlds.length > 0 ? (
        worlds.map((world) => <WorldCard key={world.segmentId} world={world} />)
      ) : (
        <Card title="Concept worlds" waiting="Qloo has not split the audience yet.">
          <p className="text-sm text-ink-soft">Qloo splits the audience into 2 to 3 measured worlds, each with its own Culture Brief.</p>
          <Bars widths={["w-1/3", "w-2/3"]} />
        </Card>
      )}

      {comparison && (
        <Card title="The generic AI brief, checked against Qloo">
          {comparison.headline && <p className="text-sm font-semibold">{comparison.headline}</p>}
          <ul className="flex flex-col gap-2">
            {comparison.fits.map((fit) => (
              <li key={fit.world} className="text-sm">
                <span className="text-ink-soft">{fit.world}: </span>
                {fit.line}
              </li>
            ))}
          </ul>
          <p className="self-start rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Generic AI brief · not from Qloo</p>
        </Card>
      )}

      <p className="text-xs text-ink-soft">
        {running ? "Concepts appear here as they're written. Your report opens when the run finishes. " : ""}
        Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.
      </p>
    </div>
  );
}
