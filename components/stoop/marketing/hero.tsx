import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The landing hero. The H1 is the LCP element and never animates: it is set in Bricolage at its
 * narrowest width (wdth 75), up to 120 px, and scales with the viewport so "nobody." never overflows
 * a phone. The hero object on the right is the blind test once its clips are approved, else the lead
 * example's Reality Check card (beat 1), which stays in the first screen on desktop.
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
        <div className="absolute -top-28 -left-44 size-[34rem] rounded-full bg-sun-soft/70" />
        {/* Peeks out from behind the hero object's lower left corner, clear of the copy. */}
        <div className="absolute top-[62%] left-[50%] hidden size-72 rounded-full bg-brick-soft/70 lg:block" />
      </div>
      <div className="mx-auto grid max-w-6xl items-start gap-x-12 gap-y-10 px-5 pt-8 pb-16 sm:pt-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:pb-20">
        <div className="flex min-w-0 flex-col gap-6">
          <p className="type-kicker text-dusk">Data, not stereotypes.</p>
          {/*
            21vw keeps "Stop making" on one line from 320 px up and makes the H1 the largest paint on
            phones; 7.5rem caps it at 120 px. Never animated: it is the LCP element.
          */}
          <h1
            id="hero-title"
            className="font-display font-extrabold text-balance [font-stretch:75%]"
            style={{ fontSize: "clamp(3.75rem, 21vw, 7.5rem)", lineHeight: 0.86, letterSpacing: "-0.035em" }}
          >
            Stop making ads for nobody.
          </h1>
          <p className="font-display text-[1.625rem] leading-[1.08] font-extrabold text-balance [font-stretch:85%] sm:text-[2rem]">
            <span className="sm:block">Ads are free to make now.</span> <span className="sm:block">Knowing who they&apos;re for isn&apos;t.</span>
          </p>
          <p className="max-w-[34em] text-[0.9375rem] leading-normal text-pretty text-ink-soft sm:text-lg sm:leading-relaxed">
            Stoop uses Qloo&apos;s taste data to map the audience around your product: who they are, what else they love, where they cluster. Then it
            writes the ad they&apos;d stop for.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={primary.href}>{primary.label}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/ads/start">Try your product, free</Link>
            </Button>
          </div>
          <p className="text-sm text-ink-soft">
            For Shopify and DTC brands running video ads on Meta and TikTok, and the founders building them. Aggregate taste data only.
          </p>
        </div>
        <div className="relative min-w-0 lg:pt-10">{object}</div>
      </div>
    </section>
  );
}
