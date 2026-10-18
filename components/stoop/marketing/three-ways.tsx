import { ArrowRight, Clapperboard, MessageSquareText, MousePointerClick, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";

interface Way {
  title: string;
  line: string;
  href: string;
  linkLabel: string;
  icon: LucideIcon;
}

// Draft copy for the founder to approve (copy.md voice: short, plain, specific).
const WAYS: Way[] = [
  {
    title: "In the browser",
    line: "Paste a product link. Get the Reality Check, concept worlds and a Campaign Kit.",
    href: "/start",
    linkLabel: "Try it free",
    icon: MousePointerClick,
  },
  {
    title: "In your Claude",
    line: "Connect Stoop to Claude and ask for a Culture Brief in the middle of a chat.",
    href: "/mcp",
    linkLabel: "Set it up",
    icon: MessageSquareText,
  },
  {
    title: "Export to your video tool",
    line: "Copy scene prompts written for Higgsfield, Veo, Kling or Runway, and render where you already work.",
    href: `/examples/${LEAD_EXAMPLE.slug}#output`,
    linkLabel: "See a pack",
    icon: Clapperboard,
  },
];

/** Below the shelf: three ways in, text first on paper. No screens and no sticker shadow, so it never competes with the hero. */
export function ThreeWays() {
  return (
    <section aria-labelledby="three-ways-title" className="mx-auto max-w-6xl px-5 pb-20">
      <h2 id="three-ways-title" className="type-kicker mb-5 text-ink-soft">
        Three ways to use it
      </h2>
      <ul className="grid gap-x-8 gap-y-6 border-t-2 border-ink pt-6 md:grid-cols-3">
        {WAYS.map(({ title, line, href, linkLabel, icon: Icon }) => (
          <li key={title} className="flex flex-col items-start gap-2">
            <Icon aria-hidden="true" className="size-6 text-ink" strokeWidth={2.2} />
            <h3 className="font-display text-xl leading-tight font-extrabold [font-stretch:88%]">{title}</h3>
            <p className="max-w-[30ch] text-base leading-snug text-pretty text-ink-soft">{line}</p>
            <Link
              href={href}
              className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick"
            >
              {linkLabel}
              <span className="sr-only">: {title.toLowerCase()}</span>
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
