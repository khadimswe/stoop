import { describe, expect, it } from "vitest";
import { heroMode, LEAD_EXAMPLE, type DemoApprovals, type DemoClip, type DemoManifest } from "./hero";

const manifest = (clips: DemoClip[]): DemoManifest => ({ version: 2, clips, storyboards: [], packshots: [] });
const approvals = (prompts: string[], heroClips: DemoClip[]): DemoApprovals => ({
  version: 2,
  prompts,
  files: [],
  heroClips: heroClips.map(({ id, promptHash, sha256 }) => ({ id, promptHash, sha256 })),
});

const P1 = "1".repeat(64);
const P2 = "2".repeat(64);
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const base = { segmentId: null, poster: null, captions: null } as const;
const control: DemoClip = { ...base, id: "sauce-hero-control", example: "food-hot-sauce", role: "hero-control", file: "/demo/sauce/control.mp4", promptHash: P1, sha256: SHA_A };
const culture: DemoClip = { ...base, id: "sauce-hero-culture", example: "food-hot-sauce", role: "hero-culture", segmentId: "seg-a", file: "/demo/sauce/culture.mp4", promptHash: P2, sha256: SHA_B };
const approvedBoth = approvals([P1, P2], [control, culture]);

describe("hero mode", () => {
  it("leads with the example marked lead in lib/demo/examples.ts", () => {
    expect(LEAD_EXAMPLE).toBe("food-hot-sauce");
  });

  it("falls back to the Reality Check card when there are no clips", () => {
    expect(heroMode(manifest([]), approvals([], []), "food-hot-sauce")).toEqual({ kind: "reality-check" });
  });

  it("falls back when no lead example is named", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, null).kind).toBe("reality-check");
  });

  it("ignores approved clips that belong to another example", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, "home-candles").kind).toBe("reality-check");
  });

  it("falls back when the clips exist but the founder has not approved them for the hero", () => {
    expect(heroMode(manifest([control, culture]), approvals([P1, P2], []), "food-hot-sauce").kind).toBe("reality-check");
  });

  it("falls back when only one of the two hook clips is approved", () => {
    expect(heroMode(manifest([control, culture]), approvals([P1, P2], [culture]), "food-hot-sauce").kind).toBe("reality-check");
  });

  it("falls back when a clip was rendered from a prompt that was never approved", () => {
    expect(heroMode(manifest([control, culture]), approvals([P1], [control, culture]), "food-hot-sauce").kind).toBe("reality-check");
  });

  it("falls back after a re-render under the same id, until the new file is approved", () => {
    const rerendered = { ...culture, sha256: "c".repeat(64) };
    expect(heroMode(manifest([control, rerendered]), approvedBoth, "food-hot-sauce").kind).toBe("reality-check");
  });

  it("turns the blind test on once both hook clips are approved as those exact files", () => {
    expect(heroMode(manifest([control, culture]), approvedBoth, "food-hot-sauce")).toEqual({
      kind: "blind-test",
      example: "food-hot-sauce",
      control,
      culture,
    });
  });
});
