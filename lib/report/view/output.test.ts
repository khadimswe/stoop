import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { DemoClip, DemoMedia, DemoStoryboard } from "../../demo/manifest";
import { FRAMES_PER_WORLD, frameScenes } from "../../prompts/frames";
import { getModel } from "../../prompts/models.config";
import type { ProductionPack } from "../../prompts/pack";
import type { Report } from "../schema";
import type { Revision, World, WorldFrames } from "../world";
import { controlOutput, exportView, MCP_LINK, outputViews, shotList, worldOutput } from "./output";
import type { RenderAccess } from "./types";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const OFF: RenderAccess = { kind: "off" };
const NO_MEDIA: DemoMedia = { packshot: null, storyboards: {}, clips: [] };
const hex = (c: string) => c.repeat(64);

describe.each(EXAMPLES.map((e) => e.slug))("the Output section for %s", (slug) => {
  const report = read(slug);
  const outputs = outputViews(report, { media: NO_MEDIA, renderAccess: OFF });
  const packs: ProductionPack[] = [...report.worlds.map((w) => w.pack!), report.control!.pack!];

  it("lists every world in segment order, then the Control", () => {
    expect(outputs.map((o) => o.key)).toEqual([...report.worlds.map((w) => w.segmentId), "control"]);
    expect(outputs.map((o) => o.label)).toEqual([...report.worlds.map((w) => w.label), "Control"]);
    expect(outputs.map((o) => o.isControl)).toEqual([...report.worlds.map(() => false), true]);
    for (const output of outputs) expect(output.partial).toBeNull();
  });

  it("previews each kept concept as its shot list while no frames exist", () => {
    outputs.forEach((output, i) => {
      const { concept } = packs[i];
      expect(output.storyboard).toMatchObject({ kind: "shots", paused: false });
      if (output.storyboard.kind !== "shots") return;
      const { shots } = output.storyboard;
      expect(shots.map((s) => s.scene)).toEqual(frameScenes(concept.scenes));
      expect(shots.length).toBe(Math.min(FRAMES_PER_WORLD, concept.scenes.length));
      expect(shots[0]).toMatchObject({ scene: 0, number: 1, beat: "hook", start: 0, action: concept.scenes[0].action, overlayText: concept.scenes[0].overlayText });
      expect(shots.at(-1)).toMatchObject({ beat: "payoff", end: 15 });
      for (const shot of shots) {
        expect(shot.end - shot.start).toBe(shot.seconds);
        expect(shot).toMatchObject({ number: shot.scene + 1, action: concept.scenes[shot.scene].action, productVisible: concept.scenes[shot.scene].productVisible });
      }
    });
  });

  it("copies the multi-shot prompt the pack's settings chose and one Veo prompt per scene", () => {
    outputs.forEach((output, i) => {
      const pack = packs[i];
      const ex = output.export!;
      const multi = pack.renders.find((r) => r.kind === "multi-shot")!;
      expect(ex.multiShot).toEqual({
        id: multi.id,
        modelId: pack.settings.models.multiShot,
        modelName: getModel(pack.settings.models.multiShot).displayName,
        kind: "multi-shot",
        scenes: pack.concept.scenes.map((_, n) => n + 1),
        renderSeconds: multi.renderSeconds,
        trimTo: 15,
        refs: multi.refs,
        startFrame: null,
        prompt: multi.prompt,
        negative: multi.negative,
        promptHash: multi.promptHash,
      });
      const veo = pack.renders.filter((r) => r.kind === "scene" && getModel(r.modelId).template === "veo");
      expect(veo).toHaveLength(pack.concept.scenes.length);
      expect(ex.veo?.modelName).toBe(getModel(veo[0].modelId).displayName);
      expect(ex.veo?.prompts.map((p) => [p.id, p.scenes, p.prompt])).toEqual(veo.map((r) => [r.id, r.sceneIndexes.map((n) => n + 1), r.prompt]));
    });
  });

  it("carries the rest of the Production Pack as references", () => {
    outputs.forEach((output, i) => {
      const pack = packs[i];
      const { references } = output.export!;
      expect(references.assets.map((a) => [a.file, a.kind, a.prompt])).toEqual(pack.assets.map((a) => [a.file, a.kind, a.prompt]));
      expect(references.assets.map((a) => a.file)).toContain("product_sheet.png");
      // Every render job is either copy-ready here or counted under the other models.
      const counted = references.otherModels.reduce((n, m) => n + m.prompts, 0);
      expect(1 + output.export!.veo!.prompts.length + counted).toBe(pack.renders.length);
      expect(references.otherModels.map((m) => m.modelName)).not.toContain(output.export!.veo!.modelName);
      expect(references).toMatchObject({ shotList: pack.shotList, directorGuide: pack.directorGuide, disclosure: pack.disclosure, reviewChecklist: [...pack.reviewChecklist] });
      expect(references.checklist.map((c) => c.id)).toEqual(pack.checklist.map((c) => c.id));
    });
  });

  it("links to /mcp and passes the render access through when no clip is approved", () => {
    for (const output of outputs) {
      expect(output.mcp).toEqual({ href: "/mcp", label: "Use Stoop inside your Claude" });
      expect(output.video).toEqual(OFF);
    }
    const accesses: RenderAccess[] = [{ kind: "judge" }, { kind: "byok" }, { kind: "budget-used", exampleClip: null }];
    for (const access of accesses) {
      expect(outputViews(report, { renderAccess: access }).map((o) => o.video)).toEqual(outputs.map(() => access));
    }
  });
});

