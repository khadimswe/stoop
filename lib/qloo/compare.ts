import type { QlooClient, QlooResult } from "./client";
import { ENDPOINTS } from "./constants";
import type { RunContext } from "./context";
import type { CompareParams } from "./schemas";
import { compareResponse, type CompareResult } from "./types";

/**
 * Compares two taste profiles: what they share and what sets each apart. Powers the Reality Gap
 * (stated customer vs. measured customer). Thin for venues, so use brand and artist seeds.
 */
export function compareProfiles(
  client: QlooClient,
  ctx: RunContext,
  params: CompareParams,
  meta: { label?: string; stage?: string } = {},
): Promise<QlooResult<CompareResult>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.compare,
    params,
    schema: compareResponse,
    label: meta.label ?? "Comparing the stated customer with the measured one",
    stage: meta.stage,
  });
}
