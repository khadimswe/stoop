// The report header: product, provenance and the date the run was recorded. Also the judge pass
// banner's props (the banner itself is decided on the client: the pass is a cookie).
import { exampleRunHref, exampleSlugOf } from "../../run/start";
import type { Report } from "../schema";
import { formatDate } from "./format";
import type { PartialView } from "./types";

export interface HeaderView {
  kind: "example" | "live";
  /** The page's h1: the brand when there is one, else the product. */
  title: string;
  productName: string;
  brandName: string | null;
  provenance: "recorded" | "live" | "partial";
  /** When the run was recorded, e.g. "Oct 16, 2026" (fixed locale and time zone). */
  date: string;
  /** Set when the run stopped early: the report still shows what was measured. */
  partial: PartialView | null;
  /** An example's recorded run replayed on /run ("Watch the agent build this"); null on live reports. */
  runHref: string | null;
}

/**
 * The judge pass strip ("Judge pass active: video renders unlocked"). Whether it shows depends on
 * the pass cookie, which a static page cannot read on the server, so it is not part of ReportView:
 * the page passes the banner into ReportPage's `banner` slot when the pass is active.
 */
export interface JudgeBannerView {
  /** "Try it with your link". */
  tryHref: "/start";
}

export function headerView(report: Report): HeaderView {
  const { product } = report.inputs;
  return {
    kind: report.meta.kind,
    title: product.brandName ?? product.name,
    productName: product.name,
    brandName: product.brandName ?? null,
    provenance: report.meta.provenance,
    date: formatDate(report.meta.createdAt),
    partial: report.partial,
    runHref: exampleRunHrefOf(report),
  };
}

/** /run/example-<slug> for an example report (a replay with zero API calls), else null. */
export function exampleRunHrefOf(report: Pick<Report, "meta">): string | null {
  if (report.meta.kind !== "example") return null;
  const slug = exampleSlugOf(report.meta.id);
  return slug ? exampleRunHref(slug) : null;
}
