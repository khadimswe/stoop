import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPlanEmitter, reducePlan, toPlanReport, type PlanEvent, type PlanEventInput } from "./events";
import { PLAN_EXAMPLES } from "./example-list";
import { POSTER_REASONS, queuedPoster } from "./poster-art";
import { APPROVAL_FILE, approvalSchema, clearApprovedArtCache, loadApprovedArt, readApproval, sha256Of } from "./poster-approval";
import { approvalProblems, approvalRecord, approvedPoster, VARIANT_B_PLAIN, withApprovedMarketing } from "./poster-approve";
import { composePosts, fallbackOpenings } from "./posts";
import { exportOf, pendingPoster } from "./posts-export";
import { samplePlanReport } from "./posts-fixture";
import { planReportSchema } from "./schema";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const FILE = `poster-bg-${"a".repeat(12)}.png`;

const report = samplePlanReport({ kind: "example" });
const poster = pendingPoster(queuedPoster(report), POSTER_REASONS.pending);
const posts = composePosts(fallbackOpenings(report), report);
const draft = { file: FILE, previews: [], promptHash: poster.promptHash, sha256: sha256Of(PNG), modelId: "fal-ai/nano-banana-2", renderedAt: "2026-10-28T16:00:00.000Z" };
const exported = exportOf({ slug: "chicago-18th-street", generatedAt: "2026-10-28T16:00:00.000Z", writer: { source: "fallback", modelId: null, attempts: 0, refusedFor: [] }, poster, posts, drafts: [draft], renderAttempts: 1 });
const input = { exported, file: FILE, fileSha256: sha256Of(PNG), report, by: "founder", approvedAt: "2026-10-29" };

/** A recorded example's events, the way the recorder writes them: the plan, then run.done. */
function recorded(): PlanEvent[] {
  const emit = createPlanEmitter(() => new Date("2026-10-28T15:00:00.000Z"));
  const inputs: PlanEventInput[] = [
    { type: "plan.started", runId: "ex-chicago-18th-street", kind: "example", inputs: report.inputs },
    ...report.ledger.map((evidence): PlanEventInput => ({ type: "evidence.added", evidence })),
    { type: "local.city", city: report.local.city! },
    { type: "local.block", block: report.local.block! },
    { type: "plan.ready", plan: report.plan! },
    { type: "run.done" },
  ];
  return inputs.map(emit);
}

