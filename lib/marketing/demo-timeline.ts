// When each part of the agent demo shows: the beats' spans and, for any moment of the replay, how
// far each beat has got (characters typed, chips shown, trace steps arrived). Pure and client-safe
// (types only), so the player derives every frame from one clock and pausing is just stopping it.
//
// Only presentation lives here: typing speed, how long a line holds. The trace keeps the run's own
// order: its steps arrive at their recorded timestamps, scaled into about 10.5 seconds. (The recorder
// spaces events evenly, so this is the event order at an even pace, not the run's wall-clock time.)
import { DEMO_BEATS, type DemoBeat, type DemoScript } from "./demo-types";

/** Presentation timings, in milliseconds. */
export const PACE = {
  composer: { lead: 450, perChar: 14, minTyping: 1_600, maxTyping: 3_000, hold: 450, press: 380 },
  seeds: { lead: 400, perChip: 380, gap: 250, perChar: 22, minTyping: 700, maxTyping: 1_600, hold: 400, press: 380 },
  /** The recorded run is scaled to last about this long, plus a lead-in and a closing hold. */
  trace: { target: 10_500, lead: 300, hold: 1_100 },
  reality: { lead: 250, perLine: 900, receipt: 600, hold: 2_200 },
  worlds: { lead: 250, perCard: 700, headline: 600, hold: 2_400 },
  storyboard: { lead: 300, perShot: 400, hold: 2_400 },
  /** The closing hold keeps "Open the full report" up for a few seconds before the loop. */
  launch: { lead: 300, perCell: 450, cta: 500, hold: 3_800 },
} as const;

export interface BeatSpan {
  beat: DemoBeat;
  start: number;
  end: number;
}

export interface DemoTimeline {
  beats: BeatSpan[];
  /** The replay's length; it loops from here. */
  total: number;
  /** Recorded milliseconds times this is when a trace step arrives in the replay (at most 1: never slower than recorded). */
  traceScale: number;
  /** When, inside the trace beat, each step arrives. */
  stepAt: number[];
  /** When, inside the trace beat, the run ends (run.done). */
  traceDoneAt: number;
}

