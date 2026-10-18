"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { hasJudgeHint, useRenderAccess } from "@/hooks/use-render-access";
import type { RenderTarget } from "@/lib/render/schema";
import type { JudgeBannerView } from "@/lib/report/view/types";
import { BUDGET_USED } from "../output/video-line";

// The judge pass strip above the Reality Check. Example pages are static, so it decides on the client:
// the hint cookie (readable by scripts, never the credential) says a pass may be active, then
// GET /api/render/access says what it unlocks. It claims renders are unlocked only when the access
// answer is "judge"; a spent budget says so plainly; without a pass it renders nothing. A quiet
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
  // While the answer is on its way, hold the strip's place so the page below does not jump twice.
  if (!access) return <div aria-hidden="true" className="h-14 rounded-xl border border-hairline bg-surface sm:h-[3.25rem]" />;
  if (access.video !== "judge" && access.video !== "budget-used") return null;

  return (
    <aside aria-label="Judge pass" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-hairline bg-surface px-4 py-2">
      <p className="flex min-h-9 items-center gap-2 text-sm">
        <KeyRound aria-hidden="true" className="size-4 shrink-0 text-ink" />
        {access.video === "judge" ? (
          <span>
            <span className="font-semibold">Judge pass active: video renders unlocked</span>
            {access.rendersLeft !== null && (
              <span className="text-ink-soft">
                {" "}
                · {access.rendersLeft} {access.rendersLeft === 1 ? "draft" : "drafts"} left
              </span>
            )}
          </span>
        ) : (
          <span>
            <span className="font-semibold">Judge pass active.</span> <span className="text-ink-soft">{BUDGET_USED}</span>
          </span>
        )}
      </p>
      <Button asChild variant="outline" size="sm" className="h-11 focus-visible:outline-solid sm:h-9">
        <Link href={view.tryHref}>Try it with your link</Link>
      </Button>
    </aside>
  );
}
