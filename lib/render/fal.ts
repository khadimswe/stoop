// fal's queue for server-paid drafts (the judge pass), behind a small interface so the job logic is
// tested on a fake queue. Submit, status and result all go to https://queue.fal.run. For an endpoint
// with a path (an app id plus a sub-endpoint, as models.config's VIDEO_MODELS are), fal's status and
// result URLs use the app id alone (<owner>/<app>/requests/<id>/status), which @fal-ai/client builds.
//
// Submitting is one plain POST with no retries: @fal-ai/client retries a submit on 429, 5xx and network
// resets, and a retry after fal already took the job would start (and bill) a second render that Stoop
// never counts. Status and result only read, so they keep the client and its retries.
// fal's errors can echo the request, so only their HTTP status is kept.
import { createFalClient, type FalClient } from "@fal-ai/client";
import { VIDEO_MODELS, type VideoModel } from "../prompts/models.config";
import type { RenderPlan } from "./schema";

if (typeof window !== "undefined") {
  throw new Error("lib/render/fal runs on the server only.");
}

export const FAL_QUEUE_URL = "https://queue.fal.run";
export const SUBMIT_TIMEOUT_MS = 30_000;

export type QueueState = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export interface VideoQueue {
  submit(endpoint: string, input: Record<string, unknown>, options?: { abortSignal?: AbortSignal }): Promise<{ requestId: string }>;
  status(endpoint: string, requestId: string, options?: { abortSignal?: AbortSignal }): Promise<QueueState>;
  /** The finished job's output; throws QueueError when fal reports the job failed. */
  result(endpoint: string, requestId: string, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/**
 * A queue call that failed. `accepted` says whether fal may have taken the job anyway: only a definite
 * refusal (a 4xx other than 408) says it did not; a 5xx, a 408, a network error or a timeout leaves it
 * unknown, so it counts as accepted (and is never refunded).
 */
export class QueueError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly accepted: boolean,
  ) {
    super(message);
    this.name = "QueueError";
  }
}

/** A definite refusal: fal answered and the answer says the request was not taken. */
export const refused = (status: number | null) => status !== null && status >= 400 && status < 500 && status !== 408;

const statusOf = (error: unknown): number | null => {
  const code = (error as { status?: unknown } | null)?.status;
  return typeof code === "number" ? code : null;
};

function queueError(what: string, status: number | null): QueueError {
  return new QueueError(`fal could not ${what}${status === null ? "" : ` (HTTP ${status})`}.`, status, !refused(status));
}

/** fal with the server key: a single unretried POST to submit, @fal-ai/client to read status and results. */
export function falVideoQueue(options: { credentials: string; client?: Pick<FalClient, "queue">; fetch?: typeof fetch }): VideoQueue {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async submit(endpoint, input, opts = {}) {
      const timeout = AbortSignal.timeout(SUBMIT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(`${FAL_QUEUE_URL}/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Key ${options.credentials}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(input),
          redirect: "error",
          signal: opts.abortSignal ? AbortSignal.any([timeout, opts.abortSignal]) : timeout,
        });
      } catch {
        throw queueError("start the draft", null);
      }
      if (!response.ok) throw queueError("start the draft", response.status);
      const body = (await response.json().catch(() => null)) as { request_id?: unknown } | null;
      // Taken (2xx) but unreadable: fal may be rendering it, so it counts as accepted.
      if (typeof body?.request_id !== "string" || !body.request_id) throw new QueueError("fal took the draft but sent no request id.", response.status, true);
      return { requestId: body.request_id };
    },
    async status(endpoint, requestId, opts = {}) {
      try {
        const answer = await client.queue.status(endpoint, { requestId, logs: false, ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}) });
        return answer.status;
      } catch (error) {
        throw queueError("report on the draft", statusOf(error));
      }
    },
    async result(endpoint, requestId, opts = {}) {
      try {
        return (await client.queue.result(endpoint, { requestId, ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}) })).data;
      } catch (error) {
        throw queueError("render the draft", statusOf(error));
      }
    },
  };
}

/** The app's queue: fal with the server-side FAL_KEY, or null without one. */
export function videoQueueFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): VideoQueue | null {
  const key = env.FAL_KEY?.trim();
  return key ? falVideoQueue({ credentials: key }) : null;
}

export function videoModelFor(endpoint: string): VideoModel {
  const model = Object.values(VIDEO_MODELS).find((m) => m.endpoint === endpoint);
  if (!model) throw new Error(`${endpoint} is not an allowlisted draft endpoint.`);
  return model;
}

/**
 * What fal is sent for a plan. Whatever the plan says, a draft is forced: draft mode, 480p, 9:16 (where
 * the endpoint sets it; image-to-video follows its start frame) and 4 to 15 seconds. `endUserId` tags a
 * server-paid render with a hash of the judge pass, never anything about the person.
 */
export function falInputFor(plan: RenderPlan, options: { endUserId?: string } = {}): Record<string, unknown> {
  const model = videoModelFor(plan.endpoint);
  const seconds = Math.min(15, Math.max(4, Math.round(plan.durationSeconds)));
  const common = {
    prompt: plan.prompt,
    resolution: "480p",
    draft: true,
    duration: String(seconds),
    generate_audio: plan.generateAudio,
    ...(options.endUserId ? { end_user_id: options.endUserId } : {}),
  };
  if (model.role === "image") {
    const [start, end] = plan.imageUrls;
    return { ...common, image_url: start, ...(end ? { end_image_url: end } : {}) };
  }
  return { ...common, image_urls: plan.imageUrls.slice(0, model.maxRefs), ...(model.setsAspectRatio ? { aspect_ratio: "9:16" } : {}) };
}
