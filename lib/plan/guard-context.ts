// The guard's context for one plan: the manager's offers and budget, the ids and names Qloo returned
// for this store, and the notes. Shared by every stage that checks text.
import type { GuardContext } from "./guard";
import type { PlanInputs } from "./schema";

export function guardFor(inputs: PlanInputs, known: Iterable<string> = [], names: readonly string[] = []): GuardContext {
  return { offers: inputs.offers.map((o) => o.text), budgetUsd: inputs.budgetUsd, known: new Set(known), names, ...(inputs.notes ? { notes: inputs.notes } : {}) };
}
