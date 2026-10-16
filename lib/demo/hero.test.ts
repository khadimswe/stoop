import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvalsSchema, heroMode, manifestSchema, type DemoApprovals, type DemoClip, type DemoManifest } from "./hero";

const manifest = (clips: DemoClip[]): DemoManifest => ({ version: 1, clips });
const approvals = (prompts: string[], heroClips: DemoClip[]): DemoApprovals => ({
  version: 1,
  prompts,
  heroClips: heroClips.map(({ id, promptHash, sha256 }) => ({ id, promptHash, sha256 })),
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const control: DemoClip = { id: "sauce-hero-control", example: "sauce", role: "hero-control", file: "/demo/sauce/control.mp4", promptHash: "p1", sha256: SHA_A };
const culture: DemoClip = { id: "sauce-hero-culture", example: "sauce", role: "hero-culture", file: "/demo/sauce/culture.mp4", promptHash: "p2", sha256: SHA_B };
const approvedBoth = approvals(["p1", "p2"], [control, culture]);

describe("hero mode", () => {
  it("falls back to the Reality Check card when there are no clips", () => {
    expect(heroMode(manifest([]), approvals([], []), "sauce")).toEqual({ kind: "reality-check" });
  });

  it("falls back until Gate 2 names a lead example", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, null).kind).toBe("reality-check");
  });

  it("ignores approved clips that belong to another example", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, "coffee").kind).toBe("reality-check");
  });

  it("falls back when the clips exist but the founder has not approved them for the hero", () => {
    expect(heroMode(manifest([control, culture]), approvals(["p1", "p2"], []), "sauce").kind).toBe("reality-check");
  });

  it("falls back when only one of the two hook clips is approved", () => {
    expect(heroMode(manifest([control, culture]), approvals(["p1", "p2"], [culture]), "sauce").kind).toBe("reality-check");
  });

  it("falls back when a clip was rendered from a prompt that was never approved", () => {
    expect(heroMode(manifest([control, culture]), approvals(["p1"], [control, culture]), "sauce").kind).toBe("reality-check");
  });

  it("falls back after a re-render under the same id, until the new file is approved", () => {
    const rerendered = { ...culture, sha256: "c".repeat(64) };
    expect(heroMode(manifest([control, rerendered]), approvedBoth, "sauce").kind).toBe("reality-check");
  });

  it("turns the blind test on once both hook clips are approved as those exact files", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, "sauce")).toEqual({
      kind: "blind-test",
      example: "sauce",
      control,
      culture,
    });
  });
});

describe("demo file schemas", () => {
  it("reject duplicate clip ids", () => {
    expect(() => manifestSchema.parse(manifest([control, { ...culture, id: control.id }]))).toThrow(/duplicate clip id/);
  });

  it("reject paths outside /demo, parent segments and non-video files", () => {
    for (const file of ["https://example.com/a.mp4", "/demo/../secret.mp4", "/demo/sauce/control.html"]) {
      expect(() => manifestSchema.parse(manifest([{ ...control, file }])), file).toThrow();
    }
  });

  it("reject unknown keys and approvals without a file hash", () => {
    expect(() => approvalsSchema.parse({ version: 1, prompts: [], heroClips: [], seededVotes: 10 })).toThrow();
    expect(() => approvalsSchema.parse({ version: 1, prompts: [], heroClips: [{ id: "x", promptHash: "p" }] })).toThrow();
  });
});

describe("committed demo files", () => {
  const publicDir = join(process.cwd(), "public");
  const committed = manifestSchema.parse(JSON.parse(readFileSync(join(publicDir, "demo", "manifest.json"), "utf8")));

  it("parse against their schemas", () => {
    expect(() => approvalsSchema.parse(JSON.parse(readFileSync(join(publicDir, "demo", "approvals.json"), "utf8")))).not.toThrow();
  });

  it("list only clips whose files exist and match their recorded hash", () => {
    for (const clip of committed.clips) {
      const path = join(publicDir, clip.file);
      expect(existsSync(path), clip.file).toBe(true);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex"), clip.file).toBe(clip.sha256);
    }
  });
});
