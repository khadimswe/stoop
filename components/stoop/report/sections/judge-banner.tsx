"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { hasJudgeHint, useRenderAccess } from "@/hooks/use-render-access";
import type { RenderTarget } from "@/lib/render/schema";
import type { JudgeBannerView } from "@/lib/report/view/types";
import { cn } from "cn";

// The judge pass strip above the Reality Check. Example pages are static, so it decides on the client:
// the hint cookie (readable by scripts, never the credential) says a pass may be active, then
// GET /api/render/access says what it unlocks. It claims renders are unlocked only when the access
// answer is "judge"; spent pass drafts are said plainly; without the hint it renders nothing. A quiet
// app-register strip: no timer, an ink outline button, the brick sticky bar stays the one primary.

const noSubscription = () => () => {};

export function JudgeBanner({ target, view = { tryHref: "/start" } }: { target: RenderTarget | null; view?: JudgeBannerView }) {
  const hint = useSyncExternalStore(
    noSubscription,
    () => hasJudgeHint(document.cookie),
    () => false,
  );
  const { state } = useRenderAccess(hint ? target : null);
  if (!hint || !target) return null;

  const access = state.status === "ready" ? state.access : null;
  const shown = access !== null && (access.video === "judge" || access.video === "budget-used");
  // With the hint set, the strip keeps its place while the answer is on its way, and also when the hint
  // turns out stale (an ended pass), so the page below never jumps. Hidden, it is invisible to everyone.
  return (
    <aside
      aria-label={shown ? "Judge pass" : undefined}
      aria-hidden={shown ? undefined : true}
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-hairline bg-surface px-4 py-2", !shown && "invisible")}
    >
      <p className="flex min-h-9 items-center gap-2 text-sm">
        <KeyRound aria-hidden="true" className="size-4 shrink-0 text-ink" />
        {access?.video === "budget-used" ? (
          // The pass's own drafts are spent: no promise of a clip or a storyboard here.
          <span className="font-semibold">Judge pass active. Its draft renders are used.</span>
        ) : (
          <span>
            <span className="font-semibold">Judge pass active: video renders unlocked</span>
            {access?.video === "judge" && access.rendersLeft !== null && (
              <span className="text-ink-soft">
                {" "}
                · {access.rendersLeft} {access.rendersLeft === 1 ? "draft" : "drafts"} left
              </span>
            )}
          </span>
        )}
      </p>
      <Button asChild variant="outline" size="sm" className="h-11 focus-visible:outline-solid sm:h-9">
        <Link href={view.tryHref}>Try it with your link</Link>
      </Button>
    </aside>
  );
}
