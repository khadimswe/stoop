import Link from "next/link";
import { CopyButton } from "@/components/stoop/copy-button";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import type { OutputView, VideoView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { Storyboard } from "../storyboard";

// Stub (report-top lane): per world and for the Control, one line each: the concept preview, the
// video, the copy-ready prompts and the MCP link. A missing video never looks like a failure. Render
// buttons stay disabled until the render lane wires them.
function Video({ view, tone }: { view: VideoView; tone: "control" | "culture" }) {
  switch (view.kind) {
    case "clip":
      return (
        <Screen variant="app" className="w-40 p-2">
          <VideoTile label={view.clip.label} tone={tone} src={view.clip.src} poster={view.clip.poster ?? undefined} captions={view.clip.captions ?? undefined} />
        </Screen>
      );
    // Ink outline: the brick sticky bar stays the one primary per view.
    case "judge":
      return (
        <Button variant="outline" size="sm" className="self-start" disabled>
          Render draft video
        </Button>
      );
    case "byok":
      return (
        <Button variant="outline" size="sm" className="self-start" disabled>
          Render with your fal key
        </Button>
      );
    case "budget-used":
      return <p className="text-sm text-ink-soft">Render budget used. Here&apos;s the storyboard and the example clip.</p>;
    case "off":
      return <p className="text-sm text-ink-soft">Stoop is the brain, you bring your own camera: copy the prompt into your video tool.</p>;
  }
}

function Output({ view }: { view: OutputView }) {
  const ex = view.export;
  return (
    <article aria-labelledby={`output-${view.key}`} className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <h3 id={`output-${view.key}`} className="font-display text-lg leading-snug font-bold [font-stretch:90%]">
        {view.label}
        {view.isControl && <span className="ml-2 align-middle text-xs font-semibold text-ink-soft">LLM-only brief, not from Qloo</span>}
      </h3>
      {view.partial && <p className="text-sm text-ink-soft">Partial: {view.partial.reason}</p>}
      <Storyboard view={view.storyboard} />
      <Video view={view.video} tone={view.isControl ? "control" : "culture"} />
      {ex && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          {ex.multiShot && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-semibold">{ex.multiShot.modelName}</span>{" "}
                <span className="text-ink-soft">· one multi-shot clip, {ex.multiShot.trimTo} s</span>
              </p>
              <CopyButton text={ex.multiShot.prompt} label="Copy prompt" />
            </div>
          )}
          {ex.veo && (
            <ul className="flex flex-col gap-1">
              {ex.veo.prompts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {ex.veo?.modelName} · scene {p.scenes.join(", ")}
                  </span>
                  <CopyButton text={p.prompt} label={`Copy scene ${p.scenes.join(", ")}`} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-soft">
            Render first: {ex.references.assets.map((a) => a.file).join(", ")}.
            {ex.references.otherModels.length > 0 &&
              ` Also in the kit: ${ex.references.otherModels.map((m) => `${m.modelName} (${m.prompts} prompts)`).join(", ")}.`}
          </p>
        </div>
      )}
      <Link href={view.mcp.href} className="self-start text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
        {view.mcp.label}
      </Link>
    </article>
  );
}

export function OutputSection({ views }: { views: OutputView[] }) {
  return (
    <ReportSection id={REPORT_SECTIONS.output} title="Output" description="Copy-ready prompts for each concept world, plus the generic Control.">
      <div className="flex flex-col gap-3">
        {views.map((view) => (
          <Output key={view.key} view={view} />
        ))}
      </div>
    </ReportSection>
  );
}
