import { AgentDemo, AGENT_DEMO_SLOT_CLASS } from "@/components/stoop/marketing/agent-demo/agent-demo";
import { AgentDemoSlot } from "@/components/stoop/marketing/agent-demo-slot";
import { BlindTest } from "@/components/stoop/marketing/blind-test";
import { ExampleShelf } from "@/components/stoop/marketing/example-shelf";
import { Hero } from "@/components/stoop/marketing/hero";
import { HowItWorks } from "@/components/stoop/marketing/how-it-works";
import { Pricing } from "@/components/stoop/marketing/pricing";
import { ProofStats } from "@/components/stoop/marketing/proof-stats";
import { RealityCard } from "@/components/stoop/marketing/reality-card";
import { ReceiptsTeaser } from "@/components/stoop/marketing/receipts-teaser";
import { ScreeningPreview } from "@/components/stoop/marketing/screening-preview";
import { ScrollReveal } from "@/components/stoop/marketing/scroll-reveal";
import { ThreeWays } from "@/components/stoop/marketing/three-ways";
import { EXAMPLES, LEAD_EXAMPLE } from "@/lib/demo/examples";
import { approvalsSchema, heroMode, manifestSchema } from "@/lib/demo/hero";
import { loadDemoScript } from "@/lib/marketing/demo-source";
import { ageSkewMini, agentDemoStill, realityCard, screeningPreview, shelfItem, teaserView } from "@/lib/marketing/landing";
import { PROOF_PICKS, proofStats } from "@/lib/marketing/proof";
import { loadExampleMedia, loadExampleReport } from "@/lib/report/load";
import { receiptHash } from "@/lib/report/view/deep-link";
import { ledgerOf } from "@/lib/report/view/receipts";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";

// The landing stays static: recorded runs and approved media only, built at build time.
export const ensureStatic = "navigation";

// The blind test needs the lead example's two hook clips, approved as exact files. Until then the hero
// falls back to the lead example's Reality Check card (beat 1), then its Screening Room (beat 2) with
// one receipt open (beat 3).
const mode = heroMode(manifestSchema.parse(manifest), approvalsSchema.parse(approvals), LEAD_EXAMPLE.slug);

/** "See why it works": the lead example's Screening Room with its music style receipt open (beats 2 and 3). */
const WHY_HREF = `/examples/${LEAD_EXAMPLE.slug}${receiptHash("music")}`;

export default function Home() {
  const lead = loadExampleReport(LEAD_EXAMPLE.slug);
  const card = realityCard(LEAD_EXAMPLE.slug, lead);
  const preview = screeningPreview(LEAD_EXAMPLE.slug, lead, loadExampleMedia(LEAD_EXAMPLE.slug));
  const shelf = EXAMPLES.map(({ slug }) => shelfItem(slug, loadExampleReport(slug)));
  const teaser = teaserView(LEAD_EXAMPLE.slug, lead);
  const still = agentDemoStill(LEAD_EXAMPLE.slug, lead);
  const demo = loadDemoScript();
  const stats = proofStats(PROOF_PICKS, (slug) => {
    const report = loadExampleReport(slug);
    return { report, ledger: ledgerOf(report) };
  });
  const cardNode = card ? <RealityCard view={card} /> : null;

  const object =
    mode.kind === "blind-test" ? (
      <BlindTest
        example={mode.example}
        screeningHref={WHY_HREF}
        culture={{ src: mode.culture.file, poster: mode.culture.poster, captions: mode.culture.captions }}
        control={{ src: mode.control.file, poster: mode.control.poster, captions: mode.control.captions }}
        cultureLabel={lead.worlds.find((w) => w.segmentId === mode.culture.segmentId)?.label ?? lead.worlds[0]?.label ?? "Concept world"}
        reveal={card ? <RealityCard view={card} headingLevel="h3" className="shadow-none" /> : null}
      />
    ) : (
      cardNode
    );

  return (
    <main data-hero-mode={mode.kind} className="flex-1">
      <Hero
        primary={mode.kind === "blind-test" ? { label: "See a real example", href: `/examples/${LEAD_EXAMPLE.slug}` } : { label: "See why it works", href: WHY_HREF }}
        object={object}
      />
      {/* The replay of the lead's recorded run. Its own fixed shape sets the screen's height; it loads as its own chunk. */}
      <AgentDemoSlot still={still} className={AGENT_DEMO_SLOT_CLASS}>
        <AgentDemo script={demo} frame="fill" />
      </AgentDemoSlot>
      {/* Beats 2 and 3 stay one screen from the hero; the proof band follows them. */}
      <ScreeningPreview view={preview} />
      <ProofStats stats={stats} />
      <ExampleShelf items={shelf} />
      <ThreeWays />
      <HowItWorks skews={ageSkewMini(lead)} />
      {teaser && <ReceiptsTeaser view={teaser} />}
      <Pricing />
      <ScrollReveal />
    </main>
  );
}
