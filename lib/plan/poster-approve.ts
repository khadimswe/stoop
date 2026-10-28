// Approving an example store's poster and posts (scripts/approve-poster.ts): the pure steps, so they are
// tested on their own. An approval
//   checks the draft: listed in the export, its file's sha256 the one recorded at render time, and its
//     prompt hash the frozen prompt's, which passes the poster check;
//   records it (lib/plan/poster-approval.ts approvalSchema);
//   appends the approved poster.updated (status "ready", no url: the route draws it over the approved
//     file) and posts.ready to the example's events as after-run events, after run.done, the way a live
//     run's marketing lands after its plan. No recorded plan event changes; an earlier approval's
//     after-run events are replaced, so approving again never stacks them.
import type { PlanEvent } from "./events";
import { checkPosterPrompt } from "./poster-prompt";
import { type PosterApproval } from "./poster-approval";
import type { MarketingExport } from "./posts-export";
import type { PlanReport, Poster } from "./schema";

/** Variant B has no rendered art: its approved poster is the plain background. */
export const VARIANT_B_PLAIN = "Variant B uses the plain background.";

export interface ApprovalInput {
  exported: MarketingExport;
  file: string;
  /** The sha256 of the draft file as it is on disk now. */
  fileSha256: string;
  report: Pick<PlanReport, "local" | "inputs">;
  by: string;
  approvedAt: string;
}

/** What is wrong with approving this draft, or an empty list. */
export function approvalProblems(input: ApprovalInput): string[] {
  const problems: string[] = [];
  const draft = input.exported.drafts.find((d) => d.file === input.file);
  const poster = input.exported.events[0].poster;
  if (!draft) return [`${input.file} is not one of this example's drafts (${input.exported.drafts.map((d) => d.file).join(", ") || "none"}).`];
  if (draft.sha256 !== input.fileSha256) problems.push(`${input.file} changed since it was rendered: its sha256 no longer matches the draft's.`);
  if (draft.promptHash !== poster.promptHash) problems.push(`${input.file} was rendered from an older prompt than the one frozen in the export; export again or approve a newer draft.`);
  const issues = checkPosterPrompt(poster.prompt, input.report);
  if (issues.length) problems.push(`The frozen prompt fails the poster check: ${issues.map((i) => i.message).join("; ")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.approvedAt)) problems.push(`"${input.approvedAt}" is not a date (YYYY-MM-DD).`);
  return problems;
}

/** The approved poster: ready, the frozen prompt and hash, no url (the route draws it over the approved file). */
export function approvedPoster(poster: Poster): Poster {
  return { status: "ready", prompt: poster.prompt, promptHash: poster.promptHash, alt: poster.alt };
}

export function approvalRecord(input: ApprovalInput): PosterApproval {
  const { exported } = input;
  const b = exported.variantB;
  return {
    file: input.file,
    sha256: input.fileSha256,
    promptHash: exported.events[0].poster.promptHash,
    approvedAt: input.approvedAt,
    by: input.by,
    ...(b ? { variantB: { conceptId: b.conceptId, poster: { status: "skipped", prompt: b.poster.prompt, promptHash: b.poster.promptHash, alt: b.poster.alt, reason: VARIANT_B_PLAIN }, posts: b.posts } } : {}),
  };
}

const MARKETING_AFTER_RUN = new Set<PlanEvent["type"]>(["poster.updated", "posts.ready"]);

/**
 * The example's events with the approved poster and posts appended after run.done. Events before
 * run.done (the recorded plan) are never touched; an earlier approval's after-run events are dropped.
 */
export function withApprovedMarketing(events: readonly PlanEvent[], exported: MarketingExport, at: string): PlanEvent[] {
  const done = events.map((e) => e.type).lastIndexOf("run.done");
  if (done < 0) throw new Error("The example's events have no run.done: it is not a finished recording.");
  const kept = [...events.slice(0, done + 1), ...events.slice(done + 1).filter((e) => !MARKETING_AFTER_RUN.has(e.type))];
  const seq = Math.max(...kept.map((e) => e.seq)) + 1;
  return [
    ...kept,
    { type: "poster.updated", poster: approvedPoster(exported.events[0].poster), seq, at },
    { type: "posts.ready", posts: exported.events[1].posts, seq: seq + 1, at },
  ];
}