describe("approving a poster", () => {
  it("approves a listed, unchanged draft rendered from the frozen prompt", () => {
    expect(approvalProblems(input)).toEqual([]);
    const record = approvalSchema.parse(approvalRecord(input));
    expect(record).toMatchObject({ file: FILE, sha256: sha256Of(PNG), promptHash: poster.promptHash, approvedAt: "2026-10-29", by: "founder" });
  });

  it("refuses a draft that is not listed, has changed, or came from an older prompt", () => {
    expect(approvalProblems({ ...input, file: `poster-bg-${"b".repeat(12)}.png` })[0]).toMatch(/not one of this example's drafts/);
    expect(approvalProblems({ ...input, fileSha256: "0".repeat(64) }).join(" ")).toMatch(/changed since it was rendered/);
    const older = { ...exported, drafts: [{ ...draft, promptHash: "1".repeat(64) }] };
    expect(approvalProblems({ ...input, exported: older }).join(" ")).toMatch(/older prompt/);
    expect(approvalProblems({ ...input, approvedAt: "Oct 29" }).join(" ")).toMatch(/not a date/);
  });

  it("keeps variant B with it, on the plain background", () => {
    const withB = { ...exported, variantB: { conceptId: "park-picnic", poster, posts } };
    const record = approvalRecord({ ...input, exported: withB });
    expect(record.variantB).toMatchObject({ conceptId: "park-picnic", poster: { status: "skipped", reason: VARIANT_B_PLAIN } });
  });

  it("appends the ready poster and the posts after run.done, never touching a recorded event", () => {
    const events = recorded();
    const approved = withApprovedMarketing(events, exported, "2026-10-29T12:00:00.000Z");
    expect(approved.slice(0, events.length)).toEqual(events);
    expect(approved.slice(events.length).map((e) => [e.type, e.seq])).toEqual([
      ["poster.updated", events.length],
      ["posts.ready", events.length + 1],
    ]);
    const after = toPlanReport(reducePlan(approved));
    expect(planReportSchema.safeParse(after).success).toBe(true);
    expect(after.poster).toEqual(approvedPoster(poster));
    expect(after.poster.url).toBeUndefined();
    expect(after.posts).toEqual(posts);
    // The plan itself is exactly what was recorded.
    expect(after.plan).toEqual(toPlanReport(reducePlan(events)).plan);
  });

  it("replaces an earlier approval instead of stacking it", () => {
    const once = withApprovedMarketing(recorded(), exported, "2026-10-29T12:00:00.000Z");
    const twice = withApprovedMarketing(once, exported, "2026-10-30T12:00:00.000Z");
    expect(twice).toHaveLength(once.length);
    expect(twice.at(-1)!.at).toBe("2026-10-30T12:00:00.000Z");
  });

  it("refuses events that never finished", () => {
    expect(() => withApprovedMarketing(recorded().slice(0, -1), exported, "2026-10-29T12:00:00.000Z")).toThrow(/run\.done/);
  });
});

describe("loadApprovedArt", () => {
  function folder(approval: unknown, bytes: Uint8Array | null) {
    const root = mkdtempSync(path.join(tmpdir(), "stoop-approved-"));
    const dir = path.join(root, "data", "plans", "chicago-18th-street", "marketing");
    mkdirSync(dir, { recursive: true });
    if (approval) writeFileSync(path.join(dir, APPROVAL_FILE), JSON.stringify(approval));
    if (bytes) writeFileSync(path.join(dir, FILE), bytes);
    return root;
  }
  const approval = { file: FILE, sha256: sha256Of(PNG), promptHash: poster.promptHash, approvedAt: "2026-10-29", by: "founder" };

  it("draws the approved file when its sha256 still matches", () => {
    clearApprovedArtCache();
    const root = folder(approval, PNG);
    expect(readApproval("chicago-18th-street", root)).toEqual(approval);
    expect(loadApprovedArt("chicago-18th-street", root)?.dataUri).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  });

  it("draws nothing without an approval, without the file, or when the file changed", () => {
    clearApprovedArtCache();
    expect(loadApprovedArt("chicago-18th-street", folder(null, PNG))).toBeNull();
    expect(loadApprovedArt("chicago-18th-street", folder(approval, null))).toBeNull();
    const changed = Buffer.concat([PNG, Buffer.from([0])]);
    expect(loadApprovedArt("chicago-18th-street", folder(approval, changed))).toBeNull();
    expect(loadApprovedArt("chicago-18th-street", folder({ ...approval, sha256: sha256Of(Buffer.from("<html>")) }, Buffer.from("<html>")))).toBeNull();
  });
});

// The approvals the founder made (data/plans is left out of the public mirror, so these run where it is).
const approvedSlugs = PLAN_EXAMPLES.map((e) => e.slug).filter((slug) => existsSync(path.join("data", "plans", slug, "marketing", APPROVAL_FILE)));
describe.skipIf(approvedSlugs.length === 0).each(approvedSlugs)("the approved %s example", (slug) => {
  it("verifies its art, and its events carry the approved poster and posts", () => {
    clearApprovedArtCache();
    const approval = readApproval(slug)!;
    expect(loadApprovedArt(slug)).not.toBeNull();
    const events = JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")) as PlanEvent[];
    const done = events.map((e) => e.type).lastIndexOf("run.done");
    expect(events.slice(done + 1).map((e) => e.type)).toEqual(["poster.updated", "posts.ready"]);
    const final = toPlanReport(reducePlan(events));
    expect(final.poster).toMatchObject({ status: "ready", promptHash: approval.promptHash });
    expect(final.poster.url).toBeUndefined();
    expect(final.posts?.facebook.text).toContain("Fictional store. Not affiliated with T-Mobile.");
  });
});
