import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { headerView } from "./header";
import { kitView } from "./kit";
import { launchPlanView } from "./launch";
import { outputViews } from "./output";
import { realityView } from "./reality";
import { ledgerOf } from "./receipts";
import { reportView } from "./report";
import { screeningView } from "./screening";
import { whyView } from "./why";
import { describeRecorded } from "../../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describeRecorded.each(EXAMPLES)("the report view for $slug", ({ slug, brandName }) => {
  const report = read(slug);
  const view = reportView(report);

  it("heads the page with the brand, the recorded provenance and the date", () => {
    expect(view.header).toEqual({
      kind: "example",
      title: brandName,
      productName: report.inputs.product.name,
      brandName,
      provenance: "recorded",
      date: "Oct 16, 2026",
      partial: null,
      // The recorded run replays on /run with zero API calls ("Watch the agent build this").
      runHref: `/run/${report.meta.id}`,
    });
  });

  it("composes every section from its own builder", () => {
    const ledger = ledgerOf(report);
    expect(view).toEqual({
      header: headerView(report),
      reality: realityView(report, ledger),
      yourAd: view.yourAd,
      outputs: outputViews(report),
      screening: screeningView(report, ledger, null),
      kit: kitView(report),
      launch: launchPlanView(report, ledger),
      why: whyView(report, ledger),
    });
    expect(view.yourAd?.segmentId).toBe(report.worlds[0].segmentId);
  });

  it("keeps every view serializable for client components", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
