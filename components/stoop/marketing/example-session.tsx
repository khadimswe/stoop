"use client";

import { useSyncExternalStore } from "react";
import { Screen } from "@/components/stoop/screen";
import { exampleSession, type SessionTurn } from "@/lib/marketing/mcp-session";
import { cn } from "cn";

const noSubscription = () => () => {};
const WHO: Record<SessionTurn["who"], string> = { you: "You", claude: "Claude", stoop: "Stoop" };

/** /mcp's example session, clearly marked as one, with links on the page's own origin once it hydrates. */
export function ExampleSession({ fallbackOrigin }: { fallbackOrigin: string }) {
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => fallbackOrigin);
  const session = exampleSession(origin);
  return (
    <Screen className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
      <p className="font-mono text-xs text-paper-dim">
        Example session, shortened. The score_brief answer is replayed from recorded Qloo responses; the run id is a placeholder.
      </p>
      <ol className="flex flex-col gap-4">
        {session.map((turn, i) => (
          <li key={i} className={cn("flex flex-col gap-1.5", turn.who === "you" && "sm:pl-16")}>
            <p className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-wide text-paper-dim uppercase">
              {WHO[turn.who]}
              {turn.tool && (
                <span className="rounded-full border-[1.5px] border-dusk-light px-2 py-0.5 font-mono text-[0.6875rem] tracking-normal text-dusk-light normal-case">
                  {turn.tool}
                </span>
              )}
            </p>
            <p
              className={cn(
                "rounded-xl p-3 text-sm leading-relaxed break-words whitespace-pre-wrap",
                turn.who === "stoop" ? "bg-screen-raised font-mono text-[0.8125rem] text-paper" : turn.who === "you" ? "border border-paper/25 text-paper" : "text-paper",
              )}
            >
              {turn.text}
            </p>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
