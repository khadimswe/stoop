import { describe, expect, it } from "vitest";
import { draftUsd, VIDEO_MODELS } from "../prompts/models.config";
import { renderRequestSchema } from "../api/requests";
import { renderPlanSchema, renderStatusSchema, renderJobSchema, RENDER_ENDPOINTS, toRenderStatus, type RenderJob, type RenderPlan } from "./schema";

const plan: RenderPlan = {
  target: { reportId: "example-food-hot-sauce", segment: "seg-55-and-older" },
  endpoint: VIDEO_MODELS.reference.endpoint,
  prompt: "Scene 1. @Image1 on a porch table at dusk.",
  imageUrls: ["https://blob.example.com/frames/a.webp"],
  durationSeconds: 15,
  resolution: "480p",
  draft: true,
  aspectRatio: "9:16",
  generateAudio: true,
  inputHash: "a".repeat(64),
  estimatedUsd: draftUsd(VIDEO_MODELS.reference, 15),
  expiresAt: "2026-11-03T13:00:00.000Z",
};

const job: RenderJob = {
  id: `rj_${"0".repeat(24)}`,
  target: plan.target,
  endpoint: plan.endpoint,
  inputHash: plan.inputHash,
  passId: "b".repeat(24),
  visitor: `v_${"d".repeat(24)}`,
  day: "2026-11-03",
  durationSeconds: 15,
  charged: true,
  falRequestId: "fal-request-1",
  status: "done",
  videoUrl: "https://blob.example.com/renders/a.mp4",
  reason: null,
  cached: false,
  usd: 3.31,
  createdAt: "2026-11-03T12:00:00.000Z",
  updatedAt: "2026-11-03T12:02:00.000Z",
};

describe("render schema", () => {
  it("prices a 15 second 480p draft at about $3.31", () => {
    expect(draftUsd(VIDEO_MODELS.reference, 15)).toBe(3.31);
    expect(RENDER_ENDPOINTS).toEqual(["bytedance/seedance-2.5/reference-to-video", "bytedance/seedance-2.5/image-to-video"]);
  });

  it("accepts only drafts at 480p and 9:16, on allowlisted endpoints, with https references", () => {
    expect(renderPlanSchema.parse(plan)).toEqual(plan);
    expect(() => renderPlanSchema.parse({ ...plan, draft: false })).toThrow();
    expect(() => renderPlanSchema.parse({ ...plan, resolution: "1080p" })).toThrow();
    expect(() => renderPlanSchema.parse({ ...plan, endpoint: "fal-ai/some-other-model" })).toThrow();
    expect(() => renderPlanSchema.parse({ ...plan, imageUrls: ["http://blob.example.com/a.webp"] })).toThrow();
    expect(() => renderPlanSchema.parse({ ...plan, durationSeconds: 30 })).toThrow();
  });

  it("bounds the references per endpoint", () => {
    expect(() => renderPlanSchema.parse({ ...plan, imageUrls: [] })).toThrow(/1 to 30/);
    const image = { ...plan, endpoint: VIDEO_MODELS.image.endpoint };
    expect(renderPlanSchema.parse(image).endpoint).toBe(VIDEO_MODELS.image.endpoint);
    expect(() => renderPlanSchema.parse({ ...image, imageUrls: Array.from({ length: 3 }, (_, i) => `https://blob.example.com/${i}.webp`) })).toThrow(/1 to 2/);
  });

  it("takes only a target from the browser, never a prompt", () => {
    expect(renderRequestSchema.parse({ target: plan.target })).toEqual({ target: plan.target });
    expect(() => renderRequestSchema.parse({ target: plan.target, prompt: "anything" })).toThrow();
    expect(() => renderRequestSchema.parse({ target: { reportId: "run_x", segment: "control" } })).toThrow();
    expect(renderRequestSchema.parse({ target: { reportId: `run_${"c".repeat(24)}`, segment: "control" } }).target.segment).toBe("control");
  });

  it("shows a page the job without its fal request id or pass id", () => {
    expect(renderJobSchema.parse(job)).toEqual(job);
    const status = toRenderStatus(job);
    expect(status).toEqual({ id: job.id, target: job.target, status: "done", videoUrl: job.videoUrl, reason: null, cached: false });
    expect(Object.keys(renderStatusSchema.shape)).not.toContain("falRequestId");
    expect(Object.keys(renderStatusSchema.shape)).not.toContain("passId");
    expect(Object.keys(renderStatusSchema.shape)).not.toContain("visitor");
  });
});
