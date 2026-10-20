// The whole report page as view models, one per section, in screen order. Server components call this
// and pass each section its own slice; each section's builder (and its types) lives in its own file
// next to this one.
import type { DemoMedia } from "../../demo/manifest";
import type { Report } from "../schema";
import { headerView, type HeaderView } from "./header";
import { kitView, type KitView } from "./kit";
import { launchPlanView, type LaunchPlanView } from "./launch";
import { outputViews, type OutputView } from "./output";
import { realityView, type RealityView } from "./reality";
import { ledgerOf } from "./receipts";
import { screeningView, type ScreeningView } from "./screening";
import { whyView, type WhyView } from "./why";
import { yourAdView, type YourAdView } from "./your-ad";

export interface ReportView {
  header: HeaderView;
  reality: RealityView | null;
  yourAd: YourAdView | null;
  /** The worlds in segment order, then the Control. */
  outputs: OutputView[];
  screening: ScreeningView;
  kit: KitView;
  /** Each concept world as a test cell against the generic Control. */
  launch: LaunchPlanView;
  why: WhyView;
}

export interface ReportViewOptions {
  /** An example's approved demo media (lib/report/load.ts). Omit on live reports. */
  media?: DemoMedia | null;
}

export function reportView(report: Report, { media = null }: ReportViewOptions = {}): ReportView {
  const ledger = ledgerOf(report);
  const outputs = outputViews(report, { media });
  const top = outputs[0]?.isControl ? undefined : outputs[0];
  return {
    header: headerView(report),
    reality: realityView(report, ledger),
    yourAd: yourAdView(report.worlds[0], top),
    outputs,
    screening: screeningView(report, ledger, media),
    kit: kitView(report, media),
    launch: launchPlanView(report, ledger),
    why: whyView(report, ledger),
  };
}
