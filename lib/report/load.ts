// The three example reports and their approved demo media, for pages. Static JSON imports bundle
// with the server code, so an example page prerenders with no file reads and needs no file tracing
// (lib/runtime/examples.ts reads the same files with fs, for the API routes).
//
// Server only: each report is about 500 KB. Server components call these and hand client components
// narrow view models (lib/report/view), never a Report. `server-only` turns an accidental client
// import into a build error; tests stub it with vi.mock.
import "server-only";
import foodHotSauce from "@/data/runs/food-hot-sauce/run.report.json";
import homeCandles from "@/data/runs/home-candles/run.report.json";
import petsOutfits from "@/data/runs/pets-outfits/run.report.json";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import { approvalsSchema, demoMediaFor, manifestSchema, type DemoApprovals, type DemoManifest, type DemoMedia } from "../demo/manifest";
import { reportSchema, type Report } from "./schema";

const RAW: Record<ExampleSlug, unknown> = {
  "food-hot-sauce": foodHotSauce,
  "home-candles": homeCandles,
  "pets-outfits": petsOutfits,
};

export function isExampleSlug(value: string): value is ExampleSlug {
  return EXAMPLES.some((e) => e.slug === value);
}

const reports = new Map<ExampleSlug, Report>();

/** One example's Report, validated against the contract the first time it is asked for. */
export function loadExampleReport(slug: ExampleSlug): Report {
  let report = reports.get(slug);
  if (!report) {
    report = reportSchema.parse(RAW[slug]);
    reports.set(slug, report);
  }
  return report;
}

let media: { manifest: DemoManifest; approvals: DemoApprovals } | null = null;

/** The example's approved demo media (packshot, storyboards, clips). Unapproved renders are left out. */
export function loadExampleMedia(slug: ExampleSlug): DemoMedia {
  media ??= { manifest: manifestSchema.parse(manifest), approvals: approvalsSchema.parse(approvals) };
  return demoMediaFor(media.manifest, media.approvals, slug);
}
