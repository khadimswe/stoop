import Link from "next/link";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import type { HeaderView } from "@/lib/report/view/types";

/**
 * The report's head: where it sits (Examples), the brand as the h1, the ad format every pack is
 * written for, and where the data came from. A run that stopped early says so in one line. The
 * header actions ("Watch the agent build this", "Download kit") arrive with the trace replay and the
 * kit export.
 */
export function ReportHeader({ view }: { view: HeaderView }) {
  const badge = view.partial ? "partial" : view.provenance;
  return (
    <header className="flex flex-col gap-2">
      {view.kind === "example" ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-sm text-ink-soft">
            <li>
              <Link href="/#examples" className="underline decoration-1 underline-offset-4 hover:text-ink hover:decoration-brick">
                Examples
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="truncate">
              {view.title}
            </li>
          </ol>
        </nav>
      ) : (
        <p className="type-kicker text-ink-soft">Your report</p>
      )}
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance [font-stretch:85%] sm:text-[2rem]">{view.title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {/* Every pack is 9:16, 15 s, for Meta Reels and Stories plus TikTok (lib/prompts/brief.ts). */}
        <span className="inline-flex items-center rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-ink">Reels + TikTok 9:16</span>
        <ProvenanceBadge kind={badge} date={view.date} />
      </div>
      {view.brandName && <p className="text-sm text-ink-soft">{capitalize(view.productName)}</p>}
      {view.partial && <p className="text-sm text-ink-soft">Partial data: {view.partial.reason}</p>}
    </header>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
