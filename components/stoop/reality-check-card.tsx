import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * The Reality Check, demo beat 1. Up to three lines, each only when its input exists:
 * what the brand said, what its site speaks to (Claude's reading, never Qloo data), and what Qloo
 * measured. Without store data, "measured" is the audience around the product's taste neighborhood,
 * never the brand's actual buyers.
 * - voice "brand": the landing, about an example ("This brand said X. Their site speaks to Y.")
 * - voice "you": a report, to its owner ("Your site speaks to X. You said Y.")
 */
export function RealityCheckCard({
  voice,
  brand,
  said,
  siteSpeaksTo,
  measured,
  receipt,
  provenance,
  register = "app",
  className,
}: {
  voice: "brand" | "you";
  brand?: string;
  said?: string;
  siteSpeaksTo?: string;
  measured: string;
  /** One mono line naming the Qloo call behind "measured". */
  receipt?: string;
  provenance?: ReactNode;
  register?: "marketing" | "app";
  className?: string;
}) {
  const saidLine = said && (
    <GapLine key="said" text={voice === "brand" ? `This brand said ${said}.` : `You said ${said}.`}>
      <span className="rounded-full border-[1.5px] border-ink px-2.5 py-0.5 text-xs font-semibold">
        {voice === "brand" ? "Brand" : "You"}
      </span>
    </GapLine>
  );
  const siteLine = siteSpeaksTo && (
    <GapLine key="site" text={`${voice === "brand" ? "Their" : "Your"} site speaks to ${siteSpeaksTo}.`}>
      <span className="rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
        Read from {voice === "brand" ? "their" : "your"} site · not from Qloo
      </span>
    </GapLine>
  );

  return (
    <section
      aria-label={brand ? `Reality check for ${brand}` : "Reality check"}
      className={cn(
        "flex min-w-0 flex-col gap-4 bg-surface p-6",
        register === "marketing" ? "rounded-card border-2 border-ink shadow-float sm:p-7" : "rounded-xl border border-hairline",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-kicker text-ink-soft">
          Reality check{brand && <span> · {brand}</span>}
        </p>
        {provenance}
      </div>
      <div className="flex flex-col gap-3.5">
        {voice === "brand" ? [saidLine, siteLine] : [siteLine, saidLine]}
        <div className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%]">
              Qloo measured {measured}.
            </span>
            <span className="rounded-full bg-dusk px-2.5 py-0.5 text-xs font-bold text-paper">Qloo</span>
          </p>
          <p className="text-sm text-ink-soft">
            The audience around {voice === "brand" ? "the" : "your"} product&apos;s taste neighborhood: who it is, what else
            they love, where they cluster.
          </p>
        </div>
      </div>
      {receipt && <p className="border-t border-hairline pt-3 font-mono text-xs text-ink-soft">{receipt}</p>}
    </section>
  );
}

function GapLine({ text, children }: { text: string; children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-3 border-b border-hairline pb-3.5 text-lg font-semibold">
      <span>{text}</span>
      {children}
    </p>
  );
}
