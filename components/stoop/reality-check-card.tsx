import { BadgeCheck, PenLine, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Who a Reality Check line speaks for, as a small tag with an icon and words, never color alone:
 *   site     "Read from your site · not from Qloo" (dashed concrete: Claude's reading of the page)
 *   you      "You" (ink outline: what the founder stated)
 *   qloo     "Qloo" (solid dusk: what Qloo measured)
 *   generic  "Generic AI brief · not from Qloo" (dashed concrete: the LLM-only brief)
 * `voice` "brand" speaks about an example on the landing ("Read from their site", "Brand").
 */
export function RealitySourceTag({ source, voice = "you", className }: { source: "site" | "you" | "qloo" | "generic"; voice?: "brand" | "you"; className?: string }) {
  const tag = {
    site: { icon: PenLine, text: `Read from ${voice === "brand" ? "their" : "your"} site · not from Qloo`, style: "border-dashed border-concrete-line text-ink-soft" },
    you: { icon: UserRound, text: voice === "brand" ? "Brand" : "You", style: "border-ink text-ink" },
    qloo: { icon: BadgeCheck, text: "Qloo", style: "border-dusk bg-dusk text-paper" },
    generic: { icon: PenLine, text: "Generic AI brief · not from Qloo", style: "border-dashed border-concrete-line text-ink-soft" },
  }[source];
  const Icon = tag.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tag.style, className)}>
      <Icon aria-hidden="true" className="size-3" />
      {tag.text}
    </span>
  );
}

/**
 * The Reality Check, demo beat 1. Up to three lines, each only when its input exists:
 * what the brand said, what its site speaks to (Claude's reading, never Qloo data), and what Qloo
 * measured. Without store data, "measured" is the audience around the product's taste neighborhood,
 * never the brand's actual buyers.
 * - voice "brand": the landing, about an example ("This brand said X. Their site speaks to Y.")
 * - voice "you": a report, to its owner ("Your site speaks to X. You said Y.")
 * Reports render the gap stage's own lines instead (components/stoop/report/sections/reality.tsx),
 * with the same tags.
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
      <RealitySourceTag source="you" voice={voice} />
    </GapLine>
  );
  const siteLine = siteSpeaksTo && (
    <GapLine key="site" text={`${voice === "brand" ? "Their" : "Your"} site speaks to ${siteSpeaksTo}.`}>
      <RealitySourceTag source="site" voice={voice} />
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
            <RealitySourceTag source="qloo" />
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
