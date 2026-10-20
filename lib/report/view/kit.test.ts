import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { DemoMedia, DemoStoryboard } from "../../demo/manifest";
import { getModel } from "../../prompts/models.config";
import type { Report } from "../schema";
import type { Revision, World, WorldFrames } from "../world";
import { captionLines, conceptText, fenced, fenceFor, fileSlug, kitView, leadFor, storyboardView, unescapeVtt, videoPrompts, type ConceptCardView, type CutCardView, type KitWorldView } from "./kit";
import { describeRecorded } from "../../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const hex = (c: string) => c.repeat(64);
const conceptCards = (w: KitWorldView) => w.cards.filter((c): c is ConceptCardView => c.kind === "concept");
const cutCards = (w: KitWorldView) => w.cards.filter((c): c is CutCardView => c.kind === "cut");

describeRecorded.each(EXAMPLES.map((e) => e.slug))("the Campaign Kit view for %s", (slug) => {
  const report = read(slug);
  const view = kitView(report);

  it("groups each world's cards under it: the kept concept, its other cut, the runner-ups, then captions, plan and brief", () => {
    expect(view.worlds.map((w) => [w.segmentId, w.label])).toEqual(report.worlds.map((w) => [w.segmentId, w.label]));
    view.worlds.forEach((row, i) => {
      const world = report.worlds[i];
      const { concept } = world.pack!;
      expect(row).toMatchObject({ hook: concept.hook, testHypothesis: concept.testHypothesis ?? null, revisionId: null, partial: null, scriptCount: world.kit!.ugc.length });
      const kinds = row.cards.map((c) => c.kind);
      expect(kinds[0]).toBe("concept");
      expect(kinds.slice(-3)).toEqual(["captions", "plan", "brief"]);
      const [kept, ...runnerUps] = conceptCards(row);
      expect(kept).toMatchObject({ status: "kept", title: concept.title, hook: concept.hook, score: world.concepts!.best.total, platformLabel: "Meta Reels and Stories" });
      expect(runnerUps.map((c) => [c.status, c.title, c.score])).toEqual(world.concepts!.others.map((o) => ["ranked", o.concept.title, o.total]));
      for (const card of runnerUps) {
        expect(card.copy.label).toBe("Copy concept");
        expect(card.actorPrompts).toEqual([]);
      }
    });
  });

  it("copies every script in the kit from some card, and the human creator's script first", () => {
    view.worlds.forEach((row, i) => {
      const { ugc } = report.worlds[i].kit!;
      const [kept] = conceptCards(row);
      const cuts = cutCards(row);
      expect(kept.copy).toEqual({ label: "Copy script", text: leadFor(ugc, "meta")!.script });
      expect(cuts.map((c) => [c.platform, c.copy.text, c.cta])).toEqual([["tiktok", leadFor(ugc, "tiktok")!.script, leadFor(ugc, "tiktok")!.cta]]);
      const reachable = [kept.copy.text, ...kept.actorPrompts.map((p) => p.text), ...cuts.flatMap((c) => [c.copy.text, ...c.actorPrompts.map((p) => p.text)])];
      expect(reachable.sort()).toEqual(ugc.map((s) => s.script).sort());
      for (const option of [...kept.actorPrompts, ...cuts.flatMap((c) => c.actorPrompts)]) expect(["Arcads", "Creatify"]).toContain(option.label);
    });
  });

  it("offers every render prompt of the Production Pack, one menu entry per model, named from models.config", () => {
    view.worlds.forEach((row, i) => {
      const { pack } = report.worlds[i];
      const models = [...new Set(pack!.renders.map((r) => r.modelId))];
      expect(row.videoPrompts.map((p) => p.label)).toEqual(models.map((id) => getModel(id).displayName));
      const all = row.videoPrompts.map((p) => p.text).join("\n");
      for (const job of pack!.renders) expect(all).toContain(job.prompt);
      expect(row.videoPrompts[0].detail).toMatch(/one 15 s multi-shot clip$/);
    });
  });

  it("lists the brief slots each concept draws on with its origin, and a receipt for every Qloo cue", () => {
    view.worlds.forEach((row, i) => {
      const world = report.worlds[i];
      const [kept, ...runnerUps] = conceptCards(row);
      expect(kept.ingredients.map((x) => x.slot)).toEqual(world.concepts!.best.verifiedUses);
      expect(runnerUps.map((c) => c.ingredients.map((x) => x.slot))).toEqual(world.concepts!.others.map((o) => o.verifiedUses));
      for (const card of [kept, ...runnerUps]) {
        for (const item of card.ingredients) {
          if (item.origin === "qloo" || item.origin === "interpreted") expect(item.receipt?.calls).toBeGreaterThan(0);
          else expect(item.receipt).toBeNull();
        }
      }
      expect(kept.ingredients.find((x) => x.slot === "productRole")?.origin).toBe("creative");
      // One receipt per slot, shared by the world's concepts.
      const music = [kept, ...runnerUps].flatMap((c) => c.ingredients.filter((x) => x.slot === "music"));
      for (const item of music) expect(item.receipt).toBe(music[0].receipt);
    });
  });

  it("lays out the captions, the ad plan and the creator brief from the kit as written", () => {
    view.worlds.forEach((row, i) => {
      const kit = report.worlds[i].kit!;
      const captions = row.cards.find((c) => c.kind === "captions");
      expect(captions).toMatchObject({ copy: { text: kit.captions } });
      const plan = row.cards.find((c) => c.kind === "plan");
      expect(plan).toMatchObject({ name: kit.adPlan!.name, cities: kit.adPlan!.cities, watch: kit.adPlan!.watch, note: kit.adPlan!.note });
      if (plan?.kind === "plan") {
        expect(plan.ageBands.join(" ")).not.toMatch(/24_and_younger|24 and younger/);
        expect(plan.receipt?.calls).toBe(new Set(kit.adPlan!.evidenceIds).size);
      }
      const brief = row.cards.find((c) => c.kind === "brief");
      expect(brief).toMatchObject({ hooks: kit.creatorBrief!.hooks, hit: kit.creatorBrief!.hit, avoid: kit.creatorBrief!.avoid, disclosure: kit.creatorBrief!.disclosure });
      if (brief?.kind === "brief") expect(brief.profile).toMatchObject({ text: kit.creatorBrief!.profile.text, origin: "interpreted", receipt: { cue: "Creator profile" } });
    });
  });

  it("counts concepts and scripts, and builds the downloads from the kit", () => {
    expect(view.counts).toEqual({
      worlds: report.worlds.length,
      concepts: report.worlds.reduce((n, w) => n + 1 + w.concepts!.others.length, 0),
      scripts: report.worlds.reduce((n, w) => n + w.kit!.ugc.length, 0),
    });
    const csv = view.downloads.adPlan!;
    expect(csv.file).toBe(`${fileSlug(report.inputs.product.brandName!)}-ad-plan.csv`);
    // A UTF-8 byte order mark first, so spreadsheet apps read the text as written.
    expect(csv.text.startsWith("\uFEFF")).toBe(true);
    const lines = csv.text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Concept world,Ad set (Meta) or ad group (TikTok),Age bands (optional),Cities (optional),Creatives,What to watch,Note");
    expect(lines).toHaveLength(1 + report.worlds.length);
    expect(csv.text).not.toMatch(/24_and_younger/);
    const briefs = view.downloads.creatorBrief!.text;
    for (const world of report.worlds) {
      expect(briefs).toContain(`## ${world.label}`);
      for (const hook of world.kit!.creatorBrief!.hooks) expect(briefs).toContain(hook);
    }
  });

  it("joins a Production Pack download from the pack's own parts", () => {
    view.worlds.forEach((row, i) => {
      const { pack } = report.worlds[i];
      expect(row.pack!.file).toMatch(/-production-pack\.md$/);
      for (const asset of pack!.assets) expect(row.pack!.head).toContain(asset.file);
      expect(row.pack!.tail).toContain(pack!.directorGuide);
      expect(row.pack!.tail).toContain(pack!.disclosure);
    });
  });

  it("asks for storyboards only where a pack exists and no frames do", () => {
    for (const row of view.worlds) expect(row.storyboard).toEqual({ status: "none", reason: null, frames: [], steps: [], canRequest: true });
  });

  it("keeps every view serializable and free of banned scoreboard words", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(view)).not.toMatch(/unsupported|send to a creator|% of/i);
  });
});

