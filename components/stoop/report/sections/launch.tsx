import type { LaunchPlanView } from "@/lib/report/view/types";
import { LaunchPlan } from "../launch/launch-plan";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

/**
 * The Launch plan: the bridge from who the ads are for to how to spend on them. Each concept world
 * becomes a test cell next to the generic Control, with an even budget split, one rule to call it
 * relative to the Control, and a launch sheet to set up by hand. Stoop never touches an ad account.
 * The budget helper and exports are the client part (../launch).
 */
export function LaunchSection({ view }: { view: LaunchPlanView }) {
  return (
    <ReportSection
      id={REPORT_SECTIONS.launch}
      title="Launch plan"
      description="A fair test of each concept world against the generic AI brief: equal budgets, the same placements and one rule to call it."
    >
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
        <LaunchPlan view={view} />
      )}
    </ReportSection>
  );
}
