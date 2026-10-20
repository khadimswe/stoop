"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button, buttonVariants } from "@/components/ui/button";
import { byokHref, useDraftRender, useRenderAccess, type DraftState } from "@/hooks/use-render-access";
import type { RenderAccessResponse } from "@/lib/api/responses";
import type { RenderTarget } from "@/lib/render/schema";
import type { VideoView } from "@/lib/report/view/output";
import { cn } from "cn";

// The Output section's "Video" line for one world (or the Control). An approved example clip plays
// first. Then what this visitor may do, which the static page only learns after mount from
// GET /api/render/access: a judge renders a server-paid draft, anyone else may render with their own
// fal key on /byok, a spent budget says so plainly, and "off" points to the prompts. A missing video
// never looks like a failure: the storyboard above is the preview.

/** At cap. It mentions the example clip only when one is approved for this world: the copy must be true. */
export function budgetUsedLine(hasClip: boolean): string {
  return hasClip ? "Render budget used. Here's the storyboard and the example clip." : "Render budget used. Here's the storyboard.";
}
const OFF_LINE = "Stoop is the brain, you bring your own camera. Copy the prompts below into your video tool.";

function Elapsed({ since }: { since: number }) {
  // Starts at the true elapsed time, also for a draft resumed after a reload (shown only after mount).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="font-mono tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</span>;
}

/** "Render with your fal key": a plain anchor, because /byok needs a full page load for its own CSP. */
export function ByokLink({ target }: { target: RenderTarget }) {
  return (
    <a href={byokHref(target)} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline" }), "gap-2 focus-visible:outline-solid")}>
      Render with your fal key
      <ExternalLink aria-hidden="true" className="size-4" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function Line({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-ink-soft", className)}>{children}</p>;
}

function AccessLine({
  access,
  target,
  draft,
  start,
  hasClip,
}: {
  access: RenderAccessResponse | null;
  target: RenderTarget;
  draft: DraftState;
  start: () => void;
  /** An approved example clip for this world plays above. */
  hasClip: boolean;
}) {
  // A draft in progress, or its outcome, comes first.
  switch (draft.phase) {
    case "starting":
      return (
        <Button variant="outline" disabled className="self-start focus-visible:outline-solid">
          Starting the draft
        </Button>
      );
    case "rendering":
      // The status is announced once; the ticking timer stays out of the live region.
      return (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-ink">
          <p role="status">Rendering a 15 s draft. It takes a few minutes; keep reading meanwhile.</p>
          <span aria-hidden="true">
            <Elapsed since={draft.startedAt} />
          </span>
        </div>
      );
    case "done":
      return <Line>AI-generated draft, 480p, from this Production Pack.{draft.cached && " Rendered before, so it was reused at no cost."} Watch it before posting anything.</Line>;
    case "timeout":
      return <Line>Still rendering. Reload this page in a few minutes to see the draft.</Line>;
    case "budget-used":
      return (
        <div className="flex flex-col items-start gap-2">
          <Line>{budgetUsedLine(hasClip)}</Line>
          {access?.byok && <ByokLink target={target} />}
        </div>
      );
    case "failed":
    case "error": {
      // Not while an earlier try at this exact draft may still be rendering (a 409 busy).
      const again = access?.video === "judge" && access.rendersLeft !== 0 && (draft.phase === "failed" || draft.retry);
      return (
        <div className="flex flex-col items-start gap-2">
          <Line>{draft.phase === "failed" ? "This draft didn't finish. The storyboard and the prompts still work." : draft.message}</Line>
          {again && (
            <Button variant="outline" onClick={start} className="focus-visible:outline-solid">
              Try the draft again
            </Button>
          )}
        </div>
      );
    }
    case "idle":
      break;
  }

  if (!access) return <Line className="min-h-11 content-center">{OFF_LINE}</Line>;
  switch (access.video) {
    case "judge":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" onClick={start} className="focus-visible:outline-solid">
            Render draft video
          </Button>
          <span className="text-xs text-ink-soft">
            {access.rendersLeft !== null && `${access.rendersLeft} ${access.rendersLeft === 1 ? "draft" : "drafts"} left on your judge pass · `}
            15 s, 480p, from the prompt below
          </span>
        </div>
      );
    case "byok":
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ByokLink target={target} />
          <span className="text-xs text-ink-soft">Your key goes only to fal, never to Stoop.</span>
        </div>
      );
    case "budget-used":
      return (
        <div className="flex flex-col items-start gap-2">
          <Line>{budgetUsedLine(hasClip)}</Line>
          {access.byok && <ByokLink target={target} />}
        </div>
      );
    case "off":
      return <Line>{OFF_LINE}</Line>;
  }
}

export function VideoLine({ video, target, tone }: { video: VideoView; target: RenderTarget; tone: "culture" | "control" }) {
  const { state, refresh } = useRenderAccess(target);
  const { state: draft, start } = useDraftRender(target, refresh);
  const access = state.status === "ready" ? state.access : null;

  return (
    <div className="flex flex-col gap-3" aria-busy={state.status === "loading"}>
      {(video.clip || draft.phase === "done") && (
        <div className="flex flex-wrap gap-3">
          {video.clip && (
            <Screen variant="app" className="w-32 p-1.5 sm:w-36">
              <VideoTile
                label={tone === "control" ? "Control" : "Example clip"}
                tone={tone}
                src={video.clip.src}
                poster={video.clip.poster ?? undefined}
                captions={video.clip.captions ?? undefined}
                className="rounded-xl"
              />
            </Screen>
          )}
          {draft.phase === "done" && (
            <Screen variant="app" className="w-32 p-1.5 sm:w-36">
              <VideoTile label="AI-generated draft" tone={tone} src={draft.videoUrl} className="rounded-xl" />
            </Screen>
          )}
        </div>
      )}
      <AccessLine access={access} target={target} draft={draft} start={start} hasClip={video.clip !== null} />
    </div>
  );
}
