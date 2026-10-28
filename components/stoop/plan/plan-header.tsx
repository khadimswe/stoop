import { CalendarDays, Clock, Info, MapPin, Store, Wallet } from "lucide-react";
import Link from "next/link";
import { Chip } from "@/components/stoop/chip";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import type { PlanHeaderView } from "@/lib/plan/view/plan";

/**
 * The plan's head: the store (the h1), where and when, the setting and budget, where the data came
 * from, and the manager's own offers word for word. Example stores say they are fictional and not
 * affiliated with the carrier, right under the name. No carrier logo, ever: the carrier is named in text.
 */
export function PlanHeader({ view, kind }: { view: PlanHeaderView; kind: "live" | "example" }) {
  return (
    <header className="flex flex-col gap-3">
      {kind === "example" ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-sm text-ink-soft">
            <li>
              <Link href="/#examples" className="underline decoration-1 underline-offset-4 hover:text-ink hover:decoration-brick">
                Example stores
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="truncate">
              {view.storeName}
            </li>
          </ol>
        </nav>
      ) : (
        <p className="type-kicker text-ink-soft">Your event plan</p>
      )}
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance [font-stretch:85%] sm:text-[2rem]">{view.storeName}</h1>
      {view.fictional && (
        <p className="inline-flex items-start gap-2 self-start rounded-lg bg-fill px-3 py-2 text-sm font-semibold text-ink">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {view.fictional}
        </p>
      )}
      <ul className="flex flex-col gap-1.5 text-sm text-ink sm:flex-row sm:flex-wrap sm:gap-x-5">
        <li className="flex items-center gap-2">
          <Store aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />
          {view.carrierLabel} store
        </li>
        <li className="flex items-start gap-2">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-soft" />
          <span>
            {view.address}, {view.cityLine}
          </span>
        </li>
      </ul>
      <ul aria-label="Event details" className="flex flex-wrap gap-2">
        <Fact icon={CalendarDays}>{view.dateText}</Fact>
        <Fact icon={Clock}>{view.timeText}</Fact>
        <Fact icon={Store}>{view.settingLabel}</Fact>
        <Fact icon={Wallet}>{view.budgetText}</Fact>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge kind={view.provenance} date={view.madeOn ?? undefined} />
        <span className="text-xs text-ink-soft">Planned for adults {view.ageText}</span>
      </div>
      {(view.offers.length > 0 || view.notes) && (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-4">
          {view.offers.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                Your offers, word for word <Chip origin="yours">Your choice</Chip>
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {view.offers.map((offer) => (
                  <li key={offer} className="before:mr-2 before:text-ink-soft before:content-['•']">
                    {offer}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {view.notes && (
            <p className="text-sm text-ink-soft">
              <span className="font-semibold text-ink">Your notes: </span>“{view.notes}”
            </p>
          )}
          <p className="text-xs text-ink-soft">Stoop never invents an offer. Posts and the poster use only what you typed.</p>
        </div>
      )}
    </header>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-sm font-semibold text-ink">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </li>
  );
}
