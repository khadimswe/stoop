import type { FalClient } from "@fal-ai/client";
import { describe, expect, it } from "vitest";
import { VIDEO_MODELS } from "../prompts/models.config";
import { falInputFor, falVideoQueue, QueueError, refused } from "./fal";
import type { RenderPlan } from "./schema";

const plan: RenderPlan = {
  target: { reportId: "example-food-hot-sauce", segment: "control" },
  endpoint: VIDEO_MODELS.reference.endpoint,
  prompt: "REFERENCES\n@Image1: the hot sauce.",
  imageUrls: ["https://stoop.example/demo/a.webp", "https://stoop.example/demo/b.webp", "https://stoop.example/demo/c.webp"],
  durationSeconds: 15,
  resolution: "480p",
  draft: true,
  aspectRatio: "9:16",
  generateAudio: true,
  inputHash: "a".repeat(64),
  estimatedUsd: 3.31,
  expiresAt: "2026-11-03T13:00:00.000Z",
};

describe("what fal is sent", () => {
  it("forces a 480p 9:16 draft on reference-to-video, with every reference as @Image1..N", () => {
    expect(falInputFor(plan, { endUserId: "stoop-x" })).toEqual({
      prompt: plan.prompt,
      image_urls: plan.imageUrls,
      resolution: "480p",
      draft: true,
      duration: "15",
      aspect_ratio: "9:16",
      generate_audio: true,
      end_user_id: "stoop-x",
    });
    // A plan that says otherwise still renders as a draft of 4 to 15 seconds.
    const odd = { ...plan, resolution: "1080p", draft: false, durationSeconds: 30 } as unknown as RenderPlan;
    expect(falInputFor(odd)).toMatchObject({ resolution: "480p", draft: true, duration: "15" });
    expect(falInputFor({ ...plan, durationSeconds: 1 } as RenderPlan).duration).toBe("4");
  });

  it("sends image-to-video a start frame and an optional end frame, without an aspect ratio (it follows the start frame)", () => {
    const image = { ...plan, endpoint: VIDEO_MODELS.image.endpoint, imageUrls: plan.imageUrls.slice(0, 2) };
    const input = falInputFor(image);
    expect(input).toMatchObject({ image_url: plan.imageUrls[0], end_image_url: plan.imageUrls[1], resolution: "480p", draft: true });
    expect(input).not.toHaveProperty("aspect_ratio");
    expect(input).not.toHaveProperty("image_urls");
    expect(() => falInputFor({ ...plan, endpoint: "fal-ai/some-other-model" })).toThrow(/allowlisted/);
  });
});

describe("the fal queue adapter", () => {
  const fake = (behavior: { status?: () => unknown; result?: () => unknown }) =>
    ({
      queue: {
        submit: async () => {
          throw new Error("submit never goes through the client: it retries");
        },
        status: async () => (behavior.status ?? (() => ({ status: "IN_PROGRESS" })))(),
        result: async () => (behavior.result ?? (() => ({ data: { video: { url: "https://v3.fal.media/x.mp4" } }, requestId: "req-9" })))(),
      },
    }) as unknown as Pick<FalClient, "queue">;
  const thrower = (status?: number) => () => {
    throw Object.assign(new Error("Unprocessable: the prompt was echoed here"), status === undefined ? {} : { status });
  };
  const fetcher = (answer: () => Response) => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return answer();
    }) as unknown as typeof globalThis.fetch;
    return { fetch, requests };
  };
  const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("submits with one plain POST to fal's queue, the key in the Authorization header", async () => {
    const { fetch, requests } = fetcher(json({ request_id: "req-9", status_url: "https://queue.fal.run/x/requests/req-9/status" }));
    const queue = falVideoQueue({ credentials: "server-key", client: fake({}), fetch });
    expect(await queue.submit(plan.endpoint, { prompt: "p" })).toEqual({ requestId: "req-9" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`https://queue.fal.run/${plan.endpoint}`);
    expect(requests[0].init).toMatchObject({ method: "POST", body: '{"prompt":"p"}', redirect: "error" });
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe("Key server-key");
    expect(await queue.status(plan.endpoint, "req-9")).toBe("IN_PROGRESS");
    expect(await queue.result(plan.endpoint, "req-9")).toEqual({ video: { url: "https://v3.fal.media/x.mp4" } });
  });

  it("never retries a submit, and counts only a definite 4xx as a refusal", async () => {
    const cases: [() => Response, number | null, boolean][] = [
      [json({ detail: "bad" }, 422), 422, false],
      [json({ detail: "slow down" }, 429), 429, false],
      [json({}, 502), 502, true],
      [json({}, 504), 504, true],
      [json({}, 408), 408, true],
      [json({ nothing: true }), 200, true],
    ];
    for (const [answer, status, accepted] of cases) {
      const { fetch, requests } = fetcher(answer);
      const error = await falVideoQueue({ credentials: "k", client: fake({}), fetch })
        .submit(plan.endpoint, {})
        .catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(QueueError);
      expect(error).toMatchObject({ status, accepted });
      expect(requests).toHaveLength(1);
    }
    const lost = falVideoQueue({
      credentials: "k",
      client: fake({}),
      fetch: (async () => {
        throw new TypeError("socket hang up");
      }) as unknown as typeof globalThis.fetch,
    });
    expect(await lost.submit(plan.endpoint, {}).catch((e: unknown) => e)).toMatchObject({ status: null, accepted: true, message: "fal could not start the draft." });
  });

  it("keeps only the HTTP status of fal's errors, never their text", async () => {
    const queue = falVideoQueue({ credentials: "k", client: fake({ result: thrower(422), status: thrower(503) }) });
    const error = await queue.result(plan.endpoint, "req-9").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, accepted: false, message: "fal could not render the draft (HTTP 422)." });
    expect(String((error as Error).message)).not.toContain("echoed");
    expect(await queue.status(plan.endpoint, "req-9").catch((e: unknown) => e)).toMatchObject({ status: 503, accepted: true });
    expect(refused(404)).toBe(true);
    expect(refused(408)).toBe(false);
    expect(refused(500)).toBe(false);
    expect(refused(null)).toBe(false);
  });
});
