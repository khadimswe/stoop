// A fair A/B test of two strategies, written before anything runs: variant A is the kept concept,
// variant B the runner-up (or the generic AI plan, or the store's usual table). Two stores on the
// same Saturday, or one store on two Saturdays a week apart, so each side gets a comparable day.
// The metric is walk-ins, each read against that store's usual Saturday, and the decision rule is
// fixed up front. One weekend is a first look, not proof, and the plan says so.
import type { AbTest, Concept, PlanInputs } from "./schema";
import { USUAL_TABLE } from "./usual";

export const TEST_CAVEAT = "One weekend is a first look, not proof.";
/** B has to beat A by this much, each against its store's usual Saturday, to win. */
export const TEST_MARGIN = 0.2;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface TestOptions {
  /** A second store (its store id) to run variant B on the same day; else B runs a week later at this store. */
  otherStoreId?: string;
  /** What B runs: the runner-up concept (default when there is one), the generic plan, or the usual table. */
  b?: "runner_up" | "generic" | "usual";
}

/** The test plan for a set of scored concepts. Null when there is no kept concept. */
export function buildAbTest(inputs: PlanInputs, concepts: readonly Concept[], options: TestOptions = {}): AbTest | null {
  const kept = concepts.find((c) => c.kept);
  if (!kept) return null;
  const runnerUp = [...concepts].filter((c) => !c.kept).sort((a, b) => b.total - a.total)[0];
  const choice = options.b ?? (runnerUp ? "runner_up" : "generic");
  const b: AbTest["variants"][number] =
    choice === "runner_up" && runnerUp
      ? { id: "b", label: runnerUp.title.slice(0, 60), source: "concept", conceptId: runnerUp.id }
      : choice === "usual"
        ? { id: "b", label: "The usual table", source: "usual" }
        : { id: "b", label: "The generic AI plan", source: "generic" };
  const assignments: AbTest["assignments"] = options.otherStoreId
    ? [
        { storeId: inputs.store.id, date: inputs.date, variant: "a" },
        { storeId: options.otherStoreId, date: inputs.date, variant: "b" },
      ]
    : [
        { storeId: inputs.store.id, date: inputs.date, variant: "a" },
        { storeId: inputs.store.id, date: addDays(inputs.date, 7), variant: "b" },
      ];
  const usual = b.source === "usual" ? ` (${USUAL_TABLE.label.toLowerCase()})` : "";
  return {
    variants: [{ id: "a", label: kept.title.slice(0, 60), source: "concept", conceptId: kept.id }, { ...b, label: `${b.label}${usual}`.slice(0, 60) }],
    assignments,
    metric: "walk_ins",
    decisionRule: `B wins only if its walk-ins beat A's by ${Math.round(TEST_MARGIN * 100)}% or more, each counted against that store's usual Saturday; otherwise keep A.`,
    caveat: TEST_CAVEAT,
  };
}