/** Everything the player draws at one moment: the beat on screen, and how far each beat has got. */
export interface DemoFrame {
  beat: DemoBeat;
  index: number;
  /** 0 to 1 through the current beat, for the progress line. */
  progress: number;
  composer: { typed: number; pressed: boolean };
  seeds: { chips: number; typed: number; pressed: boolean };
  trace: { steps: number; done: boolean };
  reality: { lines: number; receipt: boolean };
  /** Cards shown: the worlds first, then the Control. */
  worlds: { cards: number; headline: boolean };
  storyboard: { shots: number };
  /** Rows shown: the test cells, then the baseline. */
  launch: { rows: number; cta: boolean };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function typingMs(chars: number, pace: { perChar: number; minTyping: number; maxTyping: number }): number {
  return chars === 0 ? 0 : clamp(chars * pace.perChar, pace.minTyping, pace.maxTyping);
}

/** Characters typed after `elapsed` ms of a `duration` ms typing run over `chars` characters. */
function typedAt(elapsed: number, duration: number, chars: number): number {
  if (elapsed <= 0) return 0;
  if (duration === 0 || elapsed >= duration) return chars;
  return Math.floor((elapsed / duration) * chars);
}

/** How many of `count` items, appearing every `every` ms from `lead`, are showing at `elapsed`. */
function shownAt(elapsed: number, lead: number, every: number, count: number): number {
  if (elapsed < lead) return 0;
  return Math.min(count, Math.floor((elapsed - lead) / every) + 1);
}

function durations(script: DemoScript) {
  const { composer, seeds, trace, reality, worlds, storyboard, launch } = PACE;
  const description = script.product.description.length;
  const stated = script.statedCustomer?.length ?? 0;
  const recorded = script.trace.recordedMs;
  const traceScale = recorded > trace.target ? trace.target / recorded : 1;
  const stepAt = script.trace.steps.map((step) => Math.round(trace.lead + step.recordedMs * traceScale));
  const traceDoneAt = Math.round(trace.lead + recorded * traceScale);
  const lines = script.reality.lines.length;
  const cards = script.worlds.length + 1;
  const shots = script.storyboard ? (script.storyboard.view.kind === "frames" ? script.storyboard.view.frames.length : script.storyboard.view.shots.length) : 0;
  const rows = script.launchPlan.cells.length + 1;
  const span: Record<DemoBeat, number> = {
    composer: composer.lead + typingMs(description, composer) + composer.hold + composer.press,
    seeds: seeds.lead + script.seeds.items.length * seeds.perChip + seeds.gap + typingMs(stated, seeds) + seeds.hold + seeds.press,
    trace: traceDoneAt + trace.hold,
    reality: reality.lead + Math.max(0, lines - 1) * reality.perLine + reality.receipt + reality.hold,
    worlds: worlds.lead + Math.max(0, cards - 1) * worlds.perCard + worlds.headline + worlds.hold,
    // A run with no concept yet has no storyboard: the beat takes no time and is skipped.
    storyboard: shots === 0 ? 0 : storyboard.lead + Math.max(0, shots - 1) * storyboard.perShot + storyboard.hold,
    launch: launch.lead + Math.max(0, rows - 1) * launch.perCell + launch.cta + launch.hold,
  };
  return { span, traceScale, stepAt, traceDoneAt };
}

export function demoTimeline(script: DemoScript): DemoTimeline {
  const { span, traceScale, stepAt, traceDoneAt } = durations(script);
  let start = 0;
  const beats = DEMO_BEATS.map((beat) => {
    const item = { beat, start, end: start + span[beat] };
    start = item.end;
    return item;
  });
  return { beats, total: start, traceScale, stepAt, traceDoneAt };
}

/** The frame at `t` ms into the replay (clamped to the replay). At a beat's `end`, that beat is complete. */
export function frameAt(timeline: DemoTimeline, script: DemoScript, t: number): DemoFrame {
  const time = clamp(t, 0, timeline.total);
  // The first beat still running at `time`; a beat with no length is never the one on screen.
  const found = timeline.beats.findIndex((b) => b.end > b.start && time <= b.end);
  const index = found === -1 ? timeline.beats.length - 1 : found;
  const current = timeline.beats[index];
  /** Milliseconds into a beat: below 0 before it, past its length after it, so earlier beats read as complete. */
  const into = (beat: DemoBeat) => {
    const span = timeline.beats.find((b) => b.beat === beat)!;
    return time - span.start;
  };
  const { composer, seeds, reality, worlds, storyboard, launch } = PACE;

  const description = script.product.description.length;
  const composerTyping = typingMs(description, composer);
  const c = into("composer");

  const stated = script.statedCustomer?.length ?? 0;
  const chipsMs = script.seeds.items.length * seeds.perChip;
  const statedTyping = typingMs(stated, seeds);
  const s = into("seeds");
  const statedStart = seeds.lead + chipsMs + seeds.gap;

  const tr = into("trace");
  const r = into("reality");
  const lines = script.reality.lines.length;
  const w = into("worlds");
  const cards = script.worlds.length + 1;
  const b = into("storyboard");
  const shots = script.storyboard ? (script.storyboard.view.kind === "frames" ? script.storyboard.view.frames.length : script.storyboard.view.shots.length) : 0;
  const l = into("launch");
  const rows = script.launchPlan.cells.length + 1;
  const length = current.end - current.start;

  return {
    beat: current.beat,
    index,
    progress: length > 0 ? clamp((time - current.start) / length, 0, 1) : 1,
    composer: {
      typed: typedAt(c - composer.lead, composerTyping, description),
      pressed: c >= composer.lead + composerTyping + composer.hold,
    },
    seeds: {
      chips: s < seeds.lead ? 0 : Math.min(script.seeds.items.length, Math.floor((s - seeds.lead) / seeds.perChip) + 1),
      typed: typedAt(s - statedStart, statedTyping, stated),
      pressed: s >= statedStart + statedTyping + seeds.hold,
    },
    trace: {
      steps: timeline.stepAt.filter((at) => at <= tr).length,
      done: tr >= timeline.traceDoneAt,
    },
    reality: {
      lines: shownAt(r, reality.lead, reality.perLine, lines),
      receipt: r >= reality.lead + Math.max(0, lines - 1) * reality.perLine + reality.receipt,
    },
    worlds: {
      cards: shownAt(w, worlds.lead, worlds.perCard, cards),
      headline: w >= worlds.lead + Math.max(0, cards - 1) * worlds.perCard + worlds.headline,
    },
    storyboard: { shots: shownAt(b, storyboard.lead, storyboard.perShot, shots) },
    launch: {
      rows: shownAt(l, launch.lead, launch.perCell, rows),
      cta: l >= launch.lead + Math.max(0, rows - 1) * launch.perCell + launch.cta,
    },
  };
}

/** The review route's `?speed=` (e.g. "4" plays four times as fast), clamped to 0.25 to 20; 1 when absent or invalid. */
export function speedFromQuery(search: string): number {
  const value = Number(new URLSearchParams(search).get("speed"));
  return Number.isFinite(value) && value > 0 ? clamp(value, 0.25, 20) : 1;
}
