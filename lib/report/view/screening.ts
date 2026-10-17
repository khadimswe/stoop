// The Screening Room: the Control once, then one row per world with its measured age skew and the
// setting city, each with its receipt. Clips show only when approved.
import type { DemoMedia } from "../../demo/manifest";
import type { Report } from "../schema";
import { skewText } from "./format";
import { approvedClip } from "./output";
import { receiptView, type Ledger } from "./receipts";
import type { ClipView, ReceiptView } from "./types";

export interface ScreeningWorldView {
  segmentId: string;
  label: string;
  ageBand: string | null;
  /** "skews +0.21": a relative index, never a share. */
  skewText: string | null;
  skewReceipt: ReceiptView | null;
  /** The setting city (Qloo heatmap lift), never the cast. */
  settingCity: string | null;
  settingReceipt: ReceiptView | null;
  clip: ClipView | null;
}

export interface ScreeningView {
  /** The generic clip, shown once and pinned as "Control". Null when the run has no Control. */
  control: { clip: ClipView | null } | null;
  worlds: ScreeningWorldView[];
}

export function screeningView(report: Report, ledger: Ledger, media: DemoMedia | null | undefined): ScreeningView {
  const segments = new Map((report.audience.segments?.items ?? []).map((s) => [s.id, s]));
  return {
    control: report.control ? { clip: approvedClip(media, null, "Control") } : null,
    worlds: report.worlds.map((world) => {
      const segment = segments.get(world.segmentId);
      const skew = segment ? skewText(segment.skew) : null;
      const city = world.settingCity;
      return {
        segmentId: world.segmentId,
        label: world.label,
        ageBand: segment?.ageBand ?? null,
        skewText: skew,
        skewReceipt: segment ? receiptView(ledger, segment.evidenceIds, "Age skew", `${segment.ageBand}, ${skew}`) : null,
        settingCity: city?.label ?? null,
        settingReceipt: city ? receiptView(ledger, city.evidenceIds, "Setting city", `${city.label}, #${city.audienceRank} of this audience's cities by lift`) : null,
        clip: approvedClip(media, world.segmentId, world.label),
      };
    }),
  };
}