describe("the Output section with media, frames and revisions", () => {
  const report = read("food-hot-sauce");
  const world = report.worlds[0];
  const concept = world.pack!.concept;

  const clip = (over: Partial<DemoClip>): DemoClip => ({
    id: "clip",
    example: "food-hot-sauce",
    role: "culture",
    segmentId: world.segmentId,
    file: "/demo/food-hot-sauce/clip.mp4",
    poster: "/demo/food-hot-sauce/clip.webp",
    captions: null,
    promptHash: hex("1"),
    sha256: hex("a"),
    ...over,
  });
  const board = (segmentId: string | null, frames: [scene: number, attempt: 1 | 2][]): DemoStoryboard => ({
    example: "food-hot-sauce",
    segmentId,
    frames: frames.map(([scene, attempt]) => ({ scene, attempt, file: `/demo/food-hot-sauce/frames/${segmentId ?? "control"}-${scene}-${attempt}.webp`, promptHash: hex("2"), sha256: hex("b"), modelId: "fal-ai/nano-banana-2/edit" })),
    critiques: [],
  });
  const liveFrames = (status: WorldFrames["status"], revisionId: string | null = null): WorldFrames => ({
    revisionId,
    status,
    reason: null,
    frames: status === "done" ? [0, 1, 2, 4].map((scene) => ({ scene, url: `https://frames.example/${scene}.webp`, promptHash: hex("3"), modelId: "fal-ai/flux/schnell", attempt: 1 as const })) : [],
    critiques: [],
  });

  it("shows an example's approved storyboard, the newest attempt per scene, in scene order", () => {
    const media: DemoMedia = { ...NO_MEDIA, storyboards: { [world.segmentId]: board(world.segmentId, [[3, 1], [0, 1], [3, 2], [9, 1]]), control: board(null, [[0, 1]]) } };
    const [first, , control] = outputViews(report, { media, renderAccess: OFF });
    expect(first.storyboard).toMatchObject({ kind: "frames", source: "example" });
    if (first.storyboard.kind !== "frames") return;
    // Scene 9 does not exist in the concept, so it is dropped.
    expect(first.storyboard.frames.map((f) => [f.scene, f.attempt, f.src])).toEqual([
      [0, 1, `/demo/food-hot-sauce/frames/${world.segmentId}-0-1.webp`],
      [3, 2, `/demo/food-hot-sauce/frames/${world.segmentId}-3-2.webp`],
    ]);
    expect(first.storyboard.frames[0].alt).toBe(`Storyboard frame for shot 1 (hook): ${concept.scenes[0].action}`);
    expect(first.storyboard.shots).toEqual(shotList(concept));
    expect(control.storyboard).toMatchObject({ kind: "frames", source: "example", frames: [{ scene: 0 }] });
  });

  it("plays an approved clip for its own world or the Control, never a hero hook cut", () => {
    const media: DemoMedia = {
      ...NO_MEDIA,
      clips: [clip({ id: "hero", role: "hero-culture" }), clip({ id: "culture" }), clip({ id: "control", role: "control", segmentId: null, file: "/demo/food-hot-sauce/control.mp4" })],
    };
    const [first, second, control] = outputViews(report, { media, renderAccess: { kind: "judge" } });
    expect(first.video).toEqual({ kind: "clip", clip: { id: "culture", src: "/demo/food-hot-sauce/clip.mp4", poster: "/demo/food-hot-sauce/clip.webp", captions: null, label: world.label } });
    expect(second.video).toEqual({ kind: "judge" });
    expect(control.video).toMatchObject({ kind: "clip", clip: { id: "control", label: "Control" } });
  });

  it("follows a live frame job: rendering, done, paused, failed", () => {
    const withFrames = (frames: WorldFrames): World => ({ ...world, frames });
    expect(worldOutput(withFrames(liveFrames("rendering")), { renderAccess: OFF }).storyboard).toEqual({ kind: "rendering", shots: shotList(concept) });
    const done = worldOutput(withFrames(liveFrames("done")), { renderAccess: OFF }).storyboard;
    expect(done).toMatchObject({ kind: "frames", source: "live" });
    if (done.kind === "frames") expect(done.frames.map((f) => f.src)).toEqual([0, 1, 2, 4].map((s) => `https://frames.example/${s}.webp`));
    expect(worldOutput(withFrames(liveFrames("paused")), { renderAccess: OFF }).storyboard).toEqual({ kind: "shots", shots: shotList(concept), paused: true });
    expect(worldOutput(withFrames(liveFrames("failed")), { renderAccess: OFF }).storyboard).toEqual({ kind: "shots", shots: shotList(concept), paused: false });
  });

  it("shows the newest revision's pack, and only frames rendered for it", () => {
    const pack = structuredClone(world.pack!);
    pack.renders[0].prompt = `${pack.renders[0].prompt}\nREVISED`;
    pack.concept.title = "Revised concept";
    const revision: Revision = {
      id: "rev-0123456789ab",
      field: "music",
      reason: null,
      excluded: [],
      changes: [],
      brief: world.brief!,
      culture: world.culture!,
      richSlots: world.richSlots,
      concepts: world.concepts,
      pack,
      kit: world.kit,
      evidenceIds: [],
    };
    const revised: World = { ...world, revisions: [revision], frames: liveFrames("done", null) };
    const output = worldOutput(revised, { renderAccess: OFF });
    expect(output.export?.multiShot?.prompt).toMatch(/REVISED$/);
    // The live frames belong to the world's own pack, so they do not show next to the revision.
    expect(output.storyboard.kind).toBe("shots");
    const framed = worldOutput({ ...revised, frames: liveFrames("done", revision.id) }, { renderAccess: OFF });
    expect(framed.storyboard.kind).toBe("frames");
  });

  it("stays honest for a world that stopped before its concept", () => {
    const partial: World = { ...world, concepts: null, pack: null, kit: null, partial: { stage: "concepts", reason: "The concept writer timed out." } };
    const output = worldOutput(partial, { renderAccess: OFF });
    expect(output).toMatchObject({ storyboard: { kind: "none" }, export: null, partial: { stage: "concepts" }, mcp: MCP_LINK });
    expect(controlOutput({ ...report.control!, concepts: null, pack: null }, { renderAccess: OFF }).storyboard).toEqual({ kind: "none" });
  });

  it("finds no multi-shot prompt when the pack's chosen model has none", () => {
    const pack = structuredClone(world.pack!);
    pack.renders = pack.renders.filter((r) => r.kind !== "multi-shot");
    expect(exportView(pack).multiShot).toBeNull();
  });
});
