import type { ReactNode } from "react";
import type { ReportView } from "@/lib/report/view/types";
import { StickyBar } from "../sticky-bar";
import { ReportHeader } from "./sections/header";
import { KitSection } from "./sections/kit";
import { OutputSection } from "./sections/output";
import { RealitySection } from "./sections/reality";
import { ReportNav } from "./sections/report-nav";
import { ScreeningSection } from "./sections/screening";
import { WhySection } from "./sections/why";
import { YourAdSection } from "./sections/your-ad";

/**
 * The report, one scrolling page, for examples and live runs alike. Order: the banner slot, the
 * header, the Reality Check (beat 1), "Your ad", Output, then the sticky nav and its three sections
 * (Screening Room, Campaign Kit, Why it works), then the sticky bar. Each section lives in its own
 * file under ./sections and takes only its own view model, so a lane changes one file, not this one.
 * A server component: pass it a view built on the server (lib/report/view/report.ts).
 *
 * - `banner`: the judge pass strip (./sections/judge-banner.tsx), decided on the client, since the
 *   pass is a cookie and example pages are static.
 * - `stickyAction`: replaces the examples' "Make this for my product" (live: "Email me this kit").
 */
export function ReportPage({ view, banner, stickyAction }: { view: ReportView; banner?: ReactNode; stickyAction?: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pt-6 pb-16 sm:px-5 sm:pt-8">
        {banner}
        <ReportHeader view={view.header} />
        <RealitySection view={view.reality} />
        <YourAdSection view={view.yourAd} />
        <OutputSection views={view.outputs} />
        <ReportNav />
        <ScreeningSection view={view.screening} />
        <KitSection view={view.kit} />
        <WhySection view={view.why} />
      </div>
      <StickyBar note={view.header.kind === "example" ? "Want this for your product?" : undefined} action={stickyAction} />
    </main>
  );
}
