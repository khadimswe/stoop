import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvalsSchema, CONTROL_KEY, demoMediaFor, manifestSchema, type DemoApprovals, type DemoClip, type DemoManifest, type DemoStoryboard } from "./manifest";

const hex = (c: string) => c.repeat(64);
const clip: DemoClip = {
  id: "sauce-culture",
  example: "food-hot-sauce",
  role: "culture",
  segmentId: "seg-a",
  file: "/demo/food-hot-sauce/culture.mp4",
  poster: null,
  captions: null,
  promptHash: hex("1"),
  sha256: hex("a"),
};
const frame = (scene: number, promptHash: string, sha256: string) => ({
  scene,
  file: `/demo/food-hot-sauce/frames/seg-a-${scene}.webp`,
  promptHash,
  sha256,
  modelId: "fal-ai/nano-banana-2/edit",
  attempt: 1 as const,
});
const board = (segmentId: string | null, frames = [frame(0, hex("2"), hex("b")), frame(1, hex("3"), hex("c"))]): DemoStoryboard => ({
  example: "food-hot-sauce",
  segmentId,
  frames,
  critiques: [],
});
const packshot = { example: "food-hot-sauce" as const, file: "/demo/food-hot-sauce/packshot.webp", promptHash: hex("4"), sha256: hex("d"), modelId: "fal-ai/flux/schnell" };
const manifest = (over: Partial<DemoManifest> = {}): DemoManifest => ({ version: 2, clips: [], storyboards: [], packshots: [], ...over });
const approvals = (over: Partial<DemoApprovals> = {}): DemoApprovals => ({ version: 2, prompts: [], files: [], heroClips: [], ...over });

describe("demo manifest schema", () => {
  it("rejects duplicate clip ids, storyboards and packshots", () => {
    expect(() => manifestSchema.parse(manifest({ clips: [clip, { ...clip }] }))).toThrow(/duplicate clip id/);
    expect(() => manifestSchema.parse(manifest({ storyboards: [board("seg-a"), board("seg-a")] }))).toThrow(/duplicate storyboard/);
    expect(() => manifestSchema.parse(manifest({ packshots: [packshot, { ...packshot }] }))).toThrow(/duplicate packshot/);
  });

  it("rejects paths outside /demo, parent segments and the wrong file types", () => {
    for (const file of ["https://example.com/a.mp4", "/demo/../secret.mp4", "/demo/sauce/control.html"]) {
      expect(() => manifestSchema.parse(manifest({ clips: [{ ...clip, file }] })), file).toThrow();
    }
    expect(() => manifestSchema.parse(manifest({ packshots: [{ ...packshot, file: "/demo/a.mp4" }] }))).toThrow();
  });

  it("rejects unknown examples, more than 4 frames and a Control clip with a segment", () => {
    expect(() => manifestSchema.parse(manifest({ clips: [{ ...clip, example: "coffee" as DemoClip["example"] }] }))).toThrow();
    const five = [0, 1, 2, 3, 4].map((i) => frame(i, hex("2"), hex("b")));
    expect(() => manifestSchema.parse(manifest({ storyboards: [board("seg-a", five)] }))).toThrow();
    expect(() => manifestSchema.parse(manifest({ clips: [{ ...clip, role: "control" }] }))).toThrow(/Control clip/);
    expect(() => manifestSchema.parse(manifest({ clips: [{ ...clip, segmentId: null }] }))).toThrow(/Control clip/);
  });

  it("rejects unknown keys, seeded fields and approvals without a file hash", () => {
    expect(() => approvalsSchema.parse({ ...approvals(), seededVotes: 10 })).toThrow();
    expect(() => approvalsSchema.parse({ ...approvals(), heroClips: [{ id: "x", promptHash: hex("1") }] })).toThrow();
    expect(() => approvalsSchema.parse({ ...approvals(), prompts: ["p1"] })).toThrow();
  });
});

describe("demoMediaFor", () => {
  const all = manifest({ clips: [clip], storyboards: [board("seg-a"), board(null)], packshots: [packshot] });

  it("shows nothing until the founder approves both the prompt and the file", () => {
    expect(demoMediaFor(all, approvals(), "food-hot-sauce")).toEqual({ packshot: null, storyboards: {}, clips: [] });
    const promptsOnly = approvals({ prompts: [hex("2"), hex("3"), hex("4")] });
    expect(demoMediaFor(all, promptsOnly, "food-hot-sauce").storyboards).toEqual({});
    expect(demoMediaFor(all, promptsOnly, "food-hot-sauce").packshot).toBeNull();
  });

  it("shows a storyboard only when every frame is approved", () => {
    const oneFrame = approvals({ prompts: [hex("2"), hex("3")], files: [hex("b")] });
    expect(demoMediaFor(all, oneFrame, "food-hot-sauce").storyboards).toEqual({});
    const both = approvals({ prompts: [hex("2"), hex("3")], files: [hex("b"), hex("c")] });
    expect(Object.keys(demoMediaFor(all, both, "food-hot-sauce").storyboards).sort()).toEqual([CONTROL_KEY, "seg-a"]);
  });

  it("keeps each example's media to itself", () => {
    const everything = approvals({ prompts: [hex("1"), hex("2"), hex("3"), hex("4")], files: [hex("b"), hex("c"), hex("d")] });
    expect(demoMediaFor(all, everything, "home-candles")).toEqual({ packshot: null, storyboards: {}, clips: [] });
    const sauce = demoMediaFor(all, everything, "food-hot-sauce");
    expect(sauce.packshot).toEqual(packshot);
    expect(sauce.clips).toEqual([clip]);
  });
});

describe("committed demo files", () => {
  const publicDir = join(process.cwd(), "public");
  const committed = manifestSchema.parse(JSON.parse(readFileSync(join(publicDir, "demo", "manifest.json"), "utf8")));
  const sha = (file: string) => createHash("sha256").update(readFileSync(join(publicDir, file))).digest("hex");

  it("parse against their schemas", () => {
    expect(() => approvalsSchema.parse(JSON.parse(readFileSync(join(publicDir, "demo", "approvals.json"), "utf8")))).not.toThrow();
  });

  it("list only files that exist and match their recorded hash", () => {
    const files = [
      ...committed.clips.map((c) => ({ file: c.file, sha256: c.sha256 })),
      ...committed.packshots.map((p) => ({ file: p.file, sha256: p.sha256 })),
      ...committed.storyboards.flatMap((s) => s.frames.map((f) => ({ file: f.file, sha256: f.sha256 }))),
    ];
    for (const { file, sha256 } of files) {
      expect(existsSync(join(publicDir, file)), file).toBe(true);
      expect(sha(file), file).toBe(sha256);
    }
  });
});
