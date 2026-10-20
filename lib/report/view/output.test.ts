import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessUrl,
  byokHref,
  fetchRenderAccess,
  hasJudgeHint,
  OFF_ACCESS,
  parseAccess,
  parseJob,
  pollDraft,
  retryAfterMs,
  startDraft,
} from "../../../hooks/use-render-access";
import { EXAMPLES } from "../../demo/examples";
import type { DemoClip, DemoMedia, DemoStoryboard } from "../../demo/manifest";
import { FRAMES_PER_WORLD } from "../../prompts/frames";
import { getModel } from "../../prompts/models.config";
import type { ProductionPack } from "../../prompts/pack";
import { distinctiveStems } from "../../stages/concepts";
import type { Report } from "../schema";
import type { Revision, World, WorldFrames } from "../world";
import { controlOutput, exportView, MCP_LINK, outputViews, panelNoun, pickRow, shotCarries, shotList, signalRows, worldOutput, type OutputContext } from "./output";
import { ledgerOf } from "./receipts";
import type { RenderAccess } from "./types";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const OFF: RenderAccess = { kind: "off" };
const NO_MEDIA: DemoMedia = { packshot: null, storyboards: {}, clips: [] };
const hex = (c: string) => c.repeat(64);
/** The brief's own cue behind a slot key ("music", "voice.tone", "setting.1"). */
function briefCue(world: World, slot: string) {
  const brief = world.brief!;
  if (slot === "voice.tone") return brief.voice.tone;
  if (slot.startsWith("setting.")) return brief.setting[Number(slot.slice(-1))];
  return brief[slot as "music" | "visual" | "mood" | "wardrobe" | "productRole" | "talent"]!;
}

const contextOf = (report: Report, renderAccess: RenderAccess = OFF, media: DemoMedia | null = null): OutputContext => ({
  reportId: report.meta.id,
  ledger: ledgerOf(report),
  renderAccess,
  media,
});

