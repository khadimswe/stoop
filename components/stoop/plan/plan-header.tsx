import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import type { ConceptView, PlanHeaderView } from "@/lib/plan/view/plan";

/**
 * The event sheet at the top of a plan: which store, the event's name and hook (why someone walking
 * by stops), then the facts a manager plans around (day, hours, where, budget) and the store's own
 * promos, quoted exactly. `aside` sits beside it on wide screens (the run of show). Example stores say
 * they are fictional and not affiliated with the carrier, right under the title. No carrier logo,
 * ever: the carrier is named in text.
 */
export function PlanHeader({ view, kind, concept, aside }: { view: PlanHeaderView; kind: "live" | "example"; concept: ConceptView | null; aside?: ReactNode }) {
  return (
    <header className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-3">
          {kind === "example" ? (
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
                <li>
                  <Link href="/#examples" className="underline decoration-1 underline-offset-4 hover:text-ink hover:decoration-brick">
                    Example stores
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page">{view.storeName}</li>
              </ol>
            </nav>
          ) : (
            <p className="type-kicker text-ink-soft">Your event plan · {view.storeName}</p>
          )}
          <h1 className="font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight text-balance [font-stretch:85%] sm:text-[2rem]">
            {concept?.title ?? view.storeName}
          </h1>
          {concept && <p className="max-w-[38em] text-[1.0625rem] leading-relaxed text-pretty text-ink">{concept.hook}</p>}
          {view.fictional && <p className="text-sm font-semibold text-ink">{view.fictional}</p>}
        </div>

        <dl className="grid grid-cols-2 border-y border-ink sm:grid-cols-4">
          <Fact i={0} label="Day">{view.dateText}</Fact>
          <Fact i={1} label="Hours">{view.timeText}</Fact>
          <Fact i={2} label="Where">{view.venue ?? view.settingLabel}</Fact>
          <Fact i={3} label="Budget">{view.budgetText.replace(" budget", "")}</Fact>
        </dl>

        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="font-semibold">{view.storeName}</span>
            <span className="text-ink-soft"> · {view.carrierLabel} store</span>
          </p>
          <p className="text-ink-soft">{view.address}</p>
          {view.venue && <p className="text-ink-soft">Event at {view.venue} ({view.settingLabel.toLowerCase()})</p>}
        </div>

        {view.offers.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold">Today&apos;s promos</span>
              <span className="text-ink-soft">typed by the store, quoted exactly</span>
            </p>
            <ul className="flex flex-col gap-1.5">
              {view.offers.map((offer) => (
                <li key={offer} className="self-start rounded-md bg-sun-soft px-3 py-1.5 font-display text-base leading-snug font-bold text-pretty [font-stretch:90%]">
                  “{offer}”
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.notes && (
          <p className="text-sm text-pretty text-ink-soft">
            <span className="font-semibold text-ink">Manager&apos;s notes: </span>“{view.notes}”
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ProvenanceBadge kind={view.provenance} date={view.madeOn ?? undefined} />
          <span className="text-xs text-ink-soft">For adults {view.ageText}</span>
        </div>
      </div>
      {aside && <div className="min-w-0">{aside}</div>}
    </header>
  );
}

/** Two by two on phones, one row from sm up, with hairlines between the cells. */
const FACT_CELL = ["", "border-l pl-3", "max-sm:border-t sm:border-l sm:pl-3", "border-l pl-3 max-sm:border-t"];

function Fact({ i, label, children }: { i: number; label: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-0.5 border-hairline py-3", FACT_CELL[i])}>
      <dt className="font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">{label}</dt>
      <dd className="text-sm font-semibold text-pretty">{children}</dd>
    </div>
  );
}
