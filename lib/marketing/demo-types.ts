// The landing's "agent at work" demo: a replay of one recorded run, as plain serializable data. The
// server builds it from the recorded events and report (lib/marketing/demo-script.ts) and hands it to
// the client player as a prop, so the player never imports the Report, its schema or the 500 KB run.
// Every string and number here is copied from the run or formatted by a tested function: nothing is
// simulated. Types only: safe to import anywhere, including "use client" files (`import type`).
import type { RealitySource } from "../report/view/reality";
import type { StoryboardFrameView, ShotView } from "../report/view/output";
import type { RailStatus } from "../run/rail";
import type { TraceRow } from "../run/trace";
import type { Stage } from "../report/stages";

/** The seven beats, in the order the player shows them. */
export const DEMO_BEATS = ["composer", "seeds", "trace", "reality", "worlds", "storyboard", "launch"] as const;
export type DemoBeat = (typeof DEMO_BEATS)[number];

/** What each beat is called in the player's progress line. */
export const DEMO_BEAT_LABELS: Readonly<Record<DemoBeat, string>> = {
  composer: "Describe the product",
  seeds: "Seeds",
  trace: "Agent at work",
  reality: "Reality Check",
  worlds: "Concept worlds",
  storyboard: "Storyboard",
  launch: "Launch plan",
};

export interface DemoSeed {
  id: string;
  name: string;
  /** "brand", "tv show", "tag". */
  kind: string;
  origin: "qloo" | "suggested" | "you";
}

/** One trace row as the player shows it, plus where the run stood when it arrived. */
export interface DemoStep {
  stageLabel: TraceRow["stageLabel"];
  startsGroup: boolean;
  kind: TraceRow["kind"];
  label: string;
  reason: string | null;
  served: TraceRow["served"];
  world: string | null;
  /** Milliseconds after run.started, from the recorded event timestamps (the player compresses them). */
  recordedMs: number;
  /** Each rail stage's status once this step arrived, in rail order (DemoTrace.stages). */
  rail: RailStatus[];
  /** Qloo calls so far: live and cached, counted from the run's own tool steps. */
  calls: { live: number; cached: number };
}

export interface DemoTrace {
  /** The rail, in order: stage ids and their on-screen names (lib/run/rail.ts). */
  stages: { stage: Stage; label: string }[];
  /** The rail before the first step (every stage waiting). */
  initialRail: RailStatus[];
  steps: DemoStep[];
  /** The rail once the run ended. */
  finalRail: RailStatus[];
  /** Qloo calls per rail stage at the end (same order as `stages`). */
  finalStageCalls: number[];
  /** The run's Qloo calls, equal to callCounts(report.trace). */
  totals: { live: number; cached: number };
  /** When run.done arrived, in recorded milliseconds after run.started. */
  recordedMs: number;
}

export interface DemoRealityLine {
  kind: string;
  /** Written by the gap stage; rendered verbatim. */
  text: string;
  source: RealitySource | null;
}

export interface DemoWorld {
  segmentId: string;
  /** "World 1". */
  position: number;
  /** segment.label, built from what Qloo measured. */
  label: string;
  ageBand: string | null;
  /** "skews +0.21". */
  skew: string | null;
  /** The setting city (Qloo heatmap lift), never the cast. */
  setting: string | null;
  /** The Creative Director's kept concept (origin creative). */
  conceptTitle: string;
  hook: string;
}

export interface DemoControl {
  conceptTitle: string | null;
  hook: string | null;
  /** The comparison's headline, e.g. "The generic brief missed 3 of 4 checkable choices in each world." */
  headline: string | null;
}

export type DemoStoryboard =
  | { kind: "frames"; frames: StoryboardFrameView[]; shots: ShotView[] }
  | { kind: "shots"; shots: ShotView[] };

/** The Launch plan beat: one test cell per world (its kit.adPlan entry), the Control as the baseline. */
export interface DemoLaunchPlan {
  cells: { segmentId: string; name: string; watch: string }[];
  /** The Control's label: the baseline every cell is compared with. */
  baseline: string;
}

export interface DemoScript {
  version: 1;
  /** The example this run belongs to. */
  slug: string;
  /** "/examples/food-hot-sauce". */
  reportHref: string;
  /** "Replay of a recorded run · real Qloo data · Oct 16". */
  label: string;
  /** Where each part of the demo lives in the product, for the stage's small address line. */
  routes: { start: string; run: string; report: string };
  product: {
    brandName: string | null;
    name: string;
    /** What the founder typed into the composer (the product's own description). */
    description: string;
    /** "$14", from the seller facts; null when they give none. */
    price: string | null;
    region: string;
    /** The composer's format chip. */
    format: string;
    descriptionMax: number;
  };
  seeds: { items: DemoSeed[]; range: { min: number; max: number } };
  /** "Who do you think buys it?", verbatim; null when the founder left it empty. */
  statedCustomer: string | null;
  trace: DemoTrace;
  reality: {
    lines: DemoRealityLine[];
    /** The Qloo calls behind the measured line: "3 Qloo calls · /v2/insights · from cache". */
    receipt: string | null;
  };
  worlds: DemoWorld[];
  control: DemoControl;
  /** The top world's concept preview: approved frames, else its shot list. Null before a concept exists. */
  storyboard: { world: string; conceptTitle: string; view: DemoStoryboard } | null;
  launchPlan: DemoLaunchPlan;
  /** A plain summary of what the run found, for screen readers (the animation itself stays silent). */
  summary: string;
}
