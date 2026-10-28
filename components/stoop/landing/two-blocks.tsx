import { BadgeCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { BlockSideView } from "@/lib/plan/view/two-blocks";

function Side({ side }: { side: BlockSideView }) {
  return (
    <Link href={side.href} className="group grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {side.poster ? (
        <Image
          src={side.poster.src}
          alt={side.poster.alt}
          width={540}
          height={675}
          unoptimized
          className="aspect-[4/5] w-full rounded-xl border-2 border-ink bg-fill object-cover shadow-float transition-transform motion-safe:group-hover:-translate-y-0.5"
        />
      ) : (
        <span aria-hidden="true" className="aspect-[4/5] w-full rounded-xl bg-fill" />
      )}
      <span className="flex min-w-0 flex-col gap-2">
        <span className="text-sm text-ink-soft">
          {side.storeName}, {side.city}
        </span>
        <span className="font-display text-xl leading-tight font-extrabold text-balance underline-offset-4 [font-stretch:85%] group-hover:underline">{side.title ?? side.storeName}</span>
        <span className="flex flex-col border-t border-hairline">
          {side.lines.map((l) => (
            <span key={l.label} className="flex flex-col gap-0.5 border-b border-hairline py-1.5 text-sm">
              <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                {l.label}
                {l.qloo && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[0.6875rem] text-dusk">
                    <BadgeCheck aria-hidden="true" className="size-3" />
                    Qloo
                  </span>
                )}
              </span>
              <span className="line-clamp-2 font-semibold">{l.value}</span>
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}

/** Two stores, two blocks, two different tables, side by side: each store's poster and three lines of its plan. */
export function TwoBlocks({ sides }: { sides: readonly [BlockSideView, BlockSideView] }) {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      <Side side={sides[0]} />
      <Side side={sides[1]} />
    </div>
  );
}
