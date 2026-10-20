// Builds the landing's "agent at work" demo (DemoScript) from one recorded run: its events, folded
// with the same reducer the live /run page uses, and its report's view models. Pure and server-side:
// it reads the 500 KB run so the player never has to, and it adds no fact of its own. Every line is a
// stage's own words, every number is counted from the run. Tests check both against the report.
import type { DemoMedia } from "../demo/manifest";
import type { Evidence } from "../evidence";
import { apply, initialState, type ReportState, type RunEvent } from "../events";
import { DESCRIPTION_MAX, RUN_SEEDS } from "../api/requests";
import type { Report } from "../report/schema";
import { launchPlanView } from "../report/view/launch";
import { worldCues, worldStoryboard, type ShotView } from "../report/view/output";
import { ledgerOf } from "../report/view/receipts";
import { formatDate, plainType } from "../report/view/format";
import { callCounts, RAIL, railRows, STAGE_LABELS } from "../run/rail";
import { resultsView } from "../run/results";
import { priceFrom } from "../run/intake-view";
import { DEFAULT_FORMAT, exampleRunHref } from "../run/start";
import { traceRows } from "../run/trace";
import type { ExampleSlug } from "../demo/examples";
import type { DemoLaunchPlan, DemoRealityLine, DemoScript, DemoShot, DemoStep, DemoStoryboard, DemoWorld } from "./demo-types";

/** Interest searches the demo shows per world (the report shows more). */
export const DEMO_INTERESTS = 3;

export interface DemoSource {
  slug: ExampleSlug;
  /** The run's events (data/runs/<slug>/run.events.json). */
  events: readonly RunEvent[];
  /** The run's report (data/runs/<slug>/run.report.json), equal to toReport(reduce(events)). */
  report: Report;
  /** The example's approved demo media: approved storyboard frames replace the shot list. */
  media: DemoMedia | null;
}

/** "Oct 16" from an ISO timestamp (UTC, fixed locale, so server and browser agree). */
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string) => SHORT_DATE.format(new Date(iso));

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One mono line naming the Qloo calls behind a fact: "3 Qloo calls · /v2/insights · from cache".
 * From the ledger entries themselves, so it says only what the receipts say.
 */
export function receiptLine(entries: readonly Evidence[]): string | null {
  if (entries.length === 0) return null;
  const endpoints = [...new Set(entries.map((e) => e.endpoint))].join(", ");
  const cached = entries.filter((e) => e.cached).length;
  const served = cached === entries.length ? "from cache" : cached === 0 ? "live" : `${cached} from cache`;
  return [plural(entries.length, "Qloo call", "Qloo calls"), endpoints, served].join(" · ");
}

/** The events in the order the reducer folds them: attempt, then seq. */
function ordered(events: readonly RunEvent[]): RunEvent[] {
  return [...events].sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1) || a.seq - b.seq);
}

/** The state after the first event of `type` (inclusive). Throws when the run never emitted it. */
function stateAfter(events: readonly RunEvent[], type: RunEvent["type"]): ReportState {
  const index = events.findIndex((e) => e.type === type);
  if (index === -1) throw new Error(`The recorded run has no ${type} event.`);
  return events.slice(0, index + 1).reduce(apply, initialState);
}

