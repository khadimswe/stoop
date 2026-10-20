import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The landing hero. The H1 is the LCP element and never animates. The hero object on the right is
 * the blind test once its clips are approved, else the lead example's Reality Check card (beat 1).
 */
export function Hero({
  primary,
  object,
}: {
  /** The brick CTA: "See why it works" before the blind test, "See a real example" with it. */
  primary: { label: string; href: string };
  object: ReactNode;
}) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate">
      {/* Decoration only: soft color fields behind the copy. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-x-clip">
        <div className="absolute -top-24 -left-40 size-[28rem] rounded-full bg-sun-soft/70" />
        <div className="absolute right-[34%] bottom-0 hidden size-72 rounded-full bg-brick-soft/60 lg:block" />
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-14 gap-y-10 px-5 pt-10 pb-16 sm:pt-16 lg:pb-20">
        <div className="flex min-w-0 flex-[1_1_26rem] flex-col gap-5">
          <p className="type-kicker text-dusk">Data, not stereotypes.</p>
          {/* Capped at 84 px (type-hero alone tops out at 92), and larger than type-hero on phones so it stays the LCP. */}
          <h1 id="hero-title" className="type-hero text-balance" style={{ fontSize: "clamp(3.75rem, 6.2vw, 5.25rem)" }}>
            Stop making ads for nobody.
          </h1>
          <p className="font-display text-[1.375rem] leading-snug font-bold text-balance [font-stretch:90%] sm:text-[1.625rem]">
            Ads are free to make now. Knowing who they&apos;re for isn&apos;t.
          </p>
          <p className="max-w-[34em] text-[0.9375rem] leading-normal text-pretty text-ink-soft sm:text-lg sm:leading-relaxed">
            Stoop uses Qloo&apos;s taste data to map the audience around your product: who they are, what else they love, where they cluster. Then it
            writes the ad they&apos;d stop for.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild size="lg">
              <Link href={primary.href}>{primary.label}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/start">Try your product, free</Link>
            </Button>
          </div>
          <p className="text-sm text-ink-soft">
            For Shopify and DTC brands running video ads on Meta and TikTok, and the founders building them. Aggregate taste data only.
          </p>
        </div>
        <div className="relative min-w-0 flex-[1_1_30rem]">{object}</div>
      </div>
    </section>
  );
}
