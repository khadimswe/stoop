// Test helpers for the draft video modules: the recorded example reports, demo media shaped like the
// approved manifest entries (the real manifest has none approved yet), a live-style report, and fakes
// for fal's queue and both storages. Nothing here reaches the network. Imported by tests only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONTROL_SEGMENT } from "../api/requests";
import type { DemoMedia } from "../demo/manifest";
import type { ExampleSlug } from "../demo/examples";
import { sha256 } from "../hash";
import { FRAME_MODELS } from "../prompts/models.config";
import { reportSchema, type Report } from "../report/schema";
import type { PrivateStorage, Storage } from "../storage";
import { QueueError, type QueueState, type VideoQueue } from "./fal";

export const SLUGS: ExampleSlug[] = ["food-hot-sauce", "home-candles", "pets-outfits"];

const reports = new Map<string, Report>();

export function exampleReport(slug: ExampleSlug): Report {
  if (!reports.has(slug)) reports.set(slug, reportSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "data", "runs", slug, "run.report.json"), "utf8"))));
  return structuredClone(reports.get(slug) as Report);
}

/** Every world (and the Control) of an example, as render targets. */
export function targetsOf(report: Report): { reportId: string; segment: string }[] {
  return [...report.worlds.map((w) => w.segmentId), ...(report.control ? [CONTROL_SEGMENT] : [])].map((segment) => ({ reportId: report.meta.id, segment }));
}

/** Approved-looking demo media: a 4-frame storyboard for every world and the Control, and a packshot. */
export function demoFor(report: Report, options: { packshot?: boolean } = {}): DemoMedia {
  const slug = report.meta.id.replace(/^example-/, "") as ExampleSlug;
  const storyboards: DemoMedia["storyboards"] = {};
  for (const { segment } of targetsOf(report)) {
    const frames = [0, 1, 2, 3].map((scene) => {
      const file = `/demo/${slug}/frames/${segment}-${scene}.webp`;
      return { scene, file, promptHash: sha256(`prompt:${file}`), sha256: sha256(`file:${file}`), modelId: FRAME_MODELS.edit.endpoint, attempt: 1 as const };
    });
    storyboards[segment] = { example: slug, segmentId: segment === CONTROL_SEGMENT ? null : segment, frames, critiques: [] };
  }
  const packshotFile = `/demo/${slug}/packshot.webp`;
  return {
    packshot: options.packshot === false ? null : { example: slug, file: packshotFile, promptHash: sha256(`prompt:${packshotFile}`), sha256: sha256(`file:${packshotFile}`), modelId: FRAME_MODELS.edit.endpoint },
    storyboards,
    clips: [],
  };
}

export const LIVE_RUN_ID = `run_${"a".repeat(24)}`;
export const BRAND_PHOTO = "https://cdn.shop.example/products/sauce.jpg";

/**
 * A live run shaped from an example: its own id, the brand's photos as the product source (one with a
 * person, which is never used), and finished storyboards for the first world, where scene 1 was
 * re-rendered after the critique.
 */
export function liveReport(slug: ExampleSlug = "food-hot-sauce"): Report {
  const report = exampleReport(slug);
  report.meta = { ...report.meta, id: LIVE_RUN_ID, kind: "live", provenance: "live" };
  report.inputs.product = {
    ...report.inputs.product,
    source: { kind: "images", images: [{ url: "https://cdn.shop.example/products/model.jpg", showsPerson: true }, { url: BRAND_PHOTO, showsPerson: false }] },
  };
  const frame = (scene: number, attempt: 1 | 2) => ({ scene, url: `https://store.public.blob.vercel-storage.com/frames/${scene}-${attempt}.png`, promptHash: sha256(`frame:${scene}:${attempt}`), modelId: FRAME_MODELS.edit.endpoint, attempt });
  report.worlds[0].frames = { revisionId: null, status: "done", reason: null, frames: [frame(0, 1), frame(1, 1), frame(1, 2), frame(2, 1)], critiques: [] };
  return report;
}

// --- Fakes ----------------------------------------------------------------------------------------------

export function fakeStorage(): Storage & { puts: { path: string; bytes: number; contentType: string }[] } {
  const puts: { path: string; bytes: number; contentType: string }[] = [];
  return {
    kind: "blob",
    puts,
    async put(p, bytes, contentType) {
      puts.push({ path: p, bytes: bytes.byteLength, contentType });
      return { path: p, url: `https://store.public.blob.vercel-storage.com/${p}` };
    },
    async url(p) {
      return puts.some((x) => x.path === p) ? `https://store.public.blob.vercel-storage.com/${p}` : null;
    },
    async delete() {},
  };
}

export function fakePrivateStorage(): PrivateStorage & { objects: Map<string, Uint8Array>; signed: { path: string; now: number | undefined }[] } {
  const objects = new Map<string, Uint8Array>();
  const signed: { path: string; now: number | undefined }[] = [];
  return {
    kind: "blob",
    objects,
    signed,
    async put(p, bytes) {
      objects.set(p, bytes);
      return { path: p };
    },
    async exists(p) {
      return objects.has(p);
    },
    async presign(p, options = {}) {
      signed.push({ path: p, now: options.now });
      const until = (options.now ?? 0) + (options.seconds ?? 3600) * 1000;
      return `https://refs.private.blob.vercel-storage.com/${p}?vercel-blob-valid-until=${until}&vercel-blob-signature=sig`;
    },
  };
}

/** A fal queue that walks each request through the states it is given, then answers its result. */
export class FakeQueue implements VideoQueue {
  submitted: { endpoint: string; input: Record<string, unknown> }[] = [];
  statusCalls = 0;
  /** What the next submit does: accept, refuse with an HTTP status, or fail on the network. */
  submitMode: "accept" | "refuse" | "network" = "accept";
  states: QueueState[] = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
  output: unknown = { video: { url: "https://v3.fal.media/files/draft.mp4", content_type: "video/mp4" } };
  resultError: QueueError | null = null;
  private step = new Map<string, number>();

  async submit(endpoint: string, input: Record<string, unknown>) {
    if (this.submitMode === "refuse") throw new QueueError("fal could not start the draft (HTTP 422).", 422, false);
    if (this.submitMode === "network") throw new QueueError("fal could not start the draft.", null, true);
    this.submitted.push({ endpoint, input });
    const requestId = `req-${this.submitted.length}`;
    this.step.set(requestId, 0);
    return { requestId };
  }

  async status(_endpoint: string, requestId: string) {
    this.statusCalls++;
    const at = this.step.get(requestId) ?? 0;
    this.step.set(requestId, at + 1);
    return this.states[Math.min(at, this.states.length - 1)];
  }

  async result() {
    if (this.resultError) throw this.resultError;
    return this.output;
  }
}

/** A fetch for fal's media host answering a small MP4 (or what the test asks for). */
export function videoFetch(options: { contentType?: string; bytes?: number; length?: string } = {}): typeof fetch {
  return (async () =>
    new Response(new Uint8Array(options.bytes ?? 2048), {
      status: 200,
      headers: { "content-type": options.contentType ?? "video/mp4", ...(options.length ? { "content-length": options.length } : {}) },
    })) as typeof fetch;
}