describe.each(EXAMPLES.map((e) => e.slug))("the Output section for %s", (slug) => {
  const report = read(slug);
  const outputs = outputViews(report, { media: NO_MEDIA, renderAccess: OFF });
  const packs: ProductionPack[] = [...report.worlds.map((w) => w.pack!), report.control!.pack!];
  const briefs = [...report.worlds.map((w) => w.brief!), report.control!.brief];
  const uses = [...report.worlds.map((w) => w.concepts!.best.verifiedUses), report.control!.concepts!.best.verifiedUses];

  it("lists every world in segment order, then the Control, each with its render target", () => {
    expect(outputs.map((o) => o.key)).toEqual([...report.worlds.map((w) => w.segmentId), "control"]);
    expect(outputs.map((o) => o.label)).toEqual([...report.worlds.map((w) => w.label), "Control"]);
    expect(outputs.map((o) => o.isControl)).toEqual([...report.worlds.map(() => false), true]);
    expect(outputs.map((o) => o.target)).toEqual(outputs.map((o) => ({ reportId: `example-${slug}`, segment: o.key })));
    for (const output of outputs) expect(output.partial).toBeNull();
  });

  it("previews each kept concept as its shot list while no frames exist", () => {
    outputs.forEach((output, i) => {
      const { concept } = packs[i];
      expect(output.storyboard).toMatchObject({ kind: "shots", paused: false });
      if (output.storyboard.kind !== "shots") return;
      const { shots } = output.storyboard;
      expect(shots).toEqual(shotList(concept, briefs[i], uses[i]));
      // Every scene, numbered without gaps: only frames are capped (at FRAMES_PER_WORLD, for cost).
      expect(shots.map((s) => s.scene)).toEqual(concept.scenes.map((_, i) => i));
      expect(shots.map((s) => s.number)).toEqual(concept.scenes.map((_, i) => i + 1));
      if (concept.scenes.length > FRAMES_PER_WORLD) expect(shots.length).toBeGreaterThan(FRAMES_PER_WORLD);
      expect(shots[0]).toMatchObject({ scene: 0, number: 1, beat: "hook", start: 0, action: concept.scenes[0].action, overlayText: concept.scenes[0].overlayText });
      expect(shots.at(-1)).toMatchObject({ beat: "payoff", end: 15 });
      for (const shot of shots) {
        expect(shot.end - shot.start).toBe(shot.seconds);
        expect(shot).toMatchObject({ number: shot.scene + 1, action: concept.scenes[shot.scene].action, productVisible: concept.scenes[shot.scene].productVisible });
      }
    });
  });

  it("says which brief cues each shot carries, only from the cues the whole concept verified", () => {
    outputs.forEach((output, i) => {
      const carries = shotCarries(packs[i].concept, briefs[i], uses[i]);
      expect(carries).toHaveLength(packs[i].concept.scenes.length);
      const verified = new Set(uses[i]);
      for (const slots of carries) for (const slot of slots) expect(verified.has(slot)).toBe(true);
      // Every carried slot has distinctive words of its own in this brief.
      const distinctive = distinctiveStems(briefs[i]);
      for (const slots of carries) for (const slot of slots) expect(distinctive.get(slot)?.size).toBeGreaterThan(0);
      // The shots carry something: the concept was verified against these same words.
      expect(carries.flat().length).toBeGreaterThan(0);
    });
  });

  it("shows each world's brief with Qloo-backed cues first, each with a receipt", () => {
    const ledger = ledgerOf(report);
    report.worlds.forEach((world, i) => {
      const { cues } = outputs[i];
      const backed = cues.filter((c) => c.origin === "qloo" || c.origin === "interpreted");
      expect(cues.slice(0, backed.length)).toEqual(backed);
      expect(backed[0]).toMatchObject({ slot: "music", label: "Music style" });
      for (const cue of backed) {
        expect(cue.receipt).not.toBeNull();
        expect(cue.receipt!.cue).toBe(cue.label);
        expect(cue.receipt!.title).toBe(cue.text);
        expect(cue.receipt!.rows.filter((r) => r.label === "Qloo pick").map((r) => r.value.split(" (")[0])).toEqual(cue.picks);
        // One call per distinct ledger entry the brief's own cue cites.
        const source = briefCue(world, cue.slot);
        expect(source.text).toBe(cue.text);
        expect(cue.receipt!.calls).toBe(new Set(source.evidenceIds.filter((id) => ledger.has(id))).size);
        expect(cue.receipt!.calls).toBeGreaterThan(0);
      }
      for (const cue of cues.filter((c) => c.origin === "creative")) expect(cue).toMatchObject({ receipt: null, picks: [] });
      expect(cues.filter((c) => c.used).map((c) => c.slot).sort()).toEqual([...world.concepts!.best.verifiedUses].sort());
    });
  });

  it("names Qloo's artist picks in receipts, never in the prompts (music is described as a style)", () => {
    report.worlds.forEach((world, i) => {
      const music = outputs[i].cues.find((c) => c.slot === "music")!;
      const rows = music.receipt!.rows.filter((r) => r.label === "Qloo pick");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.value).toMatch(/: #\d+ in its Qloo response/);
      const sources = world.culture!.find((f) => f.field === "music")!.sources;
      expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(music.picks));
      const artists = sources.filter((s) => s.type === "urn:entity:artist" && music.picks.includes(s.name)).map((s) => s.name);
      expect(artists.length).toBeGreaterThan(0);
      for (const name of artists) {
        expect(outputs[i].export!.multiShot!.prompt).not.toContain(name);
        for (const p of outputs[i].export!.veo!.prompts) expect(p.prompt).not.toContain(name);
      }
    });
  });

  it("gives the Control's brief no receipts: every cue is not from Qloo", () => {
    const control = outputs.at(-1)!;
    expect(control.cues.length).toBeGreaterThan(0);
    for (const cue of control.cues) expect(cue).toMatchObject({ origin: "creative", receipt: null });
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

  it("links to /mcp and passes the render access through, with no clip when none is approved", () => {
    for (const output of outputs) {
      expect(output.mcp).toEqual({ href: "/mcp", label: "Use Stoop inside your Claude" });
      expect(output.video).toEqual({ clip: null, access: OFF });
    }
    const accesses: RenderAccess[] = [{ kind: "judge" }, { kind: "byok" }, { kind: "budget-used", exampleClip: null }];
    for (const access of accesses) {
      expect(outputViews(report, { renderAccess: access }).map((o) => o.video)).toEqual(outputs.map(() => ({ clip: null, access })));
    }
  });
});

describe("receipt wording", () => {
  it("states each field's signal with its own counts of strong picks", () => {
    for (const slug of EXAMPLES.map((e) => e.slug)) {
      for (const world of read(slug).worlds) {
        for (const field of world.culture!.filter((f) => f.signal !== "none")) {
          const [signal, rule] = signalRows(field);
          const match = /^(rich|thin): (\d+) of (\d+) picks? strong \(3 or more strong makes a field rich\)$/.exec(signal.value)!;
          expect(match, signal.value).not.toBeNull();
          expect(match[1]).toBe(field.signal);
          expect(Number(match[3])).toBe(field.sources.length);
          // The level agrees with the count, as the culture stage decided it.
          expect(Number(match[2]) >= 3).toBe(field.signal === "rich");
          expect(rule.value).toMatch(/^beats at least 75% of its reference panel/);
        }
      }
    }
    // The lead's Voice field cites 3 picks and is still thin: the receipt says why.
    const voice = read("food-hot-sauce").worlds[0].culture!.find((f) => f.field === "voice")!;
    expect(signalRows(voice)[0].value).toMatch(new RegExp(`^thin: [0-2] of ${voice.sources.length} picks strong`));
  });

  it("names each reference panel in plain words", () => {
    expect(panelNoun("urn:entity:artist")).toBe("artists");
    expect(panelNoun("urn:entity:movie")).toBe("films");
    expect(panelNoun("urn:entity:tv_show")).toBe("TV shows");
    expect(panelNoun("urn:entity:brand")).toBe("brands");
    expect(panelNoun("urn:tag:genre:music")).toBe("music tags");
    expect(panelNoun("urn:tag:emotional_tone:qloo")).toBe("mood tags");
  });

  it("states a pick's rank and panel position, and a place's explanation, never a percentile", () => {
    const report = read("food-hot-sauce");
    const culture = report.worlds[0].culture!;
    const artist = culture.find((f) => f.field === "music")!.sources[0];
    expect(pickRow(artist)).toEqual({
      label: "Qloo pick",
      value: `${artist.name} (artist): #${artist.rank} in its Qloo response, beats ${artist.position!.beats} of ${artist.position!.of} reference artists`,
    });
    const place = culture.find((f) => f.field === "setting")!.sources[0];
    expect(pickRow(place).value).toBe(`${place.name} (place): #${place.rank} in its Qloo response, Qloo says: ${place.why.join("; ")}`);
    expect(pickRow(place).value).not.toMatch(/%|percentile/);
  });
});

describe("the Output section with media, frames and revisions", () => {
  const report = read("food-hot-sauce");
  const world = report.worlds[0];
  const concept = world.pack!.concept;
  const ctx = contextOf(report);
  const shots = () => shotList(concept, world.brief, world.concepts!.best.verifiedUses);

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
    expect(first.storyboard.shots).toEqual(shots());
    expect(control.storyboard).toMatchObject({ kind: "frames", source: "example", frames: [{ scene: 0 }] });
  });

  it("plays an approved clip first for its own world or the Control, never a hero hook cut, and keeps the access line", () => {
    const media: DemoMedia = {
      ...NO_MEDIA,
      clips: [clip({ id: "hero", role: "hero-culture" }), clip({ id: "culture" }), clip({ id: "control", role: "control", segmentId: null, file: "/demo/food-hot-sauce/control.mp4" })],
    };
    const [first, second, control] = outputViews(report, { media, renderAccess: { kind: "judge" } });
    expect(first.video).toEqual({
      clip: { id: "culture", src: "/demo/food-hot-sauce/clip.mp4", poster: "/demo/food-hot-sauce/clip.webp", captions: null, label: world.label },
      access: { kind: "judge" },
    });
    expect(second.video).toEqual({ clip: null, access: { kind: "judge" } });
    expect(control.video).toMatchObject({ clip: { id: "control", label: "Control" }, access: { kind: "judge" } });
  });

  it("follows a live frame job: rendering, done, paused, failed", () => {
    const withFrames = (frames: WorldFrames): World => ({ ...world, frames });
    expect(worldOutput(withFrames(liveFrames("rendering")), ctx).storyboard).toEqual({ kind: "rendering", shots: shots() });
    const done = worldOutput(withFrames(liveFrames("done")), ctx).storyboard;
    expect(done).toMatchObject({ kind: "frames", source: "live" });
    if (done.kind === "frames") expect(done.frames.map((f) => f.src)).toEqual([0, 1, 2, 4].map((s) => `https://frames.example/${s}.webp`));
    expect(worldOutput(withFrames(liveFrames("paused")), ctx).storyboard).toEqual({ kind: "shots", shots: shots(), paused: true });
    expect(worldOutput(withFrames(liveFrames("failed")), ctx).storyboard).toEqual({ kind: "shots", shots: shots(), paused: false });
  });

  it("shows the newest revision's pack and brief, and only frames rendered for it", () => {
    const pack = structuredClone(world.pack!);
    pack.renders[0].prompt = `${pack.renders[0].prompt}\nREVISED`;
    pack.concept.title = "Revised concept";
    const brief = structuredClone(world.brief!);
    brief.music = { ...brief.music, text: "Revised music cue" };
    const revision: Revision = {
      id: "rev-0123456789ab",
      field: "music",
      reason: null,
      excluded: [],
      changes: [],
      brief,
      culture: world.culture!,
      richSlots: world.richSlots,
      concepts: world.concepts,
      pack,
      kit: world.kit,
      evidenceIds: [],
    };
    const revised: World = { ...world, revisions: [revision], frames: liveFrames("done", null) };
    const output = worldOutput(revised, ctx);
    expect(output.export?.multiShot?.prompt).toMatch(/REVISED$/);
    expect(output.cues.find((c) => c.slot === "music")?.text).toBe("Revised music cue");
    // The live frames belong to the world's own pack, so they do not show next to the revision.
    expect(output.storyboard.kind).toBe("shots");
    const framed = worldOutput({ ...revised, frames: liveFrames("done", revision.id) }, ctx);
    expect(framed.storyboard.kind).toBe("frames");
  });

  it("stays honest for a world that stopped before its concept", () => {
    const partial: World = { ...world, concepts: null, pack: null, kit: null, partial: { stage: "concepts", reason: "The concept writer timed out." } };
    const output = worldOutput(partial, ctx);
    expect(output).toMatchObject({ storyboard: { kind: "none" }, export: null, partial: { stage: "concepts" }, mcp: MCP_LINK });
    // The brief still shows, but no cue is "used" by a concept that does not exist.
    expect(output.cues.every((c) => !c.used)).toBe(true);
    expect(controlOutput({ ...report.control!, concepts: null, pack: null }, ctx).storyboard).toEqual({ kind: "none" });
  });

  it("finds no multi-shot prompt when the pack's chosen model has none", () => {
    const pack = structuredClone(world.pack!);
    pack.renders = pack.renders.filter((r) => r.kind !== "multi-shot");
    expect(exportView(pack).multiShot).toBeNull();
  });

  it("names the setting the concept uses plainly, and numbers the brief's other settings", () => {
    const { cues } = worldOutput(world, ctx);
    expect(world.concepts!.best.verifiedUses).toContain("setting.0");
    expect(cues.filter((c) => c.slot.startsWith("setting.")).map((c) => [c.slot, c.label, c.used])).toEqual(
      world.brief!.setting.map((_, i) => [`setting.${i}`, i === 0 ? "Setting" : `Setting ${i + 1}`, i === 0]),
    );
  });

  it("carries nothing per shot without a brief", () => {
    expect(shotCarries(concept, null, world.concepts!.best.verifiedUses).every((s) => s.length === 0)).toBe(true);
    expect(shotCarries(concept, world.brief, []).every((s) => s.length === 0)).toBe(true);
  });
});

