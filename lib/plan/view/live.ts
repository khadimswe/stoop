// A live plan in the browser: what the progress rail shows, and how to read the plan routes' answers.
// Pure and client-safe; the hook in components/stoop/plan/use-plan-events.ts wires it to EventSource.
import { planEventSchema, type PlanEvent, type PlanState } from "../events";
import { PLAN_MAX_TOTAL } from "../rubric";
import { PLAN_STAGES, planReportSchema, type PlanReport, type PlanStage } from "../schema";
import { ageBandsText, distanceText, PLAN_STAGE_LABELS } from "./format";

export type RailStatus = "done" | "current" | "pending" | "stopped";

export interface PlanRailRow {
  stage: PlanStage;
  label: string;
  status: RailStatus;
  calls: { live: number; cached: number };
}

/**
 * The stages a run goes through, each done, in progress, waiting or stopped, with the Qloo calls its
 * trace steps made. Marketing runs after the plan, so it is left out until it starts.
 */
export function railRows(state: Pick<PlanState, "status" | "current" | "report">): PlanRailRow[] {
  const { stats, trace, partial } = state.report;
  const ended = state.status === "done" || state.status === "failed" || state.status === "partial";
  const stages = PLAN_STAGES.filter((s) => s !== "marketing" || stats.stages.marketing || state.current === "marketing");
  return stages.map((stage) => {
    const calls = { live: 0, cached: 0 };
    for (const step of trace) if (step.stage === stage && step.kind === "tool") calls[step.cached ? "cached" : "live"]++;
    const status: RailStatus = stats.stages[stage]
      ? "done"
      : state.current === stage
        ? "current"
        : ended || partial?.stage === stage
          ? "stopped"
          : "pending";
    return { stage, label: PLAN_STAGE_LABELS[stage], status, calls };
  });
}

export interface PlanningStep {
  key: "music" | "places" | "ideas" | "fit" | "check" | "marketing";
  title: string;
  /** What did the work: Qloo's data, Claude's writing, or Stoop itself. */
  source: "Qloo" | "Claude" | "Stoop";
  detail: string | null;
  status: RailStatus;
  /** "0.4 s" once the step is done. */
  timeText: string | null;
}

