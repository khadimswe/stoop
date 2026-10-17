import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import type { HeaderView } from "@/lib/report/view/types";

// Stub (report-top lane): the h1, where the data came from, and the partial reason when a run
// stopped early. Next: the channel badge, "Watch the agent build this (40 s)" and "Download kit".
export function ReportHeader({ view }: { view: HeaderView }) {
  const badge = view.partial ? "partial" : view.provenance;
  return (
    <header className="flex flex-col gap-2">
      <p className="type-kicker text-ink-soft">{view.kind === "example" ? "Example report" : "Your report"}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%]">{view.title}</h1>
        <ProvenanceBadge kind={badge} date={view.date} />
      </div>
      {view.brandName && <p className="text-sm text-ink-soft">{view.productName}</p>}
      {view.partial && <p className="text-sm text-ink-soft">Partial data: {view.partial.reason}</p>}
    </header>
  );
}
