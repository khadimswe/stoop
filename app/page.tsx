import Link from "next/link";
import { Chip } from "@/components/stoop/chip";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import { RealityGapCard } from "@/components/stoop/reality-gap-card";
import { ReceiptPanel } from "@/components/stoop/receipt-panel";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import { LEAD_EXAMPLE, approvalsSchema, heroMode, manifestSchema } from "@/lib/demo/hero";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";

// The blind test needs approved clips. Gate 7 adds it for mode.kind === "blind-test"; until then every
// visitor gets the fallback: the lead example's Reality Gap card (beat 1), then its Screening Room (beat 2)
// with one receipt open (beat 3).
const mode = heroMode(manifestSchema.parse(manifest), approvalsSchema.parse(approvals), LEAD_EXAMPLE);

// Labeled placeholders until Gate 6 freezes the lead example. Never fake data.
const LEAD = {
  brand: "[Lead example brand]",
  said: "[what the brand said]",
  site: "[who its page speaks to]",
  measured: "[the measured audience]",
};

export default function Home() {
  return (
    <main data-hero-mode={mode.kind} className="flex-1">
      <section className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-12 px-5 pt-14 pb-14 sm:pt-20 lg:gap-14">
        <div aria-hidden="true" className="absolute -top-16 -left-44 size-[26rem] rounded-full bg-sun-soft/70" />
        <div className="relative flex min-w-0 flex-[1_1_26rem] flex-col gap-5">
          <p className="type-kicker text-dusk">Data, not stereotypes.</p>
          <h1 className="type-hero text-balance">Stop making ads for nobody.</h1>
          <p className="type-lead max-w-[34em] text-ink-soft">
            Stoop uses Qloo&apos;s taste data to map the audience around your product: who they are, what else they love,
            where they cluster. Then it writes the ad they&apos;d stop for.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="#screening">See why it works</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/start">Try your product, free</Link>
            </Button>
          </div>
          <p className="text-sm text-ink-soft">
            For Shopify and DTC brands running video ads on Meta and TikTok, and the founders building them. Aggregate
            taste data only.
          </p>
        </div>
        <RealityGapCard
          voice="brand"
          register="marketing"
          brand={LEAD.brand}
          said={LEAD.said}
          siteSpeaksTo={LEAD.site}
          measured={LEAD.measured}
          receipt="/v2/insights · demographics + taste tags · from [n] seeds"
          provenance={<ProvenanceBadge kind="placeholder" />}
          className="relative flex-[1_1_30rem]"
        />
      </section>

      <section id="screening" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-5 px-5 pb-20">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="type-h2 max-w-[16em] text-balance">Same product. Same video model. Only the brief changed.</h2>
          <p className="type-kicker text-ink-soft">Screening Room · {LEAD.brand}</p>
        </div>
        <div className="flex flex-wrap items-start gap-5">
          {/* Phones: a sideways-scrolling shelf of full-size tiles. From sm up: three columns. */}
          <Screen
            role="region"
            aria-label="Screening Room clips"
            tabIndex={0}
            className="flex min-w-0 flex-[1_1_34rem] snap-x gap-3 overflow-x-auto p-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:p-5"
          >
            <div className="flex w-36 shrink-0 snap-start flex-col gap-2 sm:w-auto sm:min-w-0">
              <VideoTile label="Control" tone="control" />
              <p className="text-xs text-paper-dim">LLM-only brief, same template</p>
            </div>
            <div className="flex w-36 shrink-0 snap-start flex-col gap-2 sm:w-auto sm:min-w-0">
              <VideoTile label="Culture-made" tone="culture" />
              <div className="flex flex-col items-start gap-1.5 text-xs text-paper-dim">
                [Segment A]
                <Chip origin="qloo" surface="screen" className="ring-2 ring-paper ring-offset-2 ring-offset-screen">
                  Music style
                </Chip>
              </div>
            </div>
            <div className="flex w-36 shrink-0 snap-start flex-col gap-2 sm:w-auto sm:min-w-0">
              <VideoTile label="Culture-made" tone="culture" />
              <div className="flex flex-col items-start gap-1.5 text-xs text-paper-dim">
                [Segment B]
                <Chip origin="qloo" surface="screen">
                  Setting
                </Chip>
              </div>
            </div>
          </Screen>
          <ReceiptPanel
            cue="Music style"
            title="[Music style: genre, era, instrumentation]"
            rows={[
              { label: "Endpoint", value: "/v2/insights", mono: true },
              { label: "Asked for", value: "urn:entity:artist", mono: true },
              { label: "Audience", value: "[Segment A]" },
              { label: "Strength", value: "Beats [N] of 25 reference artists" },
              { label: "Why", value: "Driven by [seed]" },
              { label: "Served", value: "From cache · [date]" },
            ]}
            note="Source artists appear only here, never in prompts. API key never shown."
            className="flex-[0_1_22rem]"
          />
        </div>
      </section>
    </main>
  );
}