describeRecorded("the kit's storyboard", () => {
  const report = read("food-hot-sauce");
  const world = report.worlds[0];
  const frames = (status: WorldFrames["status"], revisionId: string | null = null, scenes: [number, 1 | 2][] = [[0, 1], [2, 1], [2, 2], [9, 1]]): WorldFrames => ({
    revisionId,
    status,
    reason: status === "paused" ? "Storyboards paused today." : null,
    frames: status === "done" ? scenes.map(([scene, attempt]) => ({ scene, url: `https://frames.example/${scene}-${attempt}.webp`, promptHash: hex("3"), modelId: "fal-ai/flux/schnell", attempt })) : [],
    critiques: [],
  });
  const withFrames = (f: WorldFrames | null): World => ({ ...world, frames: f });

  it("shows the newest attempt per scene of a finished job, with the job's decisions", () => {
    const trace = [...report.trace, { stage: "frames" as const, kind: "decision" as const, label: "Frame 3: product hidden", reason: "Before: x After: y", segmentId: world.segmentId }];
    const view = storyboardView({ trace }, withFrames(frames("done")), null);
    expect(view.status).toBe("done");
    expect(view.frames.map((f) => f.src)).toEqual(["https://frames.example/0-1.webp", "https://frames.example/2-2.webp"]);
    expect(view.frames[0].alt).toBe(`Storyboard frame for shot 1 (hook): ${world.pack!.concept.scenes[0].action}`);
    expect(view.steps).toEqual([{ label: "Frame 3: product hidden", reason: "Before: x After: y" }]);
    expect(view.canRequest).toBe(false);
  });

  it("follows a job: rendering cannot be asked again, paused and failed can", () => {
    expect(storyboardView(report, withFrames(frames("rendering")), null)).toMatchObject({ status: "rendering", canRequest: false });
    expect(storyboardView(report, withFrames(frames("paused")), null)).toMatchObject({ status: "paused", reason: "Storyboards paused today.", canRequest: true });
    expect(storyboardView(report, withFrames(frames("failed")), null)).toMatchObject({ status: "failed", canRequest: true });
    // Paused by the cap part way: the frames that did render still show, next to the plain note.
    const partly = { ...frames("done"), status: "paused" as const, reason: "Storyboards paused today." };
    expect(storyboardView(report, withFrames(partly), null)).toMatchObject({ status: "paused", reason: "Storyboards paused today.", canRequest: true });
    expect(storyboardView(report, withFrames(partly), null).frames).toHaveLength(2);
  });

  it("never shows frames next to a pack they did not come from", () => {
    const pack = structuredClone(world.pack!);
    pack.concept.title = "Revised concept";
    const revision: Revision = { id: "rev-0123456789ab", field: "music", reason: null, excluded: [], changes: [], brief: world.brief!, culture: world.culture!, richSlots: world.richSlots, concepts: world.concepts, pack, kit: world.kit, evidenceIds: [] };
    const revised: World = { ...world, revisions: [revision], frames: frames("done", null) };
    expect(storyboardView(report, revised, null)).toMatchObject({ status: "none", canRequest: true });
    expect(storyboardView(report, { ...revised, frames: frames("done", revision.id) }, null).status).toBe("done");
  });

  it("shows an example's approved frames, and asks for none", () => {
    const board: DemoStoryboard = {
      example: "food-hot-sauce",
      segmentId: world.segmentId,
      frames: [0, 1].map((scene) => ({ scene, attempt: 1 as const, file: `/demo/food-hot-sauce/frames/${scene}.webp`, promptHash: hex("2"), sha256: hex("b"), modelId: "fal-ai/nano-banana-2/edit" })),
      critiques: [],
    };
    const media: DemoMedia = { packshot: null, storyboards: { [world.segmentId]: board }, clips: [] };
    expect(storyboardView(report, world, media)).toMatchObject({ status: "done", frames: [{ src: "/demo/food-hot-sauce/frames/0.webp" }, { src: "/demo/food-hot-sauce/frames/1.webp" }], canRequest: false });
  });

  it("asks for nothing before the world has a concept", () => {
    expect(storyboardView(report, { ...world, concepts: null, pack: null, kit: null }, null)).toMatchObject({ status: "none", canRequest: false });
  });
});

