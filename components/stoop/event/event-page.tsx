import { CalendarDays, MapPin, Store } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { FloorMark } from "@/components/stoop/floor/kit";
import type { EventPageView } from "@/lib/plan/view/event-page";

function Row({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-fl-rule py-3 last:border-b-0">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5 text-[0.9375rem]">{children}</div>
    </li>
  );
}

/**
 * The event as the public sees it, from a Facebook or WhatsApp link: the poster, the name, when,
 * where (with a maps link) and the store's promos, quoted exactly. No receipts and no internals.
 * Phones first: the poster on top, the details under it; side by side from md up.
 */
export function EventPage({ view }: { view: EventPageView }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 pt-6 pb-12 sm:px-5 sm:pt-10">
      <div className={view.poster ? "grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start" : "max-w-xl"}>
        {view.poster && (
          <div className="md:order-2">
            <div className="rounded-[20px] bg-fl-dark p-3">
              <Image src={view.poster.src} alt={view.poster.alt} width={720} height={900} unoptimized priority fetchPriority="high" className="aspect-[4/5] h-auto w-full rounded-[8px]" />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-5 md:order-1">
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-[2.25rem] leading-[1.05] font-normal tracking-[-0.01em] text-balance">{view.title}</h1>
            {view.hook && <p className="text-base text-pretty text-fl-dim">{view.hook}</p>}
          </div>
          <ul className="flex flex-col">
            <Row icon={CalendarDays}>
              <span className="font-semibold">{view.dateText}</span>
              <span className="text-fl-dim">{view.timeText}</span>
            </Row>
            <Row icon={MapPin}>
              <span className="font-semibold">{view.where}</span>
              <span className="text-fl-dim">{view.address}</span>
              <a href={view.mapsHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-2">
                Get directions<span className="sr-only"> (opens your maps)</span>
              </a>
            </Row>
            <Row icon={Store}>
              <span className="font-semibold">{view.storeName}</span>
              {view.phone && (
                <a href={`tel:${view.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex min-h-11 items-center self-start font-mono text-sm underline decoration-1 underline-offset-4">
                  {view.phone}
                </a>
              )}
            </Row>
          </ul>
          {view.offers.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">At the table</h2>
              <ul className="flex flex-col gap-2">
                {view.offers.map((o) => (
                  <li key={o} className="rounded-[12px] bg-white px-4 py-3 text-base leading-snug font-semibold text-pretty">
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-fl-dim">Free to stop by.</p>
        </div>
      </div>
      <footer className="flex flex-col items-start gap-2 border-t border-fl-rule pt-5 text-xs text-fl-dim">
        {view.fictional && <p className="font-semibold text-fl-ink">{view.fictional}</p>}
        <p className="flex items-center gap-2">
          Planned with <FloorMark className="size-5" /> <span className="font-semibold text-fl-ink">Stoop</span>
        </p>
      </footer>
    </main>
  );
}
