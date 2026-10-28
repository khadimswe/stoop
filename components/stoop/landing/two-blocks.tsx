import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { BlockMap } from "@/components/stoop/plan/block-map";
import { PlanReceipts } from "@/components/stoop/plan/receipts";
import type { BlockSideView } from "@/lib/plan/view/two-blocks";

function Side({ side }: { side: BlockSideView }) {
  return (
    <PlanReceipts receipts={side.receipts}>
      <article className="flex min-w-0 flex-col gap-4 rounded-card border-2 border-ink bg-surface p-4 shadow-float sm:p-5">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs tracking-wide text-ink-soft uppercase">{side.city}</p>
          <h3 className="font-display text-xl leading-tight font-extrabold text-balance [font-stretch:85%]">{side.title ?? side.storeName}</h3>
          <p className="text-sm text-ink-soft">{side.storeName}</p>
        </div>
        {side.block && side.block.places.length > 0 && <BlockMap block={side.block} uses={side.uses} compact />}
        <dl className="flex flex-col border-t border-hairline">
          {side.lines.map((l) => (
            <div key={l.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 border-b border-hairline py-2 text-sm">
              <dt className="text-ink-soft">{l.label}</dt>
              <dd className="flex min-w-0 items-start justify-between gap-2">
                <span className="line-clamp-2 font-semibold">{l.value}</span>
                {l.qloo && (
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.6875rem] text-dusk">
                    <BadgeCheck aria-hidden="true" className="size-3.5" />
                    Qloo
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <Link href={side.href} className="inline-flex min-h-11 items-center self-start text-sm font-bold underline decoration-2 underline-offset-4 hover:decoration-brick">
          See this plan<span className="sr-only">: {side.storeName}</span>
        </Link>
      </article>
    </PlanReceipts>
  );
}

/** Two stores, two blocks, two different tables, side by side: each from its own recorded run. */
export function TwoBlocks({ sides }: { sides: readonly [BlockSideView, BlockSideView] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Side side={sides[0]} />
      <Side side={sides[1]} />
    </div>
  );
}
