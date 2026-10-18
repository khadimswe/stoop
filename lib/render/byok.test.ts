// The /byok page: its static HTML (app/byok/route.ts) and the pure parts of its script
// (public/byok/app.js), which runs nothing on import outside a browser.
import { describe, expect, it } from "vitest";
import { GET } from "../../app/byok/route";
import { falInput, isFalMedia, isQueueUrl, queueUrls, readTarget, reportHref } from "../../public/byok/app.js";
import { VIDEO_MODELS } from "../prompts/models.config";
import { RENDER_ENDPOINTS } from "./schema";

const endpoints = Object.values(VIDEO_MODELS).map((m) => ({ endpoint: m.endpoint, name: m.displayName, maxRefs: m.maxRefs, setsAspectRatio: m.setsAspectRatio, image: m.role === "image" }));
const plan = {
  target: { reportId: "example-food-hot-sauce", segment: "control" },
  endpoint: VIDEO_MODELS.reference.endpoint,
  prompt: "REFERENCES\n@Image1: the hot sauce.",
  imageUrls: ["https://stoop.example/demo/a.webp", "https://stoop.example/demo/b.webp"],
  durationSeconds: 15,
  generateAudio: true,
  estimatedUsd: 3.31,
  expiresAt: "2026-11-03T13:00:00.000Z",
};

describe("the /byok page", () => {
  it("is static HTML with no inline script, style or event handler, loading only its own files", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toEqual(['<script type="module" src="/byok/app.js">']);
    expect(html).toMatch(/<script type="module" src="\/byok\/app\.js"><\/script>/);
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=|javascript:/i);
    expect([...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])).toEqual(['<link rel="icon" href="/icon.svg" type="image/svg+xml">', '<link rel="stylesheet" href="/byok/app.css">']);
    expect(html).toContain("Stoop never sees it and never stores it.");
    // The key field: a password input with no name, so it can never be part of a form submission.
    expect(html).toMatch(/<input id="fal-key" type="password" autocomplete="off"[^>]*>/);
    expect(html).not.toMatch(/<input[^>]*\sname=/);
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });

  it("lists only the allowlisted endpoints, from models.config", async () => {
    const html = await GET().text();
    const attribute = /data-endpoints="([^"]*)"/.exec(html)?.[1] ?? "";
    const listed = JSON.parse(attribute.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as { endpoint: string }[];
    expect(listed.map((e) => e.endpoint)).toEqual(RENDER_ENDPOINTS);
  });
});

describe("the /byok script", () => {
  it("reads the target from the query, and links back to the report", () => {
    expect(readTarget("?reportId=example-food-hot-sauce&segment=seg-55-and-older")).toEqual({ reportId: "example-food-hot-sauce", segment: "seg-55-and-older" });
    expect(readTarget(`?reportId=run_${"a".repeat(24)}&segment=control`)).toEqual({ reportId: `run_${"a".repeat(24)}`, segment: "control" });
    expect(readTarget("?reportId=../../api&segment=control")).toBeNull();
    expect(readTarget("?segment=control")).toBeNull();
    expect(reportHref("example-food-hot-sauce")).toBe("/examples/food-hot-sauce");
    expect(reportHref(`run_${"a".repeat(24)}`)).toBe(`/report/run_${"a".repeat(24)}`);
  });

  it("builds the same draft input as the server, forcing draft, 480p, 9:16 and 4 to 15 seconds", () => {
    expect(falInput(plan, endpoints)).toEqual({ prompt: plan.prompt, image_urls: plan.imageUrls, resolution: "480p", draft: true, duration: "15", aspect_ratio: "9:16", generate_audio: true });
    expect(falInput({ ...plan, durationSeconds: 60, resolution: "1080p", draft: false } as typeof plan, endpoints)).toMatchObject({ duration: "15", resolution: "480p", draft: true });
    const image = falInput({ ...plan, endpoint: VIDEO_MODELS.image.endpoint }, endpoints);
    expect(image).toMatchObject({ image_url: plan.imageUrls[0], end_image_url: plan.imageUrls[1] });
    expect(image).not.toHaveProperty("aspect_ratio");
  });

  it("refuses endpoints off the list, too many references, and non-https ones", () => {
    expect(falInput({ ...plan, endpoint: "fal-ai/not-on-the-list" }, endpoints)).toBeNull();
    expect(falInput({ ...plan, endpoint: VIDEO_MODELS.image.endpoint, imageUrls: ["https://a.example/1", "https://a.example/2", "https://a.example/3"] }, endpoints)).toBeNull();
    expect(falInput({ ...plan, imageUrls: ["http://stoop.example/demo/a.webp"] }, endpoints)).toBeNull();
    expect(falInput({ ...plan, imageUrls: [] }, endpoints)).toBeNull();
  });

  it("talks only to fal's queue host, and shows only videos from fal's media hosts", () => {
    const ENDPOINT = VIDEO_MODELS.reference.endpoint;
    const APP = ENDPOINT.split("/").slice(0, 2).join("/");
    expect(isQueueUrl(`https://queue.fal.run/${APP}/requests/abc/status`)).toBe(true);
    expect(isQueueUrl("https://queue.fal.run.evil.example/x")).toBe(false);
    expect(isQueueUrl("https://user:pw@queue.fal.run/x")).toBe(false);
    expect(isQueueUrl("http://queue.fal.run/x")).toBe(false);
    expect(queueUrls(ENDPOINT, { request_id: "abc-123", status_url: "https://evil.example/status" })).toEqual({
      status: `https://queue.fal.run/${APP}/requests/abc-123/status`,
      response: `https://queue.fal.run/${APP}/requests/abc-123`,
    });
    expect(queueUrls(ENDPOINT, { request_id: "../x" })).toBeNull();
    expect(isFalMedia("https://v3.fal.media/files/draft.mp4")).toBe(true);
    expect(isFalMedia("https://v3b.fal.media/files/draft.mp4")).toBe(true);
    expect(isFalMedia("https://storage.googleapis.com/falserverless/example_outputs/x.mp4")).toBe(true);
    expect(isFalMedia("https://storage.googleapis.com/other-bucket/x.mp4")).toBe(false);
    expect(isFalMedia("https://fal.media.evil.example/x.mp4")).toBe(false);
  });
});
