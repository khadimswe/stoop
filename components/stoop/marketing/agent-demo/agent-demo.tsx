import Link from "next/link";
import { Screen } from "@/components/stoop/screen";
import { cn } from "cn";
import type { DemoScript } from "@/lib/marketing/demo-types";
import { AgentDemoLazy } from "./lazy";

export interface AgentDemoProps {
  /** Built on the server from a recorded run: `loadDemoScript()` from lib/marketing/demo-source.ts. */
  script: DemoScript;
  /**
   * "screen" (default): a section with its own dark screen. "fill": inside a screen the page already
   * draws (the landing's AgentDemoSlot, given AGENT_DEMO_SLOT_CLASS so the replay sets its height).
   */
  frame?: "screen" | "fill";
  className?: string;
}

/** For AgentDemoSlot's `className`: the replay's own fixed shape sets the screen's height, so nothing shifts. */
export const AGENT_DEMO_SLOT_CLASS = "aspect-auto sm:aspect-auto md:aspect-auto lg:aspect-auto";

/**
 * The landing's "agent at work" demo: a replay of a real recorded run inside a dark screen, from the
 * composer to the launch plan. Every word and number comes from the run. A server component: the
 * frame, the label and a plain summary for screen readers render on the server; the player loads
 * as its own chunk once the demo nears the viewport. The landing's H1 stays the LCP element.
 */
export function AgentDemo({ script, frame = "screen", className }: AgentDemoProps) {
  const inside = (
    <>
      <p className="sr-only">{script.summary}</p>
      <Link
        href={script.reportHref}
        className="sr-only rounded-full bg-paper px-4 py-3 text-sm font-semibold text-ink focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-10 focus-visible:outline-dusk-light"
      >
        Skip the replay: open the full report
      </Link>
      <AgentDemoLazy script={script} />
    </>
  );
  if (frame === "fill") return <div className={cn("@container", className)}>{inside}</div>;
  return (
    <section aria-label="Agent demo: a replay of a recorded Stoop run" className={cn("@container", className)}>
      <Screen variant="stage" className="relative overflow-hidden">
        {inside}
      </Screen>
    </section>
  );
}
