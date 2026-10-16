import { describe, expect, it } from "vitest";
import { createLedger, evidenceId, evidenceSchema } from "./evidence";

const entry = (params: Record<string, string>, cached = false) => ({
  endpoint: "/v2/insights" as const,
  params,
  status: 200,
  cached,
  fetchedAt: "2026-10-16T19:00:00.000Z",
  durationMs: 12,
});

describe("evidence ids", () => {
  it("are content-addressed: the same request has the same id in any run, whatever the key order", () => {
    const a = evidenceId("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": "A,B" });
    const b = evidenceId("/v2/insights", { "signal.interests.entities": "A,B", "filter.type": "urn:demographics" });
    expect(a).toBe(b);
    expect(a).toMatch(/^ev_[0-9a-f]{12}$/);
    expect(evidenceId("/v2/insights", { "filter.type": "urn:heatmap" })).not.toBe(a);
  });

  it("keep one ledger entry per request, while each call's receipt says how it was served", () => {
    const ledger = createLedger();
    const first = ledger.add(entry({ "filter.type": "urn:demographics" }));
    const again = ledger.add(entry({ "filter.type": "urn:demographics" }, true));
    expect(again.id).toBe(first.id);
    expect(again.cached).toBe(true);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].cached).toBe(false);
    expect(createLedger().add(entry({ "filter.type": "urn:demographics" })).id).toBe(first.id);
  });

  it("parse with the evidence schema", () => {
    const ledger = createLedger();
    expect(evidenceSchema.parse(ledger.add(entry({ "filter.type": "urn:tag" })))).toBeTruthy();
  });
});