// --- The video line on the client (hooks/use-render-access.ts), with a mocked fetch ----------------

const TARGET = { reportId: "example-food-hot-sauce", segment: "seg-55-and-older" };
const JOB = "rj_0123456789abcdef01234567";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const job = (status: string, over: Record<string, unknown> = {}) => ({ job: { id: JOB, target: TARGET, status, videoUrl: null, reason: null, cached: false, ...over } });

describe("the render access answer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks for this report and world, and links BYOK with the same target", () => {
    expect(accessUrl(TARGET)).toBe("/api/render/access?reportId=example-food-hot-sauce&segment=seg-55-and-older");
    expect(byokHref({ ...TARGET, segment: "control" })).toBe("/byok?reportId=example-food-hot-sauce&segment=control");
  });

  it("reads each of the four states", async () => {
    for (const video of ["judge", "byok", "budget-used", "off"] as const) {
      const fetchImpl = vi.fn(async () => json({ video, rendersLeft: video === "judge" ? 3 : null, byok: video !== "off" }));
      await expect(fetchRenderAccess(TARGET, fetchImpl)).resolves.toEqual({ video, rendersLeft: video === "judge" ? 3 : null, byok: video !== "off" });
      expect(fetchImpl).toHaveBeenCalledWith(accessUrl(TARGET), expect.objectContaining({ cache: "no-store" }));
    }
  });

  it("reads any error as off, quietly", async () => {
    await expect(fetchRenderAccess(TARGET, async () => new Response("Not found", { status: 404 }))).resolves.toEqual(OFF_ACCESS);
    await expect(fetchRenderAccess(TARGET, async () => json({ error: { code: "failed", message: "x" } }, 500))).resolves.toEqual(OFF_ACCESS);
    await expect(fetchRenderAccess(TARGET, async () => Promise.reject(new TypeError("offline")))).resolves.toEqual(OFF_ACCESS);
    await expect(fetchRenderAccess(TARGET, async () => new Response("<html>", { status: 200 }))).resolves.toEqual(OFF_ACCESS);
    await expect(fetchRenderAccess(TARGET, async () => json({ video: "unlimited", rendersLeft: null, byok: true }))).resolves.toEqual(OFF_ACCESS);
  });

  it("rejects malformed answers", () => {
    expect(parseAccess({ video: "judge", rendersLeft: -1, byok: true })).toBeNull();
    expect(parseAccess({ video: "judge", rendersLeft: 1.5, byok: true })).toBeNull();
    expect(parseAccess({ video: "judge", rendersLeft: 2 })).toBeNull();
    expect(parseAccess(null)).toBeNull();
    expect(parseAccess({ video: "byok", rendersLeft: null, byok: true })).toEqual({ video: "byok", rendersLeft: null, byok: true });
  });

  it("reads the judge hint cookie, never anything else", () => {
    expect(hasJudgeHint("stoop_judge_ui=1")).toBe(true);
    expect(hasJudgeHint("a=b; stoop_judge_ui=1; c=d")).toBe(true);
    expect(hasJudgeHint("stoop_judge_ui=0")).toBe(false);
    expect(hasJudgeHint("stoop_judge=1")).toBe(false);
    expect(hasJudgeHint("")).toBe(false);
  });
});

