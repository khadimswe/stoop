// View models: the narrow, serializable props the report sections take. They are built on the server
// from a Report (the builders next to this file) and passed to components as plain data, so no
// component imports the Report, its schema or the 500 KB recorded runs. Every string here is either
// copied from the Report as the stages wrote it or formatted by a tested function in this folder.
//
// The shared shapes live here. Each section's own types live in its builder file (reality.ts,
// output.ts, ...), so parallel lanes edit different files, and this module re-exports them all.
// Types only: safe to import anywhere, including "use client" files (`import type`).
import type { UgcScript } from "../world";

/** One line of a receipt (ReceiptPanel renders them as a definition list). */
export interface ReceiptRow {
  label: string;
  value: string;
  mono?: boolean;
}

/** The Qloo calls behind one fact or cue, from the report's ledger. No evidence, no receipt. */
export interface ReceiptView {
  /** The cue this receipt backs, e.g. "Music style" or "Reality Check". */
  cue: string;
  /** What the cue says, in plain words. */
  title: string;
  rows: ReceiptRow[];
  /** How many ledger entries the rows come from. */
  calls: number;
  note?: string;
}

/** A pre-rendered clip that may be shown (approved in public/demo/approvals.json). */
export interface ClipView {
  id: string;
  /** A /demo/... path served from our own origin. */
  src: string;
  poster: string | null;
  /** WebVTT captions for a voiced clip. */
  captions: string | null;
  label: string;
}

export interface ScriptView {
  format: UgcScript["format"];
  /** "Product demo", "Before and after" (lib/prompts/ugc/formats.ts). */
  formatLabel: string;
  platform: UgcScript["platform"];
  tool: UgcScript["tool"];
  /** Spoken as the brand, never as a customer. */
  script: string;
  cta: string;
}

export interface PartialView {
  stage: string;
  reason: string;
}

export type { HeaderView, JudgeBannerView } from "./header";
export type { RealityDimensionView, RealityLineView, RealitySource, RealityView } from "./reality";
export type {
  AssetPromptView,
  ExportView,
  McpLinkView,
  OutputView,
  PromptView,
  RenderAccess,
  ShotView,
  StoryboardFrameView,
  StoryboardView,
  VideoView,
} from "./output";
export type { YourAdView } from "./your-ad";
export type { ScreeningView, ScreeningWorldView } from "./screening";
export type { KitView, KitWorldView } from "./kit";
export type { CityView, SeedView, WhyView } from "./why";
export type { ReportView } from "./report";
