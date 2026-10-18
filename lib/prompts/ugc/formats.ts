// The short-form formats a kit script can take: Meta-friendly formats (product demo, before/after,
// founder story, problem/solution) and TikTok hooks (POV, unboxing, first try). Each format fills the
// same slots: a hook type, an on-screen text line, a product-demo beat, a proof beat (seller-supplied
// facts only) and a CTA per platform. There is no testimonial format: AI-actor scripts speak as the
// brand, never as a customer who "tried it". Customer-voice formats (first try, unboxing) go to human
// creators only; AI-actor tools get the product demo of the same concept (the
// default for customer-voice formats, first_try and review, is a human-creator teleprompter export).
//
// Sources (read Oct 16, 2026):
//   Meta CTA buttons: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data-call-to-action/
//     (call_to_action types SHOP_NOW, LEARN_MORE, ORDER_NOW among others; not every type fits every
//     objective). Ads Manager shows them in sentence case ("Shop now").
//   TikTok CTA buttons: https://ads.tiktok.com/help/article/ad-set-up?lang=en (last updated June 2026:
//     standard CTAs include "Shop Now", "Learn More" and "Order Now"; dynamic CTAs include "Shop Now"
//     and "Learn More") and https://ads.tiktok.com/help/article/dynamic-recommended-cta-tiktok-ads-manager?lang=en
//     (performance ads may also swap in dynamic or AI-generated CTA text)
//   FTC rule on consumer reviews and testimonials, announced Aug 14, 2024:
//     https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
//     (bans reviews and testimonials that misrepresent who wrote them or whether they used the product)
import type { UgcFormat } from "../../report/world";

export type CtaId = "shop_now" | "learn_more" | "order_now";

/** Button text per platform, as each ads manager words it. */
export const CTA_LABELS: Readonly<Record<CtaId, { meta: string; tiktok: string }>> = {
  shop_now: { meta: "Shop now", tiktok: "Shop Now" },
  learn_more: { meta: "Learn more", tiktok: "Learn More" },
  order_now: { meta: "Order now", tiktok: "Order Now" },
};

export interface UgcFormatSpec {
  id: UgcFormat;
  label: string;
  /** Where the format comes from: a Meta-friendly format or a TikTok hook. */
  family: "meta" | "tiktok";
  /** What the first second does. */
  hookType: string;
  /** How the product-demo beat is staged. */
  demoBeat: string;
  cta: CtaId;
  /** Prefix for the on-screen hook line, e.g. "POV: ". Empty for most formats. */
  textPrefix: string;
  /**
   * The format reads as a customer's own experience (someone trying it, or opening their order). An AI
   * actor in it would be a person who does not exist shown using the product, which the FTC rule bans,
   * so these go to human creators only and AI-actor tools get the product demo instead (plan, section 12).
   */
  customerVoice: boolean;
  /** Words in the concept that point to this format. Matches in the hook scene count double. */
  signals: readonly RegExp[];
}

export const UGC_FORMAT_SPECS: Readonly<Record<UgcFormat, UgcFormatSpec>> = {
  product_demo: {
    id: "product_demo",
    label: "Product demo",
    family: "meta",
    hookType: "Show the product working in the first second.",
    demoBeat: "The product in use, close enough to see what it does.",
    cta: "shop_now",
    textPrefix: "",
    customerVoice: false,
    // The default: picked when no other format's beats show up in the concept.
    signals: [],
  },
  before_after: {
    id: "before_after",
    label: "Before and after",
    family: "meta",
    hookType: "Open on the before, so the change is the hook.",
    demoBeat: "The same moment after the product, framed the same way.",
    cta: "shop_now",
    textPrefix: "",
    customerVoice: false,
    signals: [
      /\bbefore\b[^.]*\bafter\b/,
      /\bsplit[- ]screen\b/,
      /\btransforms?\b/,
      /\bturns? into\b/,
      /\bthe difference\b/,
      /\bscuff\w*/,
      /\bmud(?:dy)?\b/,
      /\bstain\w*/,
      /\bdull\b/,
      /\bgrime\b/,
      /\bdirty\b/,
      /\b(?:good as|brand) new\b/,
    ],
  },
  founder_story: {
    id: "founder_story",
    label: "Founder story",
    family: "meta",
    hookType: "Open on the making: who makes it and why, in the brand's own words.",
    demoBeat: "The product being made or finished, then in use.",
    cta: "learn_more",
    textPrefix: "",
    customerVoice: false,
    signals: [/\bfounders?\b/, /\bwe (?:make|made|started|roast|pour|bake|sew)\b/, /\bour (?:kitchen|studio|workshop|roastery)\b/, /\bsmall[- ]batch(?:es)?\b/, /\bhand[- ](?:made|poured|sewn|roasted)\b/],
  },
  problem_solution: {
    id: "problem_solution",
    label: "Problem and solution",
    family: "meta",
    hookType: "Name the everyday problem in the first second.",
    demoBeat: "The product solving it on screen.",
    cta: "shop_now",
    textPrefix: "",
    customerVoice: false,
    signals: [
      /\bproblem\b/,
      /\bbland\b/,
      /\bboring\b/,
      /\btired of\b/,
      /\binstead of\b/,
      /\bno more\b/,
      /\bminus\b/,
      /\bdoes(?:n't| not) need\b/,
      /\bdeserves? better\b/,
      /\bends? here\b/,
      /\bfix(?:es)?\b/,
      /\bstuck\b/,
    ],
  },
  pov: {
    id: "pov",
    label: "POV",
    family: "tiktok",
    hookType: "A first-person view with a \"POV:\" line on screen.",
    demoBeat: "The product used from the viewer's point of view.",
    cta: "shop_now",
    textPrefix: "POV: ",
    customerVoice: false,
    signals: [/\bpov\b/, /\bpoint of view\b/, /\bfirst[- ]person\b/],
  },
  unboxing: {
    id: "unboxing",
    label: "Unboxing",
    family: "tiktok",
    hookType: "Open on the package, about to be opened.",
    demoBeat: "The product coming out of its box, then in use.",
    cta: "order_now",
    textPrefix: "",
    customerVoice: true,
    signals: [
      /\bunbox\w*/,
      /\bparcel\b/,
      /\bmailer\b/,
      /\bpackag(?:e|ing)\b/,
      /\bdelivery\b/,
      /\b(?:shipping|doorstep) box\b/,
      /\btears? (?:it )?open\b/,
      /\bopens? the (?:box|bag|package)\b/,
    ],
  },
  first_try: {
    id: "first_try",
    label: "First try",
    family: "tiktok",
    hookType: "The first taste or use on camera, with the reaction as the hook.",
    demoBeat: "The first use, then the reaction.",
    cta: "shop_now",
    textPrefix: "",
    customerVoice: true,
    signals: [
      /\bfirst (?:bite|taste|sip|try|spray|wear|use|time)\b/,
      /\b(?:takes?|taking) (?:a|the|her|his|their) (?:bite|sip|taste|spoonful)\b/,
      /\b(?:raised[- ]eyebrow|raises an eyebrow|eyebrow (?:rises|lifts))\b/,
      /\breaction\b/,
      /\btastes? it\b/,
      /\btries it\b/,
    ],
  },
};

/** When two formats score the same, the earlier one here wins; product demo is the fallback. */
export const FORMAT_TIE_ORDER: readonly UgcFormat[] = ["pov", "unboxing", "before_after", "first_try", "problem_solution", "founder_story"];