describe("a judge draft", () => {
  it("starts with only the target, never a prompt, and reads the 202 the route answers", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ target: TARGET });
      expect(init?.method).toBe("POST");
      return json(job("queued"), 202);
    });
    await expect(startDraft(TARGET, fetchImpl)).resolves.toMatchObject({ kind: "job", job: { id: JOB, status: "queued" } });
    expect(fetchImpl).toHaveBeenCalledWith("/api/render", expect.anything());
  });

  it("maps a spent budget, a switched-off server and anything else", async () => {
    await expect(startDraft(TARGET, async () => json({ error: { code: "daily_cap", message: "Spent" } }, 429))).resolves.toEqual({ kind: "budget-used" });
    // A burst of requests is not the budget.
    await expect(startDraft(TARGET, async () => json({ error: { code: "rate_limited", message: "Slow down" } }, 429))).resolves.toMatchObject({ kind: "error" });
    await expect(startDraft(TARGET, async () => json({ error: { code: "off", message: "Off" } }, 503))).resolves.toEqual({ kind: "off" });
    await expect(startDraft(TARGET, async () => json({ error: { code: "off", message: "Needs a judge pass" } }, 403))).resolves.toEqual({ kind: "off" });
    // An earlier try may still be rendering: say the server's words, and offer no retry.
    await expect(startDraft(TARGET, async () => json({ error: { code: "busy", message: "Try again in about two hours." } }, 409))).resolves.toEqual({
      kind: "error",
      message: "Try again in about two hours.",
      retry: false,
    });
    await expect(startDraft(TARGET, async () => json({ error: { code: "failed", message: "x" } }, 502))).resolves.toMatchObject({ kind: "error", retry: true });
    await expect(startDraft(TARGET, async () => json({ error: { code: "invalid", message: "No" } }, 400))).resolves.toMatchObject({ kind: "error" });
    await expect(startDraft(TARGET, async () => Promise.reject(new TypeError("offline")))).resolves.toMatchObject({ kind: "error" });
    await expect(startDraft(TARGET, async () => json({ job: { id: "nope" } }))).resolves.toMatchObject({ kind: "error" });
  });

  it("plays only https videos, and a done job must have one", () => {
    expect(parseJob(job("done", { videoUrl: "https://blob.example/draft.mp4" }))?.videoUrl).toBe("https://blob.example/draft.mp4");
    expect(parseJob(job("done", { videoUrl: "javascript:alert(1)" }))).toBeNull();
    expect(parseJob(job("done", { videoUrl: "http://blob.example/draft.mp4" }))).toBeNull();
    expect(parseJob(job("done"))).toBeNull();
    expect(parseJob(job("rendering"))).toMatchObject({ status: "rendering", videoUrl: null });
  });

  it("polls until the job is done, retrying failed checks", async () => {
    const answers = [json(job("queued")), new Response("busy", { status: 502 }), json(job("rendering")), json(job("done", { videoUrl: "https://blob.example/d.mp4", cached: true }))];
    const fetchImpl = vi.fn(async () => answers.shift()!);
    const sleep = vi.fn(async () => {});
    const updates: string[] = [];
    const result = await pollDraft(JOB, { fetchImpl, sleep, intervalMs: 10, onUpdate: (j) => updates.push(j.status) });
    expect(result).toMatchObject({ kind: "settled", job: { status: "done", videoUrl: "https://blob.example/d.mp4", cached: true } });
    expect(updates).toEqual(["queued", "rendering", "done"]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/render/${JOB}`, expect.objectContaining({ cache: "no-store" }));
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("backs off after failed checks, honors Retry-After, and resets once a check succeeds", async () => {
    const answers = [
      new Response("busy", { status: 502 }),
      Promise.reject(new TypeError("offline")),
      new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
      json(job("rendering")),
      json(job("done", { videoUrl: "https://blob.example/d.mp4" })),
    ];
    const waits: number[] = [];
    const result = await pollDraft(JOB, {
      fetchImpl: async () => answers.shift()!,
      sleep: async (ms) => void waits.push(ms),
      intervalMs: 1000,
      maxIntervalMs: 60_000,
      visible: async () => {},
    });
    expect(result).toMatchObject({ kind: "settled", job: { status: "done" } });
    // 2 s, then 4 s (doubling per failure in a row), then the server's 30 s, then back to 1 s.
    expect(waits).toEqual([2000, 4000, 30_000, 1000]);
  });

  it("reads Retry-After as seconds or as a date", () => {
    expect(retryAfterMs("12")).toBe(12_000);
    expect(retryAfterMs(new Date(Date.UTC(2026, 9, 19, 12, 0, 30)).toUTCString(), Date.UTC(2026, 9, 19, 12, 0, 0))).toBe(30_000);
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });

  it("waits for the page to be visible before each check", async () => {
    const order: string[] = [];
    await pollDraft(JOB, {
      fetchImpl: async () => {
        order.push("fetch");
        return json(job("done", { videoUrl: "https://blob.example/d.mp4" }));
      },
      sleep: async () => {},
      visible: async () => void order.push("visible"),
    });
    expect(order).toEqual(["visible", "fetch"]);
  });

  it("stops on a failed job, on the timeout and on abort", async () => {
    await expect(pollDraft(JOB, { fetchImpl: async () => json(job("failed", { reason: "fal error" })), sleep: async () => {} })).resolves.toMatchObject({ kind: "settled", job: { status: "failed" } });

    let clock = 0;
    const timeout = await pollDraft(JOB, { fetchImpl: async () => json(job("rendering")), sleep: async (ms) => void (clock += ms), now: () => clock, intervalMs: 1000, timeoutMs: 3000 });
    expect(timeout).toEqual({ kind: "timeout" });
    expect(clock).toBe(3000);

    const controller = new AbortController();
    const aborted = pollDraft(JOB, {
      fetchImpl: async () => {
        controller.abort();
        return json(job("rendering"));
      },
      sleep: async () => {},
      signal: controller.signal,
    });
    await expect(aborted).resolves.toEqual({ kind: "aborted" });
  });

  it("never asks about an id that is not a job id, and stops on a job the server does not know", async () => {
    const fetchImpl = vi.fn();
    await expect(pollDraft("../../api/admin", { fetchImpl })).resolves.toEqual({ kind: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const gone = vi.fn(async () => json({ error: { code: "not_found", message: "No such job" } }, 404));
    await expect(pollDraft(JOB, { fetchImpl: gone, sleep: async () => {} })).resolves.toEqual({ kind: "missing" });
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
