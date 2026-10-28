// The plan's record of what Stoop posted for the manager: one trace step per channel, under the
// marketing stage, written after Meta confirms the post ("Posted to Facebook at 7:02 pm on Fri, Nov 6").
// The contract has no posted-by-Stoop field, so the trace carries it, in a label this module writes and
// reads back; the Results tab lists them with readSocialTrail. A plain module, for the UI too.
import type { PlanTraceStep } from "../plan/schema";
import { localClock, localDay } from "./schedule";

export const SOCIAL_CHANNELS = ["facebook", "instagram"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];
export const SOCIAL_CHANNEL_LABELS: Readonly<Record<SocialChannel, string>> = { facebook: "Facebook", instagram: "Instagram" };

export type SocialPostStatus = "posted" | "scheduled";

/** "Posted to Facebook at 7:02 pm on Fri, Nov 6", or "Scheduled on Facebook for 7:00 pm on Fri, Nov 6", in the store's time zone. */
export function socialLabel(channel: SocialChannel, status: SocialPostStatus, at: Date, timeZone: string): string {
  const when = `${localClock(at, timeZone)} on ${localDay(at, timeZone)}`;
  return status === "posted" ? `Posted to ${SOCIAL_CHANNEL_LABELS[channel]} at ${when}` : `Scheduled on ${SOCIAL_CHANNEL_LABELS[channel]} for ${when}`;
}

/** The trace step for one confirmed post. */
export function socialStep(channel: SocialChannel, status: SocialPostStatus, at: Date, timeZone: string): PlanTraceStep {
  return {
    stage: "marketing",
    kind: "tool",
    label: socialLabel(channel, status, at, timeZone),
    reason: `${status === "posted" ? "Posted" : "Scheduled"} on the manager's tap, from the Page they picked. The poster and the caption are the approved drafts, word for word.`,
  };
}

const LABEL = /^(Posted to|Scheduled on) (Facebook|Instagram) (?:at|for) /;

export interface SocialTrailEntry {
  channel: SocialChannel;
  status: SocialPostStatus;
  label: string;
}

/** Every post Stoop made for this plan, oldest first, read back from its trace. */
export function readSocialTrail(trace: readonly PlanTraceStep[]): SocialTrailEntry[] {
  return trace.flatMap((step) => {
    if (step.stage !== "marketing" || step.kind !== "tool") return [];
    const match = LABEL.exec(step.label);
    if (!match) return [];
    return [{ channel: match[2] === "Facebook" ? "facebook" : "instagram", status: match[1] === "Posted to" ? "posted" : "scheduled", label: step.label }];
  });
}
