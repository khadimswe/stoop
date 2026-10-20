// The three example reports and their approved demo media, for pages. Each report is read from
// data/runs/<slug>/run.report.json with a synchronous file read: Next prerenders a page whose only
// I/O is synchronous, so the example pages stay fully static and read nothing at request time
// (lib/runtime/examples.ts reads the same files for the API routes). The reports are Qloo response
// data, so the public repository leaves them out; a read then throws with the command that writes them.
//
// Server only: each report is about 500 KB. Server components call these and hand client components
// narrow view models (lib/report/view), never a Report. `server-only` turns an accidental client
// import into a build error; tests stub it with vi.mock.
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import { approvalsSchema, demoMediaFor, manifestSchema, type DemoApprovals, type DemoManifest, type DemoMedia } from "../demo/manifest";
import { reportSchema, type Report } from "./schema";

/** Where an example's stored report lives, relative to the project root. */
export const exampleReportFile = (slug: ExampleSlug) => path.join("data", "runs", slug, "run.report.json");

export function isExampleSlug(value: string): value is ExampleSlug {
  return EXAMPLES.some((e) => e.slug === value);
}

const reports = new Map<ExampleSlug, Report>();

function readReport(slug: ExampleSlug): unknown {
  const file = path.join(process.cwd(), exampleReportFile(slug));
  if (!existsSync(file)) {
    throw new Error(
      `The stored example report is missing (${exampleReportFile(slug)}). The examples are Qloo response data, so the public repository leaves them out. Write them from your own recordings with \`npm run example -- ${slug} --record\` (README: "Data and the Qloo API").`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** One example's Report, validated against the contract the first time it is asked for. */
export function loadExampleReport(slug: ExampleSlug): Report {
  let report = reports.get(slug);
  if (!report) {
    report = reportSchema.parse(readReport(slug));
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
