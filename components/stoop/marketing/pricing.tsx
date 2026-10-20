import { Check } from "lucide-react";
import type { WaitlistRequest } from "@/lib/api/requests";
import { cn } from "cn";
import { InlineWaitlist } from "./inline-waitlist";
import { ReserveTrigger } from "./reserve-trigger";
import { SectionIntro } from "./section-intro";

interface Plan {
  plan: NonNullable<WaitlistRequest["plan"]>;
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  includes: string[];
  emphasized?: boolean;
}

// Decided Oct 16. Free is 1 run per brand; paid tiers sell final renders, all concept worlds and
// more runs. Nothing is charged in beta: "Reserve" joins the waitlist with the plan.
const PLANS: Plan[] = [
  {
    plan: "free",
    name: "Free",
    price: "$0",
    cadence: "1 run per brand",
    pitch: "The audience around your product, from your link alone.",
    includes: ["The Culture Brief", "The Reality Check", "1 draft render"],
  },
  {
    plan: "campaign",
    name: "Campaign",
    price: "$49",
    cadence: "per campaign",
    pitch: "One product, every concept world, ready to render.",
    includes: ["All concept worlds", "Final renders", "More runs"],
    emphasized: true,
  },
  {
    plan: "founder",
    name: "Founder",
    price: "$149",
    cadence: "per month",
    pitch: "For founders who launch and test new ads every month.",
    includes: ["All concept worlds", "Final renders", "More runs each month"],
  },
  {
    plan: "studio",
    name: "Studio",
    price: "$399",
    cadence: "per month",
    pitch: "The agency plan, for agencies and AI-ad operators running several brands.",
    includes: ["Multi-brand workspaces", "All concept worlds and final renders", "More runs for every brand"],
  },
];

/** #pricing: four plans with "Reserve" (the waitlist, tagged with the plan), the roadmap line, then the inline waitlist. */
export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24 border-t border-hairline bg-paper-raised py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5">
        <SectionIntro
          id="pricing-title"
          kicker="Pricing"
          title="Free in beta. $49 per campaign after."
          lead="Everything is free while Stoop is in beta, within daily limits. Plans start after beta: Reserve holds your spot, no payment."
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <li
              key={plan.plan}
              className={cn(
                "flex min-w-0 flex-col gap-4 rounded-card p-6",
                plan.emphasized ? "border-2 border-ink bg-sun" : "border border-hairline bg-paper",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`plan-${plan.plan}`} className="type-kicker text-ink">
                  {plan.name}
                </h3>
                <span className={cn("font-mono text-[0.6875rem] tracking-wide uppercase", plan.emphasized ? "text-ink" : "text-ink-soft")}>
                  After beta
                </span>
              </div>
              <p className="flex items-baseline gap-2">
                <span className="font-display text-[2.75rem] leading-none font-extrabold tracking-tight [font-stretch:85%]">{plan.price}</span>
                <span className={cn("text-base font-semibold", plan.emphasized ? "text-ink" : "text-ink-soft")}>{plan.cadence}</span>
              </p>
              <p className={cn("text-[0.95rem] leading-snug text-pretty", plan.emphasized ? "text-ink" : "text-ink-soft")}>{plan.pitch}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-ink">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.6} />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-2">
                <ReserveTrigger plan={plan.plan} planName={plan.name} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 text-[0.95rem] leading-relaxed text-ink-soft">
          <p>
            <span className="font-semibold text-ink">Roadmap: Precision mode comes with the Shopify app.</span> Connect your store so real order
            locations and best-sellers sharpen Qloo&apos;s picture. Aggregated, no customer PII.
          </p>
          <p>Running an accelerator? Cohort licenses come after beta.</p>
        </div>
        <div className="flex flex-wrap items-start gap-x-12 gap-y-6 rounded-card border border-hairline bg-surface p-6 sm:p-8">
          <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-2">
            <h3 className="font-display text-[1.75rem] leading-tight font-extrabold [font-stretch:85%]">Get a free Culture Brief</h3>
            <p className="text-base leading-relaxed text-ink-soft">Join the beta. We&apos;ll map the audience around your product, with the Qloo data behind it.</p>
          </div>
          <InlineWaitlist className="min-w-0 flex-[1_1_24rem]" />
        </div>
      </div>
    </section>
  );
}
