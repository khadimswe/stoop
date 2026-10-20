import { SectionHeading } from "@/components/stoop/section-heading";
import type { LaunchPlanView } from "@/lib/report/view/types";
import { LaunchPlan } from "../launch/launch-plan";

/** The Launch plan's section id, for the sticky nav and in-page links. */
export const LAUNCH_SECTION_ID = "launch";

/**
 * The Launch plan: the bridge from who the ads are for to how to spend on them. Each concept world
 * becomes a test cell next to the generic Control, with an even budget split, one rule to call it
 * relative to the Control, and a launch sheet to set up by hand. Stoop never touches an ad account.
 * A server component; the budget helper and exports are the client part (../launch). Same frame as
 * ReportSection (a labeled landmark that clears the app bar and the sticky nav).
 *
 * - `reportPath`: the report the prompt links point at, when this renders outside it (the preview).
 */
export function LaunchSection({ view, reportPath }: { view: LaunchPlanView; reportPath?: string }) {
  return (
    <section id={LAUNCH_SECTION_ID} aria-labelledby={`${LAUNCH_SECTION_ID}-title`} data-report-section={LAUNCH_SECTION_ID} className="flex scroll-mt-28 flex-col gap-4">
      <SectionHeading
        id={`${LAUNCH_SECTION_ID}-title`}
        title="Launch plan"
        description="A fair test of each concept world against the generic AI brief: equal budgets, the same placements and one rule to call it."
      />
      {view.unavailable ? (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-4 text-sm sm:p-5">
          <p>{view.unavailable}</p>
          {view.skipped.map((s) => (
            <p key={s.label} className="text-ink-soft">
              {s.label}: {s.reason}
            </p>
          ))}
        </div>
      ) : (
        <LaunchPlan view={view} reportPath={reportPath} />
      )}
    </section>
  );
}