export function buildDemoScript({ slug, events: raw, report, media }: DemoSource): DemoScript {
  if (report.meta.provenance !== "recorded") throw new Error(`The demo replays recorded runs only; ${slug} is ${report.meta.provenance}.`);
  const events = ordered(raw);
  const started = events.find((e) => e.type === "run.started");
  const done = events.findLast((e) => e.type === "run.done");
  if (!started || !done) throw new Error("The recorded run must start and finish.");
  const t0 = Date.parse(started.at);

  // The trace: fold one event at a time and take the rail and the call count as each step lands.
  let state = initialState;
  const prefix: RunEvent[] = [];
  const snapshots: Pick<DemoStep, "recordedMs" | "rail" | "calls">[] = [];
  for (const event of events) {
    const steps = state.trace.length;
    state = apply(state, event);
    prefix.push(event);
    // Only a step the reducer kept (a repeat or a stale attempt changes nothing).
    if (event.type !== "trace.step" || state.trace.length === steps) continue;
    snapshots.push({
      recordedMs: Date.parse(event.at) - t0,
      rail: railRows(prefix, { ended: false, failed: false }).map((row) => row.status),
      calls: callCounts(state.trace),
    });
  }
  const final = state;
  if (final.runId !== report.meta.id || final.trace.length !== report.trace.length) throw new Error("The recorded events and report disagree: regenerate the run.");
  const worldNames = final.worlds.map((w) => ({ segmentId: w.segmentId, label: w.label }));
  const rows = traceRows(final.trace, worldNames);
  if (rows.length !== snapshots.length) throw new Error("The trace and its snapshots disagree.");
  const steps: DemoStep[] = rows.map((row, i) => ({
    stageLabel: row.stageLabel,
    startsGroup: row.startsGroup,
    kind: row.kind,
    label: row.label,
    reason: row.reason,
    served: row.served,
    world: row.world,
    ...snapshots[i],
  }));
  const endRail = railRows(events, { ended: true, failed: false });

  // The composer and the seed step: the run's inputs as run.started carried them.
  const inputs = stateAfter(events, "run.started").inputs!;
  const { product } = inputs;

  // The Reality Check as the gap stage wrote it: lines with no receipts for their Qloo values are dropped.
  const atGap = stateAfter(events, "audience.gap");
  const gapView = resultsView(atGap).reality;
  const lines: DemoRealityLine[] = (gapView?.lines ?? []).map((line) => ({ kind: line.kind, text: line.text, source: line.source }));
  const measured = atGap.audience.gap?.lines.find((line) => line.kind === "measured");
  const ledger = new Map(final.ledger.map((entry) => [entry.id, entry]));
  const measuredEntries = (measured?.evidenceIds ?? []).flatMap((id) => (ledger.has(id) ? [ledger.get(id)!] : []));

  // The worlds, with their measured age skew and setting city (each only with its receipts).
  const results = resultsView(final);
  const worlds: DemoWorld[] = results.worlds.flatMap((world) =>
    world.concept
      ? [{ segmentId: world.segmentId, position: world.position, label: world.label, ageBand: world.ageBand, skew: world.skew, setting: world.setting, conceptTitle: world.concept.title, hook: world.concept.hook }]
      : [],
  );
  const controlConcept = final.control?.concepts?.best.concept ?? null;

  // The top world's concept preview, exactly as the report's Output section builds it, each shot with
  // the brief cues it carries (a Qloo or interpreted cue only with its receipts: no evidence, no display).
  const top = report.worlds[0];
  const preview = top ? worldStoryboard(top, media) : null;
  let storyboard: DemoScript["storyboard"] = null;
  if (top && preview && preview.kind !== "none") {
    const cues = new Map(worldCues(top, ledgerOf(report)).map((cue) => [cue.slot, cue]));
    const shot = ({ scene, number, beat, start, end, action, overlayText, carries }: ShotView): DemoShot => ({
      scene,
      number,
      beat,
      start,
      end,
      action,
      overlayText,
      carries: carries.flatMap((slot) => {
        const cue = cues.get(slot);
        const backed = cue && (cue.origin === "creative" || cue.origin === "yours" || cue.receipt !== null);
        return cue && backed ? [{ label: cue.label, origin: cue.origin }] : [];
      }),
    });
    const shots = preview.shots.map(shot);
    const view: DemoStoryboard = preview.kind === "frames" ? { kind: "frames", frames: preview.frames, shots } : { kind: "shots", shots };
    const kept = worlds.find((w) => w.segmentId === top.segmentId);
    storyboard = { world: top.label, conceptTitle: kept?.conceptTitle ?? "", view };
  }

  // The report's own launch plan: the Control as the baseline, then each world with its first few interest searches.
  const plan = launchPlanView(report, ledgerOf(report));
  const launchPlan: DemoLaunchPlan = {
    campaign: plan.campaign,
    unavailable: plan.unavailable,
    cells: plan.cells.map((cell) => ({
      key: cell.key,
      kind: cell.kind,
      name: cell.name,
      label: cell.label,
      conceptTitle: cell.creative.title,
      interests: cell.interests.slice(0, DEMO_INTERESTS).map(({ name, kind }) => ({ name, kind })),
      watch: cell.watch,
    })),
  };

  const totals = callCounts(final.trace);
  const date = shortDate(report.meta.createdAt);
  const owner = product.brandName ? `${product.brandName}'s ${product.name}` : product.name;
  const realityText = lines.map((line) => line.text).join(" ");
  const worldText = worlds.map((w) => (w.setting ? `${w.label}, set in ${w.setting}` : w.label)).join("; ");
  const summary = [
    `A replay of a recorded Stoop run for ${owner}, with real Qloo data recorded ${formatDate(report.meta.createdAt)}.`,
    realityText && `Reality Check: ${realityText}`,
    `The agent made ${plural(totals.live + totals.cached, "Qloo call", "Qloo calls")} (${totals.cached} from cache) and built ${plural(worlds.length, "concept world", "concept worlds")}${worldText ? `: ${worldText}.` : "."}`,
    final.comparison?.headline ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    version: 1,
    slug,
    reportHref: `/examples/${slug}`,
    label: `Replay of a recorded run · real Qloo data · ${date}`,
    routes: { start: "/start", run: exampleRunHref(slug), report: `/examples/${slug}` },
    product: {
      brandName: product.brandName,
      name: product.name,
      description: product.sellerFacts ?? product.oneLine,
      price: priceFrom(product.sellerFacts),
      region: inputs.region,
      format: DEFAULT_FORMAT,
      descriptionMax: DESCRIPTION_MAX,
    },
    seeds: {
      items: inputs.seeds.map((seed) => ({ id: seed.ref.id, name: seed.ref.name, kind: plainType(seed.ref.type), origin: seed.origin })),
      range: { min: RUN_SEEDS.min, max: RUN_SEEDS.max },
    },
    statedCustomer: inputs.statedCustomer,
    trace: {
      stages: RAIL.map((stage) => ({ stage, label: STAGE_LABELS[stage] })),
      initialRail: railRows([started], { ended: false, failed: false }).map((row) => row.status),
      steps,
      finalRail: endRail.map((row) => row.status),
      finalStageCalls: endRail.map((row) => row.calls.live + row.calls.cached),
      totals,
      recordedMs: Date.parse(done.at) - t0,
    },
    reality: { lines, receipt: receiptLine(measuredEntries) },
    worlds,
    control: { conceptTitle: controlConcept?.title ?? null, hook: controlConcept?.hook ?? null, headline: final.comparison?.headline ?? null },
    storyboard,
    launchPlan,
    summary,
  };
}