const seconds = (ms: number | undefined) => (ms === undefined ? null : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const KIND_WORDS: Readonly<Record<string, string>> = { food: "food spots", venue: "venues", park: "parks", shop: "shops", other: "other places" };

/**
 * The agent's work as six steps a manager can follow while it plans: read the city's music (Qloo),
 * find the community's places (Qloo), write three table ideas and keep the best (Claude), fit the day
 * into the budget (Claude), check it against a generic AI plan (Qloo), and make the poster and posts.
 * Filled from the run's own events: each step's status, its count and how long it took.
 */
export function planningSteps(state: Pick<PlanState, "status" | "current" | "report">): PlanningStep[] {
  const r = state.report;
  const stages = r.stats.stages;
  const ended = state.status === "done" || state.status === "failed" || state.status === "partial";
  const status = (stage: PlanStage, also: PlanStage[] = []): RailStatus => {
    if (stages[stage]) return "done";
    if (state.current === stage || also.includes(state.current as PlanStage)) return "current";
    return ended || r.partial?.stage === stage ? "stopped" : "pending";
  };
  const city = r.local.city;
  const block = r.local.block;
  const plan = r.plan;
  const kept = plan ? (plan.concepts.find((c) => c.id === plan.conceptId) ?? plan.concepts.find((c) => c.kept)) : undefined;
  const budget = r.inputs ? `$${r.inputs.budgetUsd}` : "the budget";
  const radius = block ? distanceText(block.radiusM) : "1.5 km";
  const kinds = block ? [...new Set(block.places.map((p) => p.kind))].map((k) => KIND_WORDS[k] ?? k) : [];
  const leftOff = r.trace.filter((t) => t.stage === "block" && t.kind === "decision" && /^(Left|Marked)/.test(t.label)).map((t) => t.label.charAt(0).toLowerCase() + t.label.slice(1));
  const posterDone = r.poster.status === "ready" || r.poster.status === "skipped" || r.poster.status === "failed";
  const marketingStatus: RailStatus = stages.marketing || (posterDone && r.posts) ? "done" : state.current === "marketing" || r.poster.status === "queued" ? "current" : "pending";
  const cliches = r.baseline?.cliches.length ?? 0;
  const check = r.baseline?.check;
  return [
    {
      key: "music",
      title: city ? `Read ${city.city}'s music` : r.inputs ? `Reading ${r.inputs.store.city}'s music` : "Reading the city's music",
      source: "Qloo",
      detail: city ? `${city.artists.length} artists for adults ${ageBandsText(city.ageBands)}` : null,
      status: status("city", ["store"]),
      timeText: seconds(stages.city?.durationMs),
    },
    {
      key: "places",
      title: block ? `Found ${block.places.length} places within ${radius}` : `Finding places within ${radius}`,
      source: "Qloo",
      detail: block ? [kinds.join(", "), ...leftOff].filter(Boolean).join(" · ") : null,
      status: status("block"),
      timeText: seconds(stages.block?.durationMs),
    },
    {
      key: "ideas",
      title: plan ? `Wrote ${plan.concepts.length} table ideas and kept the best` : "Writing 3 table ideas, keeping the best",
      source: "Claude",
      detail: kept ? `"${kept.title}" scored ${kept.total} of ${PLAN_MAX_TOTAL}` : null,
      status: status("concepts"),
      timeText: seconds(stages.concepts?.durationMs),
    },
    {
      key: "fit",
      title: stages.plan ? `Fit the day into ${budget}` : `Fitting the day into ${budget}`,
      source: "Claude",
      detail: stages.plan && plan ? `${plan.runOfShow.length} timeline steps, ${plan.shopping.length} things to buy, about $${Math.round(plan.estimatedCostUsd)}` : r.inputs?.game === "drop_board" ? "The shopping list, the drop board, the timeline" : "The shopping list, the wheel, the timeline",
      status: status("plan"),
      timeText: seconds(stages.plan?.durationMs),
    },
    {
      key: "check",
      title: stages.baseline ? "Checked it against a generic AI plan" : "Checking it against a generic AI plan",
      source: "Qloo",
      detail: r.baseline ? [cliches ? `${cliches} generic ${cliches === 1 ? "choice" : "choices"} flagged` : null, check && check.checkable > 0 ? `${check.belowMedian} of ${check.checkable} generic picks below the city's median` : null].filter(Boolean).join(" · ") || null : null,
      status: status("baseline"),
      timeText: seconds(stages.baseline?.durationMs),
    },
    {
      key: "marketing",
      title: marketingStatus === "done" ? "Made the poster and the posts" : "Making the poster and the posts",
      source: "Stoop",
      detail: marketingStatus === "pending" ? "Starts on its own when the plan is done" : marketingStatus === "current" ? "Drawing the poster, writing the drafts" : r.poster.reason ?? null,
      status: marketingStatus,
      timeText: seconds(stages.marketing?.durationMs),
    },
  ];
}

/** True for the events after which the run's own stream has nothing more to send. */
export function endsRun(event: PlanEvent): boolean {
  return event.type === "run.done" || event.type === "run.failed";
}

/** One server-sent message as a plan event, or null for anything else (keep-alives, other shapes). */
export function parsePlanEvent(data: string): PlanEvent | null {
  try {
    const parsed = planEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/plan/[id], read whichever way it answers: the report itself, `{ report }`, or
 * `{ events }`. Null when it is none of those.
 */
export function readPlanResponse(body: unknown): { report: PlanReport } | { events: PlanEvent[] } | null {
  if (!body || typeof body !== "object") return null;
  const direct = planReportSchema.safeParse(body);
  if (direct.success) return { report: direct.data };
  const b = body as Record<string, unknown>;
  if (b.report) {
    const nested = planReportSchema.safeParse(b.report);
    if (nested.success) return { report: nested.data };
  }
  if (Array.isArray(b.events)) {
    const events = b.events.map((e) => planEventSchema.safeParse(e)).flatMap((r) => (r.success ? [r.data] : []));
    if (events.length > 0) return { events };
  }
  return null;
}

/** The API's own words: error bodies are `{ error: { code, message } }`, some answers `{ message }`. */
export function apiMessageOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { message?: unknown; error?: unknown };
  if (b.error && typeof b.error === "object" && typeof (b.error as { message?: unknown }).message === "string") return (b.error as { message: string }).message;
  if (typeof b.message === "string") return b.message;
  return null;
}
