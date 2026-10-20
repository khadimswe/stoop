import Link from "next/link";
import type { ReactNode } from "react";
import { Screen } from "@/components/stoop/screen";
import { cn } from "cn";
import type { DemoScript } from "@/lib/marketing/demo-types";
import { AgentDemoLazy } from "./lazy";

export interface AgentDemoProps {
  /** Built on the server from a recorded run: `loadDemoScript()` from lib/marketing/demo-source.ts. */
  script: DemoScript;
  /** Replaces the Launch plan placeholder in the last beat (a server-rendered element). */
  launchPlan?: ReactNode;
  /** The review route only: lets `?speed=` in the URL speed the replay up, for review and e2e. */
  speedParam?: boolean;
  className?: string;
}

/**
 * The landing's "agent at work" demo: a replay of a real recorded run inside a dark screen, from the
 * composer to the launch plan. Every word and number comes from the run. A server component: the
 * frame, the label and a plain summary for screen readers render on the server; the player loads
 * as its own chunk once the demo nears the viewport. The landing's H1 stays the LCP element.
 */
export function AgentDemo({ script, launchPlan, speedParam = false, className }: AgentDemoProps) {
  return (
    <section aria-label="Agent demo: a replay of a recorded Stoop run" className={cn("@container", className)}>
      <Screen variant="stage" className="relative overflow-hidden">
        <p className="sr-only">{script.summary}</p>
        <Link
          href={script.reportHref}
          className="sr-only rounded-full bg-paper px-4 py-2.5 text-sm font-semibold text-ink focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-10 focus-visible:outline-dusk-light"
        >
          Skip the replay: open the full report
        </Link>
        <AgentDemoLazy script={script} launchPlan={launchPlan} speedParam={speedParam} />
      </Screen>
    </section>
  );
}
