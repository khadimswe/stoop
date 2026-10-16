// The Qloo side of one intake. Intake runs as its own request, before the founder confirms seeds and
// before any run exists, so it gets its own RunContext capped at INTAKE_CAP (lib/qloo/budget.ts) and
// never spends from a run's RUN_CAP; the daily caps still bound it. Every call goes through the real
// client with a human label and the "intake" stage, and returns its receipt, so seeds and taste tags
// carry evidence ids and the receipts can be handed to the run (AudienceRun.seedEvidence).
import { INTAKE_CAP } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { createRunContext, type RunContext } from "../qloo/context";
import { receiptLookup, type ReceiptLookup } from "../qloo/resolve";

export const INTAKE_STAGE = "intake";

export interface IntakeQloo {
  ctx: RunContext;
  lookup: ReceiptLookup;
}

export function intakeQloo(client: QlooClient, runId: string): IntakeQloo {
  const ctx = createRunContext({ runId, cap: INTAKE_CAP });
  return { ctx, lookup: receiptLookup(client, ctx, { stage: INTAKE_STAGE }) };
}
