import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Chip, SeedChip } from "@/components/stoop/chip";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import { RealityGapCard } from "@/components/stoop/reality-gap-card";
import { ReceiptPanel } from "@/components/stoop/receipt-panel";
import { Screen } from "@/components/stoop/screen";
import { Stamp } from "@/components/stoop/stamp";
import { VideoTile } from "@/components/stoop/video-tile";
import { WaitlistForm } from "@/components/stoop/waitlist-form";
import { Button } from "@/components/ui/button";

// The D1 style tile: every token and base component in one place. Deleted before launch.
export const metadata: Metadata = {
  title: "Style tile · Stoop",
  robots: { index: false, follow: false },
};

const SWATCHES = [
  { name: "paper", className: "bg-paper border border-hairline", use: "The page" },
  { name: "surface", className: "bg-surface border border-hairline", use: "App cards" },
  { name: "fill", className: "bg-fill", use: "Inputs, skeletons" },
  { name: "sand", className: "bg-sand", use: "Sections" },
  { name: "ink", className: "bg-ink", use: "Text" },
  { name: "screen", className: "bg-screen", use: "Video screens" },
  { name: "brick", className: "bg-brick", use: "The one action" },
  { name: "sun", className: "bg-sun", use: "Decoration only" },
  { name: "dusk", className: "bg-dusk", use: "Qloo decided" },
  { name: "concrete-line", className: "bg-concrete-line", use: "Not from Qloo" },
  { name: "rose-deep", className: "bg-rose-deep", use: "Flagged" },
] as const;

export default function StylePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-5 py-12">
      <header className="flex flex-col gap-3">
        <p className="type-kicker text-ink-soft">Style tile · daylight + screening room</p>
        <h1 className="type-hero">Stop making ads for nobody.</h1>
        <p className="type-lead max-w-[38em] text-ink-soft">
          Warm paper pages with dark screens where the videos play. Three colors carry meaning, each with a label: dusk
          is Qloo, concrete is not from Qloo, rose is flagged. Every pair is checked by <code>npm run check:contrast</code>.
        </p>
      </header>

      <Block title="Type">
        <div className="flex flex-col gap-3">
          <p className="type-kicker text-dusk">Kicker · Data, not stereotypes.</p>
          <p className="type-h2">Heading 2, Bricolage narrow</p>
          <p className="type-h3">Heading 3 for cards</p>
          <p className="max-w-[40em]">Figtree body at 16/24. App screens use 14/20 and nothing over 32px.</p>
          <p className="font-mono text-sm">Geist Mono · /v2/insights · beats 23 of 25</p>
        </div>
      </Block>

      <Block title="Color">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map((swatch) => (
            <li key={swatch.name} className="flex items-center gap-3">
              <span aria-hidden="true" className={`size-12 shrink-0 rounded-xl ${swatch.className}`} />
              <span className="flex flex-col">
                <span className="font-mono text-sm">{swatch.name}</span>
                <span className="text-sm text-ink-soft">{swatch.use}</span>
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg">See why it works</Button>
          <Button size="lg" variant="outline">
            Try your product, free
          </Button>
          <Button variant="quiet">Copy prompt</Button>
          <Button variant="ghost">Copy script</Button>
          <Button variant="link">See the receipts</Button>
        </div>
      </Block>

      <Block title="Cue chips (outputs)">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Chip origin="qloo" showOrigin>
              Music style
            </Chip>
            <Chip origin="interpreted" showOrigin>
              Lighting
            </Chip>
            <Chip origin="creative" showOrigin>
              Tempo
            </Chip>
            <Chip origin="flagged" showOrigin>
              Setting
            </Chip>
          </div>
          <Screen variant="app" className="flex flex-wrap gap-2 p-4">
            <Chip origin="qloo" surface="screen" showOrigin>
              Wardrobe
            </Chip>
            <Chip origin="interpreted" surface="screen" showOrigin>
              Visual look
            </Chip>
            <Chip origin="creative" surface="screen" showOrigin>
              Camera
            </Chip>
            <Chip origin="flagged" surface="screen" showOrigin>
              Cliche
            </Chip>
          </Screen>
        </div>
      </Block>

      <Block title="Seed chips (inputs)">
        <div className="flex flex-wrap gap-2 rounded-xl border border-hairline bg-surface p-4">
          <SeedChip origin="qloo" name="[Category tag]" kind="tag" />
          <SeedChip origin="suggested" name="[Brand]" kind="brand" />
          <SeedChip origin="suggested" name="[TV show]" kind="tv" />
          <SeedChip origin="you" name="[Your pick]" kind="artist" />
        </div>
      </Block>

      <Block title="Stamps and provenance">
        <div className="flex flex-wrap items-center gap-6">
          <Stamp tone="qloo" animate={false}>
            Qloo verified
          </Stamp>
          <Stamp tone="flagged" animate={false}>
            Cliche flagged
          </Stamp>
          <ProvenanceBadge kind="recorded" date="[date]" />
          <ProvenanceBadge kind="live" />
          <ProvenanceBadge kind="partial" />
          <ProvenanceBadge kind="placeholder" />
        </div>
      </Block>

      <Block title="Screens">
        <div className="grid gap-6 md:grid-cols-2">
          <Screen className="grid grid-cols-2 gap-4 p-5">
            <VideoTile label="Control" tone="control" />
            <VideoTile label="Culture-made" tone="culture" />
          </Screen>
          <Screen variant="app" className="grid grid-cols-2 gap-4 p-5">
            <VideoTile label="Control" tone="control" />
            <VideoTile label="Culture-made" tone="culture" />
          </Screen>
        </div>
        <p className="text-sm text-ink-soft">Left: the landing stage (ink border, sticker shadow). Right: the app version.</p>
      </Block>

      <Block title="Reality gap and receipt">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-6">
            <RealityGapCard
              voice="brand"
              register="marketing"
              brand="[Example brand]"
              said="[X]"
              siteSpeaksTo="[Y]"
              measured="[Z]"
              receipt="/v2/insights · demographics + taste tags"
            />
            <RealityGapCard voice="you" siteSpeaksTo="[X]" said="[Y]" measured="[Z]" />
          </div>
          <ReceiptPanel
            cue="Music style"
            title="[Music style]"
            rows={[
              { label: "Endpoint", value: "/v2/insights", mono: true },
              { label: "Strength", value: "Beats [N] of 25 reference artists" },
            ]}
          />
        </div>
      </Block>

      <Block title="Waitlist form">
        <div className="max-w-md rounded-2xl border border-hairline bg-surface p-5 shadow-l2">
          <WaitlistForm />
        </div>
      </Block>
    </main>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-hairline pt-8">
      <h2 className="type-h3">{title}</h2>
      {children}
    </section>
  );
}
