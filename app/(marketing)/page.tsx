import { AgentDemoSlot } from "@/components/stoop/marketing/agent-demo-slot";
import { AgentTrace } from "@/components/stoop/marketing/agent-trace";
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
import { ageSkewMini, agentDemoStill, realityCard, replayView, screeningPreview, shelfItem, teaserView } from "@/lib/marketing/landing";
import { PROOF_PICKS, proofStats } from "@/lib/marketing/proof";
import { loadExampleMedia, loadExampleReport } from "@/lib/report/load";
import { ledgerOf } from "@/lib/report/view/receipts";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";

// The landing stays static: recorded runs and approved media only, built at build time.
export const ensureStatic = "navigation";

// The blind test needs the lead example's two hook clips, approved as exact files. Until then the hero
// falls back to the lead example's Reality Check card (beat 1), then its Screening Room (beat 2) with
// one receipt open (beat 3).
const mode = heroMode(manifestSchema.parse(manifest), approvalsSchema.parse(approvals), LEAD_EXAMPLE.slug);

export default function Home() {
  const lead = loadExampleReport(LEAD_EXAMPLE.slug);
  const card = realityCard(LEAD_EXAMPLE.slug, lead);
  const preview = screeningPreview(LEAD_EXAMPLE.slug, lead, loadExampleMedia(LEAD_EXAMPLE.slug));
  const shelf = EXAMPLES.map(({ slug }) => shelfItem(slug, loadExampleReport(slug)));
  const replay = replayView(lead);
  const teaser = teaserView(LEAD_EXAMPLE.slug, lead);
  const still = agentDemoStill(LEAD_EXAMPLE.slug, lead);
  const stats = proofStats(PROOF_PICKS, (slug) => {
    const report = loadExampleReport(slug);
    return { report, ledger: ledgerOf(report) };
  });
  const cardNode = card ? <RealityCard view={card} /> : null;

  const object =
    mode.kind === "blind-test" ? (
      <BlindTest
        example={mode.example}
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
        primary={mode.kind === "blind-test" ? { label: "See a real example", href: `/examples/${LEAD_EXAMPLE.slug}` } : { label: "See why it works", href: "#screening" }}
        object={object}
      />
      {/* The recorded-run player drops in here as children; until then the slot shows the run's still. */}
      <AgentDemoSlot still={still} />
      {/* Beats 2 and 3 stay one screen from the hero; the proof band follows them. */}
      <ScreeningPreview view={preview} />
      <ProofStats stats={stats} />
      <ExampleShelf items={shelf} />
      <ThreeWays />
      <HowItWorks skews={ageSkewMini(lead)} />
      <AgentTrace replay={replay} />
      {teaser && <ReceiptsTeaser view={teaser} />}
      <Pricing />
      <ScrollReveal />
    </main>
  );
}