describeRecorded("kit text layouts", () => {
  const report = read("food-hot-sauce");
  const { concept } = report.worlds[0].pack!;

  it("writes a runner-up concept as text, every shot with its time, and says it is not from Qloo", () => {
    const text = conceptText(concept);
    expect(text.split("\n")[0]).toBe(concept.title);
    expect(text).toContain(`Hook: ${concept.hook}`);
    expect(text).toMatch(/Shot 1 \(hook, 0 to \d+ s\)/);
    expect(text).toMatch(/to 15 s\): /);
    expect(text.match(/^Shot \d/gm)).toHaveLength(concept.scenes.length);
    expect(text).toMatch(/not from Qloo/);
  });

  it("reads WebVTT captions into timed lines, on-screen text apart from voice", () => {
    const lines = captionLines(report.worlds[0].kit!.captions!);
    expect(lines[0]).toEqual({ start: 0, end: 3, kind: "On screen", text: "It takes a moment to find you." });
    expect(lines.some((l) => l.kind === "Voice")).toBe(true);
    expect(captionLines("WEBVTT\n\n")).toEqual([]);
    // Cue text is WebVTT-escaped; the card shows the words as written.
    expect(captionLines("WEBVTT\n\nscene-1-text\n00:00:00.000 --> 00:00:03.000\nWhisker &amp; Brim &lt;3\n")[0].text).toBe("Whisker & Brim <3");
    expect(unescapeVtt("&amp;lt;")).toBe("&lt;");
  });

  it("fences prompts so nothing inside can close the fence", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("a ``` b ```` c")).toBe("`````");
    expect(fenced("x `y`")).toBe("```text\nx `y`\n```");
    for (const option of videoPrompts(report.worlds[0].pack!)) expect(option.fence).toBe(fenceFor(option.text));
  });

  it("names files safely", () => {
    expect(fileSlug("Porchlight Pepper Co.")).toBe("porchlight-pepper-co");
    expect(fileSlug("55 and older · rock and classic rock")).toBe("55-and-older-rock-and-classic-rock");
    expect(fileSlug("···")).toBe("stoop");
  });

  it("groups per-scene prompts by model, in scene order", () => {
    const options = videoPrompts(report.worlds[0].pack!);
    const veo = options.find((o) => o.id === "veo-3-1")!;
    expect(veo.text.indexOf("Scene 1 ·")).toBeLessThan(veo.text.indexOf("Scene 2 ·"));
    expect(veo.detail).toBe(`${getModel("veo-3-1").vendor} · ${concept.scenes.length} scene prompts, one per shot`);
  });
});
