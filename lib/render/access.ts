// Which video line a visitor's report shows (GET /api/render/access): pure, so every case is tested.
//   judge        a valid judge pass, server drafts on, and budget left on every counter
//   budget-used  a valid pass and server drafts on, but a counter is spent ("Here's the storyboard and the example clip.")
//   byok         anyone else, while BYOK is on: "Render with your fal key"
//   off          nothing to render, or both paths off
// rendersLeft is the pass's room (the tightest of its counters) when server drafts are on, else null.
// draftSeconds is how long a draft runs (renderLimits().draftSeconds, RENDER_DRAFT_SECONDS), whatever the line.
import type { RenderAccessResponse } from "../api/responses";

/** The answer always carries the draft length here (the contract makes it optional for older pages). */
export type AccessAnswer = RenderAccessResponse & { draftSeconds: number };

export interface AccessInput {
  /** The target has a pack, a Seedance prompt and at least one reference, and can be planned here. */
  renderable: boolean;
  /** byokEnabled(). */
  byok: boolean;
  /** A valid judge pass came with the request. */
  pass: boolean;
  /** Server drafts are on: ENABLE_LIVE_VIDEO, STOOP_LIVE, FAL_KEY, storage, and caps above 0. */
  server: boolean;
  /** Drafts the pass has left across its counters (renderRoom), when it has a pass. */
  room: number | null;
  /** How long a draft runs, in seconds: renderLimits().draftSeconds (4 to 15). */
  draftSeconds: number;
}

export function videoAccess(input: AccessInput): AccessAnswer {
  const { draftSeconds } = input;
  const byok = input.byok && input.renderable;
  const judging = input.pass && input.server;
  const rendersLeft = judging ? Math.max(0, input.room ?? 0) : null;
  if (!input.renderable) return { video: "off", rendersLeft, byok: false, draftSeconds };
  if (judging) return { video: (rendersLeft ?? 0) > 0 ? "judge" : "budget-used", rendersLeft, byok, draftSeconds };
  return { video: byok ? "byok" : "off", rendersLeft: null, byok, draftSeconds };
}
