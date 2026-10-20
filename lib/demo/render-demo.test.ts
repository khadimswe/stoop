// scripts/render-demo.ts's commands with fakes only (zero network): fal is a fake renderer that sends
// real image headers, Claude's review is the AI SDK mock, and the repository is a temp folder that links
// the real recorded reports. Covers the refusals (unapproved prompts and rewrites, no --yes, the
// per-invocation cap, approved files), dry runs that render nothing, writes that stay under
// public/demo/<slug>/ (plus the pending rewrites under exports/<slug>/), fal's bytes kept as they came
// with their sha256, the manifest staying valid, unsafe frames never landing, and a re-render that
// replaces exactly one scene.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { FrameRenderer, FrameRequest } from "../media/frames";
import { FRAME_MODELS } from "../prompts/models.config";
import { packHashes } from "../prompts/pack";
import { reportNames } from "../stages/after-run";
import { knownArtist } from "../stages/fixture-run";
import { packshotPlan, referenceId, selectBoards, storyboardPlan } from "./demo-renders";
import { approvalsSchema, manifestSchema, type DemoApprovals, type DemoManifest, type DemoPackshot } from "./manifest";
import {
  approveList,
  cappedRenderer,
  checkedImage,
  clipCommand,
  demoFile,
  DemoImageError,
  DemoRefusal,
  frameFalRenderer,
  imageFormatOf,
  packshotCommand,
  packshotFalRenderer,
  pendingFile,
  readPending,
  rerenderCommand,
  storyboardsCommand,
  type DemoDeps,
} from "./render-demo";
import { loadExampleReport, reportPacks } from "./report-packs";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const SLUG = "food-hot-sauce";
const report = ifRecorded(() => loadExampleReport(SLUG));
const names = ifRecorded(() => reportNames(report));
/** A real name the recorded run knows, read from the recording. */
const KNOWN = ifRecorded(() => knownArtist(report));
const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 120, text: 120, reasoning: undefined } };
const sha = (bytes: Uint8Array | Buffer) => createHash("sha256").update(bytes).digest("hex");
const YES = { dryRun: false, yes: true };

const JPEG = (tag: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
const WEBP = (tag: string) => new Uint8Array([...new TextEncoder().encode("RIFF0000WEBPVP8 "), ...new TextEncoder().encode(tag)]);
const PNG = (tag: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tag)]);

let root: string;
let lines: string[];

/** Every file under a folder, by path, with its hash. */
function hashTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(path.relative(dir, full), sha(readFileSync(full)));
    }
  };
  walk(dir);
  return files;
}
// The golden tests compare data/runs byte for byte: no command may touch it (the temp root links it).
const RUNS = path.join(process.cwd(), "data", "runs");
const runsBefore = ifRecorded(() => hashTree(RUNS));
afterEach(() => expect(hashTree(RUNS)).toEqual(runsBefore));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stoop-render-demo-"));
  mkdirSync(path.join(root, "data"), { recursive: true });
  symlinkSync(path.join(process.cwd(), "data", "runs"), path.join(root, "data", "runs"));
  mkdirSync(path.join(root, "public", "demo"), { recursive: true });
  writeManifest({ version: 2, clips: [], storyboards: [], packshots: [] });
  writeApprovals({});
  lines = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeManifest(manifest: DemoManifest) {
  writeFileSync(path.join(root, "public", "demo", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
function writeApprovals(over: Partial<DemoApprovals>) {
  writeFileSync(path.join(root, "public", "demo", "approvals.json"), `${JSON.stringify({ version: 2, prompts: [], files: [], heroClips: [], ...over }, null, 2)}\n`);
}
const approvals = () => approvalsSchema.parse(JSON.parse(approvalsText()));
const addApprovals = (over: Partial<Pick<DemoApprovals, "prompts" | "files">>) => {
  const now = approvals();
  writeApprovals({ ...now, prompts: [...now.prompts, ...(over.prompts ?? [])], files: [...now.files, ...(over.files ?? [])] });
};
const manifest = () => manifestSchema.parse(JSON.parse(readFileSync(path.join(root, "public", "demo", "manifest.json"), "utf8")));
const approvalsText = () => readFileSync(path.join(root, "public", "demo", "approvals.json"), "utf8");

/** Every file under the temp root (the linked reports excluded), by path, with its hash. */
function snapshot(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full);
      if (rel === path.join("data", "runs")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else files.set(rel, sha(readFileSync(full)));
    }
  };
  walk(root);
  return files;
}
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}
const onlyDemoWrites = (paths: string[]) =>
  paths.every((p) => p === path.join("public", "demo", "manifest.json") || p === path.join("exports", SLUG, "pending-rewrites.json") || p.startsWith(path.join("public", "demo", SLUG) + path.sep));

/** fal as a fake: the format each model is asked for (JPEG from FLUX [schnell], WebP from the edit model), different bytes every call. */
let sequence = 0;
function fakeRenderer(fails: (request: FrameRequest, index: number) => boolean = () => false): FrameRenderer & { calls: FrameRequest[]; outputs: Uint8Array[] } {
  const calls: FrameRequest[] = [];
  const outputs: Uint8Array[] = [];
  return {
    calls,
    outputs,
    render: async (request) => {
      calls.push(request);
      if (fails(request, calls.length - 1)) throw new Error("fal could not render the frame (HTTP 500).");
      const tag = `render ${++sequence}`;
      const image = request.model.role === "edit" ? { bytes: WEBP(tag), contentType: "image/webp" } : { bytes: JPEG(tag), contentType: "image/jpeg" };
      outputs.push(image.bytes);
      return image;
    },
  };
}

type Review = { frames: { shot: number; issues: string[]; rewrite: string | null; unsafe?: boolean }[] };
function critic(answer: (shots: number[]) => Review) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = JSON.stringify(options.prompt);
      const shots = [...text.matchAll(/Shot (\d+) \(/g)].map((m) => Number(m[1]));
      return { content: [{ type: "text" as const, text: JSON.stringify(answer(shots)) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}
const passing = () => critic((shots) => ({ frames: shots.map((shot) => ({ shot, issues: [], rewrite: null })) }));

function deps(over: Partial<DemoDeps> & { renderer?: FrameRenderer } = {}): DemoDeps {
  const renderer = over.renderer ?? fakeRenderer();
  return { root, renderers: { packshot: renderer, frame: renderer }, model: passing(), log: (line) => lines.push(line), ...over };
}

const controlPlan = (reference: DemoPackshot | null = null) => storyboardPlan(report, selectBoards(report, { control: true })[0], reference, names);

/** An approved packshot on disk and in the manifest. */
function approvedPackshot(): DemoPackshot {
  const bytes = JPEG("packshot");
  mkdirSync(path.join(root, "public", "demo", SLUG), { recursive: true });
  writeFileSync(path.join(root, "public", "demo", SLUG, "packshot.jpg"), bytes);
  const packshot: DemoPackshot = { example: SLUG, file: "/demo/food-hot-sauce/packshot.jpg", promptHash: packshotPlan(report).promptHash, sha256: sha(bytes), modelId: FRAME_MODELS.text.endpoint };
  writeManifest({ ...manifest(), packshots: [packshot] });
  addApprovals({ prompts: [packshot.promptHash], files: [packshot.sha256] });
  return packshot;
}

describeRecorded("images from fal", () => {
  it("are kept byte for byte only when they are the requested type under the cap", () => {
    expect(imageFormatOf(JPEG("x"))).toBe("jpeg");
    expect(imageFormatOf(WEBP("x"))).toBe("webp");
    expect(imageFormatOf(PNG("x"))).toBe("png");
    expect(imageFormatOf(new TextEncoder().encode("<html>"))).toBeNull();
    const jpeg = JPEG("frame");
    expect(checkedImage({ bytes: jpeg, contentType: "image/jpeg" }, "jpeg")).toBe(jpeg);
    expect(() => checkedImage({ bytes: PNG("x"), contentType: "image/png" }, "jpeg")).toThrow(DemoImageError);
    expect(() => checkedImage({ bytes: PNG("x"), contentType: "image/jpeg" }, "jpeg")).toThrow(/not an image|png by its bytes/);
    expect(() => checkedImage({ bytes: new Uint8Array(0), contentType: "image/jpeg" }, "jpeg")).toThrow(DemoImageError);
    expect(() => checkedImage({ bytes: new Uint8Array(11 * 1024 * 1024).fill(0xff), contentType: "image/jpeg" }, "jpeg")).toThrow(/bytes/);
  });

  it("are asked for in compact formats: JPEG at the square preset for the packshot, WebP from the edit model", async () => {
    const inputs: { endpoint: string; input: Record<string, unknown> }[] = [];
    const client = {
      subscribe: async (endpoint: string, run: { input: Record<string, unknown> }) => {
        inputs.push({ endpoint, input: run.input });
        return { data: { images: [{ url: "https://v3.fal.media/files/out" }] }, requestId: "r1" };
      },
    };
    const fetch = (async () => new Response(JPEG("x"), { headers: { "content-type": "image/jpeg" } })) as typeof globalThis.fetch;
    const plan = packshotPlan(report);
    await packshotFalRenderer({ credentials: "test", client: client as never, fetch }).render({ model: FRAME_MODELS.text, prompt: plan.prompt, referenceUrls: [] });
    await frameFalRenderer({ credentials: "test", client: client as never, fetch }).render({ model: FRAME_MODELS.edit, prompt: "p", referenceUrls: ["data:image/jpeg;base64,AA=="] });
    await frameFalRenderer({ credentials: "test", client: client as never, fetch }).render({ model: FRAME_MODELS.text, prompt: "p", referenceUrls: [] });
    expect(inputs.map((i) => [i.endpoint, i.input.output_format, i.input.image_size])).toEqual([
      // Under a million pixels, so it bills as one megapixel however fal counts one.
      ["fal-ai/flux/schnell", "jpeg", { width: 992, height: 992 }],
      ["fal-ai/nano-banana-2/edit", "webp", undefined],
      ["fal-ai/flux/schnell", "jpeg", "portrait_16_9"],
    ]);
    expect(inputs[0].input.prompt).toBe(plan.prompt);
  });
});

describeRecorded("packshot", () => {
  const plan = packshotPlan(report);

  it("prints the prompt, hash, model and cost on a dry run and renders nothing", async () => {
    const renderer = fakeRenderer();
    const before = snapshot();
    const result = await packshotCommand(deps({ renderer }), SLUG, { dryRun: true, yes: true });
    expect(result.status).toBe("dry-run");
    expect(renderer.calls).toHaveLength(0);
    expect(changed(before, snapshot())).toEqual([]);
    const out = lines.join("\n");
    expect(out).toContain(plan.promptHash);
    expect(out).toContain(plan.prompt);
    expect(out).toContain(FRAME_MODELS.text.endpoint);
    expect(out).toContain("estimated cost: $0.003");
  });

  it("refuses an unapproved prompt even with --yes, and anything without --yes", async () => {
    const renderer = fakeRenderer();
    await expect(packshotCommand(deps({ renderer }), SLUG, YES)).rejects.toThrow(/not approved/);
    writeApprovals({ prompts: [plan.promptHash] });
    await expect(packshotCommand(deps({ renderer }), SLUG, { dryRun: false, yes: false })).rejects.toThrow(/add --yes/);
    await expect(packshotCommand(deps({ renderer, maxImages: 0 }), SLUG, YES)).rejects.toThrow(DemoRefusal);
    expect(renderer.calls).toHaveLength(0);
  });

  it("writes fal's JPEG unmodified with its sha256, and needs --replace once the file is approved", async () => {
    writeApprovals({ prompts: [plan.promptHash] });
    const renderer = fakeRenderer();
    const before = snapshot();
    await packshotCommand(deps({ renderer }), SLUG, YES);
    expect(renderer.calls).toEqual([{ model: FRAME_MODELS.text, prompt: plan.prompt, referenceUrls: [] }]);
    expect(changed(before, snapshot())).toEqual([path.join("public", "demo", "food-hot-sauce", "packshot.jpg"), path.join("public", "demo", "manifest.json")].sort());
    const [entry] = manifest().packshots;
    const written = readFileSync(path.join(root, "public", entry.file));
    expect(new Uint8Array(written)).toEqual(renderer.outputs[0]);
    expect(entry).toEqual({ example: SLUG, file: "/demo/food-hot-sauce/packshot.jpg", promptHash: plan.promptHash, sha256: sha(written), modelId: FRAME_MODELS.text.endpoint });
    expect(approvals().files).toEqual([]);
    addApprovals({ files: [entry.sha256] });
    await expect(packshotCommand(deps({ renderer }), SLUG, YES)).rejects.toThrow(/--replace/);
    expect(renderer.calls).toHaveLength(1);
    await packshotCommand(deps({ renderer }), SLUG, { ...YES, replace: true });
    expect(renderer.calls).toHaveLength(2);
    expect(manifest().packshots).toHaveLength(1);
  });

  it("writes nothing when fal sends another type than asked for", async () => {
    writeApprovals({ prompts: [plan.promptHash] });
    const renderer: FrameRenderer = { render: async () => ({ bytes: PNG("x"), contentType: "image/png" }) };
    const before = snapshot();
    await expect(packshotCommand(deps({ renderer }), SLUG, YES)).rejects.toThrow(DemoImageError);
    expect(changed(before, snapshot())).toEqual([]);
  });
});

describeRecorded("storyboards", () => {
  const control = controlPlan();
  const approveControl = () => addApprovals({ prompts: control.frames.map((f) => f.promptHash) });
  const boardFiles = () => readdirSync(path.join(root, "public", "demo", SLUG, "frames")).sort();

  it("prints every frame prompt and the cost of both steps on a dry run, calling neither fal nor Claude", async () => {
    const renderer = fakeRenderer();
    const model = passing();
    const before = snapshot();
    await storyboardsCommand(deps({ renderer, model }), SLUG, {}, { dryRun: true, yes: true });
    expect(renderer.calls).toHaveLength(0);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(changed(before, snapshot())).toEqual([]);
    const out = lines.join("\n");
    for (const entry of reportPacks(report)) {
      for (const frame of storyboardPlan(report, entry, null, names).frames) expect(out).toContain(frame.promptHash);
    }
    expect(out).toMatch(/3 storyboards, 12 images now/);
    expect(out).toMatch(/approved rewrites \(--rerender\); both steps at most/);
  });

  it("refuses unapproved frame prompts, a missing --yes and more images than the cap, before any render", async () => {
    const renderer = fakeRenderer();
    await expect(storyboardsCommand(deps({ renderer }), SLUG, { control: true }, YES)).rejects.toThrow(/not approved/);
    approveControl();
    await expect(storyboardsCommand(deps({ renderer }), SLUG, { control: true }, { dryRun: false, yes: false })).rejects.toThrow(/add --yes/);
    await expect(storyboardsCommand(deps({ renderer, maxImages: 3 }), SLUG, { control: true }, YES)).rejects.toThrow(/at most 3/);
    // Approving one board does not approve the others.
    await expect(storyboardsCommand(deps({ renderer }), SLUG, {}, YES)).rejects.toThrow(/not approved/);
    await expect(storyboardsCommand(deps({ renderer }), SLUG, { segment: "seg-nope" }, { dryRun: true, yes: false })).rejects.toThrow(/no world "seg-nope"/);
    expect(renderer.calls).toHaveLength(0);
  });

  it("renders approved prompts text only and records each JPEG as fal sent it", async () => {
    approveControl();
    const renderer = fakeRenderer();
    const before = snapshot();
    await storyboardsCommand(deps({ renderer }), SLUG, { control: true }, YES);
    expect(renderer.calls).toHaveLength(4);
    expect(renderer.calls.every((c) => c.model.endpoint === FRAME_MODELS.text.endpoint && c.referenceUrls.length === 0)).toBe(true);
    expect(renderer.calls.map((c) => c.prompt)).toEqual(control.frames.map((f) => f.prompt));
    expect(onlyDemoWrites(changed(before, snapshot()))).toBe(true);
    const [board] = manifest().storyboards;
    expect(board.segmentId).toBeNull();
    expect(board.frames.map((f) => f.promptHash)).toEqual(control.frames.map((f) => f.promptHash));
    for (const frame of board.frames) {
      expect(frame.file).toMatch(/^\/demo\/food-hot-sauce\/frames\/control-shot-\d\.jpg$/);
      const bytes = readFileSync(path.join(root, "public", frame.file));
      expect(imageFormatOf(new Uint8Array(bytes))).toBe("jpeg");
      expect(frame.sha256).toBe(sha(bytes));
      expect(frame.attempt).toBe(1);
    }
    // The founder still approves the files by hand; approvals.json is never written.
    const out = (await approveList({ root }, SLUG)).join("\n");
    for (const frame of board.frames) expect(out).toContain(frame.sha256);
    expect(approvals().files).toEqual([]);
  });

  it("with an approved packshot, references that exact file on the edit model as WebP, and refuses one that changed", async () => {
    const packshot = approvedPackshot();
    const withRef = controlPlan(packshot);
    expect(withRef.frames.every((f) => f.model.endpoint === FRAME_MODELS.edit.endpoint && f.referenceIds[0] === referenceId(packshot))).toBe(true);
    expect(withRef.frames.map((f) => f.promptHash)).not.toEqual(control.frames.map((f) => f.promptHash));
    addApprovals({ prompts: withRef.frames.map((f) => f.promptHash) });
    const renderer = fakeRenderer();
    await storyboardsCommand(deps({ renderer }), SLUG, { control: true }, YES);
    expect(renderer.calls).toHaveLength(4);
    const uri = `data:image/jpeg;base64,${Buffer.from(JPEG("packshot")).toString("base64")}`;
    expect(renderer.calls.every((c) => c.model.endpoint === FRAME_MODELS.edit.endpoint && c.referenceUrls[0] === uri)).toBe(true);
    expect(renderer.calls[0].prompt).toContain("Use the reference photo as the exact small-batch hot sauce");
    expect(manifest().storyboards[0].frames.every((f) => f.file.endsWith(".webp"))).toBe(true);
    // The approved file changed on disk: nothing renders.
    writeFileSync(path.join(root, "public", "demo", SLUG, "packshot.jpg"), "something else");
    const again = fakeRenderer();
    await expect(storyboardsCommand(deps({ renderer: again, model: passing() }), SLUG, { control: true }, { ...YES, replace: true })).rejects.toThrow(/changed since it was approved/);
    expect(again.calls).toHaveLength(0);
  });

  it("never lands a frame Claude marks unsafe, and only records rewrites: none renders until approved", async () => {
    approveControl();
    const renderer = fakeRenderer();
    const model = critic(() => ({
      frames: [
        { shot: 1, issues: ["the person at the counter may be under 18"], rewrite: "A butcher block counter at late morning, the bottle upright in the foreground, an adult hand beside it.", unsafe: true },
        { shot: 2, issues: ["a beer brand's logo on the cooler"], rewrite: `The scene styled like ${KNOWN} on stage.`, unsafe: true },
        { shot: 3, issues: ["product hidden behind the hand"], rewrite: "The bottle upright on the butcher block counter, sharp and centered, a plate of fried eggs beside it." },
        { shot: 4, issues: [], rewrite: null },
      ],
    }));
    await storyboardsCommand(deps({ renderer, model }), SLUG, { control: true }, YES);
    // The first pass renders the 4 approved prompts and nothing else.
    expect(renderer.calls).toHaveLength(4);
    const [board] = manifest().storyboards;
    expect(board.frames.map((f) => [f.scene, f.attempt])).toEqual([
      [2, 1],
      [3, 1],
    ]);
    expect(boardFiles()).toEqual(["control-shot-3.jpg", "control-shot-4.jpg"]);
    expect(board.critiques.every((c) => c.rewrite === null)).toBe(true);
    // Shot 1's rewrite and shot 3's are pending; shot 2's names a real artist and was refused.
    const pending = await readPending(root, SLUG);
    expect(pending.map((p) => [p.scene, p.replaces === null])).toEqual([
      [0, true],
      [2, false],
    ]);
    expect(JSON.parse(readFileSync(pendingFile(root, SLUG), "utf8")).status).toBe("Status: not approved");
    const out = (await approveList({ root }, SLUG)).join("\n");
    for (const p of pending) expect(out).toContain(`"${p.promptHash}",`);
    // Rewrites are listed in their own block, after the manifest's, with their prompts to read.
    const [manifestPart, rewritePart] = out.split("Pending critique rewrites");
    expect(rewritePart).toBeDefined();
    for (const p of pending) {
      expect(manifestPart).not.toContain(p.promptHash);
      expect(rewritePart).toContain(p.prompt.replace(/\n+/g, " "));
    }
    // Unapproved rewrites never render.
    const rerenderer = fakeRenderer();
    await expect(rerenderCommand(deps({ renderer: rerenderer }), SLUG, { control: true }, YES)).rejects.toThrow(/No approved rewrite/);
    expect(rerenderer.calls).toHaveLength(0);
    // Once approved, shot 1's rewrite brings the scene back as attempt 2.
    addApprovals({ prompts: [pending[0].promptHash] });
    await rerenderCommand(deps({ renderer: rerenderer }), SLUG, { control: true }, YES);
    expect(rerenderer.calls.map((c) => c.prompt)).toEqual([pending[0].prompt]);
    expect(manifest().storyboards[0].frames.map((f) => [f.scene, f.attempt])).toEqual([
      [0, 2],
      [2, 1],
      [3, 1],
    ]);
    expect((await readPending(root, SLUG)).map((p) => p.scene)).toEqual([2]);
  });

  it("re-renders exactly the approved scene and leaves the others as they were", async () => {
    approveControl();
    const model = critic(() => ({
      frames: [
        { shot: 1, issues: [], rewrite: null },
        { shot: 2, issues: ["setting reads generic"], rewrite: "The bottle on a sunny dining table by the window, a taco on a plate beside it, sharp and centered." },
        { shot: 3, issues: ["product hidden behind the hand"], rewrite: "The bottle upright on the butcher block counter, sharp and centered, a plate of fried eggs beside it." },
        { shot: 4, issues: [], rewrite: null },
      ],
    }));
    await storyboardsCommand(deps({ model }), SLUG, { control: true }, YES);
    const before = manifest().storyboards[0];
    const pending = await readPending(root, SLUG);
    expect(pending.map((p) => p.scene)).toEqual([1, 2]);
    addApprovals({ prompts: [pending[1].promptHash] });
    const renderer = fakeRenderer();
    const files = snapshot();
    await rerenderCommand(deps({ renderer }), SLUG, { control: true }, { dryRun: true, yes: true });
    expect(renderer.calls).toHaveLength(0);
    await rerenderCommand(deps({ renderer }), SLUG, { control: true }, YES);
    expect(renderer.calls).toHaveLength(1);
    const after = manifest().storyboards[0];
    expect(after.frames.filter((f) => f.attempt === 2).map((f) => f.scene)).toEqual([2]);
    expect(after.frames.filter((f) => f.scene !== 2)).toEqual(before.frames.filter((f) => f.scene !== 2));
    expect(after.frames.find((f) => f.scene === 2)!.promptHash).toBe(pending[1].promptHash);
    expect(after.critiques.find((c) => c.scene === 2)!.rewrite).toBe(pending[1].body);
    expect(after.critiques.find((c) => c.scene === 1)!.rewrite).toBeNull();
    const written = changed(files, snapshot());
    expect(onlyDemoWrites(written)).toBe(true);
    expect(written).toContain(path.join("public", "demo", SLUG, "frames", "control-shot-3.jpg"));
    expect(written.filter((p) => p.includes("control-shot-") && !p.endsWith("control-shot-3.jpg"))).toEqual([]);
    // The same rewrite never renders twice, and a tampered pending prompt never renders at all.
    await expect(rerenderCommand(deps({ renderer }), SLUG, { control: true }, YES)).rejects.toThrow(/No approved rewrite/);
    const file = JSON.parse(readFileSync(pendingFile(root, SLUG), "utf8"));
    file.rewrites[0].body = `${file.rewrites[0].body} With a second bottle.`;
    writeFileSync(pendingFile(root, SLUG), JSON.stringify(file));
    addApprovals({ prompts: [pending[0].promptHash] });
    await expect(rerenderCommand(deps({ renderer }), SLUG, { control: true }, YES)).rejects.toThrow(/No approved rewrite/);
    expect(renderer.calls).toHaveLength(1);
  });

  it("on a second pass, replaces only scenes with a new safe frame and drops a reviewed scene's stale rewrite", async () => {
    approveControl();
    const flagShot3 = critic(() => ({
      frames: [
        ...[1, 2, 4].map((shot) => ({ shot, issues: [] as string[], rewrite: null })),
        { shot: 3, issues: ["product hidden"], rewrite: "The bottle upright on the counter, sharp and centered." },
      ],
    }));
    await storyboardsCommand(deps({ model: flagShot3 }), SLUG, { control: true }, YES);
    const first = manifest().storyboards[0];
    expect(boardFiles()).toHaveLength(4);
    expect(await readPending(root, SLUG)).toHaveLength(1);
    const dropFirst = critic(() => ({ frames: [{ shot: 1, issues: ["a minor in frame"], rewrite: null, unsafe: true }, ...[2, 3, 4].map((shot) => ({ shot, issues: [] as string[], rewrite: null }))] }));
    await storyboardsCommand(deps({ model: dropFirst }), SLUG, { control: true }, YES);
    const second = manifest().storyboards[0];
    // The new shot 1 was unsafe and never written: the earlier shot 1 stays, the other three are new.
    expect(second.frames[0]).toEqual(first.frames[0]);
    expect(second.frames.slice(1).map((f) => f.sha256)).not.toEqual(first.frames.slice(1).map((f) => f.sha256));
    expect(boardFiles()).toEqual(["control-shot-1.jpg", "control-shot-2.jpg", "control-shot-3.jpg", "control-shot-4.jpg"]);
    expect(sha(readFileSync(path.join(root, "public", first.frames[0].file)))).toBe(first.frames[0].sha256);
    expect(await readPending(root, SLUG)).toEqual([]);
  });

  it("leaves a rewrite pending when fal fails it, and needs --replace to re-render over an approved frame", async () => {
    approveControl();
    const model = critic(() => ({
      frames: [
        { shot: 1, issues: ["setting reads generic"], rewrite: "The bottle on a sunny dining table by the window, a taco on a plate beside it, sharp and centered." },
        ...[2, 3, 4].map((shot) => ({ shot, issues: [] as string[], rewrite: null })),
      ],
    }));
    await storyboardsCommand(deps({ model }), SLUG, { control: true }, YES);
    const [rewrite] = await readPending(root, SLUG);
    addApprovals({ prompts: [rewrite.promptHash] });
    const failing = fakeRenderer(() => true);
    await rerenderCommand(deps({ renderer: failing }), SLUG, { control: true }, YES);
    expect(failing.calls).toHaveLength(1);
    expect(await readPending(root, SLUG)).toEqual([rewrite]);
    expect(manifest().storyboards[0].frames[0].attempt).toBe(1);
    expect(lines.join("\n")).toMatch(/stays pending/);
    // Once the founder approves the frame the rewrite would replace, only --replace renders over it.
    addApprovals({ files: [manifest().storyboards[0].frames[0].sha256] });
    const renderer = fakeRenderer();
    await expect(rerenderCommand(deps({ renderer }), SLUG, { control: true }, YES)).rejects.toThrow(/--replace/);
    expect(renderer.calls).toHaveLength(0);
    await rerenderCommand(deps({ renderer }), SLUG, { control: true }, { ...YES, replace: true });
    expect(renderer.calls).toHaveLength(1);
    expect(manifest().storyboards[0].frames[0].attempt).toBe(2);
    expect(await readPending(root, SLUG)).toEqual([]);
  });

  it("keeps the approved frames of scenes fal did not render, even with --replace", async () => {
    approveControl();
    await storyboardsCommand(deps(), SLUG, { control: true }, YES);
    const first = manifest().storyboards[0];
    addApprovals({ files: first.frames.map((f) => f.sha256) });
    await expect(storyboardsCommand(deps(), SLUG, { control: true }, YES)).rejects.toThrow(/--replace/);
    // fal fails shot 2 on the second pass.
    const flaky = fakeRenderer((request) => request.prompt === control.frames[1].prompt);
    await storyboardsCommand(deps({ renderer: flaky }), SLUG, { control: true }, { ...YES, replace: true });
    const second = manifest().storyboards[0];
    expect(second.frames.find((f) => f.scene === 1)).toEqual(first.frames.find((f) => f.scene === 1));
    expect(sha(readFileSync(path.join(root, "public", first.frames[1].file)))).toBe(first.frames[1].sha256);
    expect(second.frames.filter((f) => f.scene !== 1).every((f) => !first.frames.some((o) => o.sha256 === f.sha256))).toBe(true);
    expect(lines.join("\n")).toMatch(/shot 2: did not render/);
  });

  it("saves nothing when no frame comes back", async () => {
    approveControl();
    const before = snapshot();
    await storyboardsCommand(deps({ renderer: fakeRenderer(() => true) }), SLUG, { control: true }, YES);
    expect(changed(before, snapshot())).toEqual([]);
    expect(lines.join("\n")).toMatch(/no frame came back/);
  });

  it("saves nothing as reviewed when Claude's review fails, and leaves out a frame the review skipped", async () => {
    approveControl();
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("overloaded");
      },
    });
    const before = snapshot();
    await storyboardsCommand(deps({ model: broken }), SLUG, { control: true }, YES);
    expect(changed(before, snapshot())).toEqual([]);
    expect(lines.join("\n")).toMatch(/review failed .*nothing is saved/);
    // A review that answers for 3 of the 4 frames: the fourth is not saved.
    const partial = critic(() => ({ frames: [1, 2, 3].map((shot) => ({ shot, issues: [] as string[], rewrite: null })) }));
    await storyboardsCommand(deps({ model: partial }), SLUG, { control: true }, YES);
    expect(manifest().storyboards[0].frames.map((f) => f.scene)).toEqual([0, 1, 2]);
    expect(lines.join("\n")).toMatch(/shot 4: Claude's review left it out/);
  });

  it("keeps one model and reference across an example's storyboards: a board left as it is must match", async () => {
    approveControl();
    await storyboardsCommand(deps(), SLUG, { control: true }, YES);
    // The packshot is approved after the Control rendered text only: the worlds would render on the edit model.
    const packshot = approvedPackshot();
    const world = storyboardPlan(report, selectBoards(report, { segment: "seg-55-and-older" })[0], packshot, names);
    addApprovals({ prompts: world.frames.map((f) => f.promptHash) });
    const renderer = fakeRenderer();
    await expect(storyboardsCommand(deps({ renderer }), SLUG, { segment: "seg-55-and-older" }, YES)).rejects.toThrow(/control storyboard\(s\) were rendered with another model or packshot/);
    expect(renderer.calls).toHaveLength(0);
  });

  it("counts every image against the invocation's cap", async () => {
    const inner = fakeRenderer();
    const budget = { used: 0, max: 2 };
    const capped = cappedRenderer(inner, budget);
    const request = { model: FRAME_MODELS.text, prompt: "p", referenceUrls: [] };
    await capped.render(request);
    await capped.render(request);
    await expect(capped.render(request)).rejects.toThrow(/cap of 2 images/);
    expect(inner.calls).toHaveLength(2);
  });
});

describeRecorded("clip", () => {
  const world = reportPacks(report).find((p) => p.segmentId === "seg-55-and-older")!;
  const render = world.pack.renders[0];
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32, 1)]);
  const clipFile = () => {
    const file = path.join(root, "take-3.mp4");
    writeFileSync(file, mp4);
    return file;
  };

  it("refuses an unapproved prompt hash, a hash from another pack and a Control clip with a segment", async () => {
    const file = clipFile();
    const base = { file, example: SLUG, role: "hero-culture", segment: world.segmentId, promptHash: render.promptHash, dryRun: false };
    await expect(clipCommand(deps(), base)).rejects.toThrow(/not approved/);
    writeApprovals({ prompts: [render.promptHash, ...packHashes(reportPacks(report)[0].pack).map((h) => h.promptHash)] });
    await expect(clipCommand(deps(), { ...base, segment: "seg-35-to-44" })).rejects.toThrow(/not a render prompt/);
    await expect(clipCommand(deps(), { ...base, role: "control" })).rejects.toThrow(/has no segment/);
    await expect(clipCommand(deps(), { ...base, role: "hero-control", segment: null, promptHash: reportPacks(report)[0].pack.assets[0].promptHash })).rejects.toThrow(/not a render prompt/);
    writeFileSync(file, "not a video");
    await expect(clipCommand(deps(), base)).rejects.toThrow(/not an .mp4 or .webm/);
    expect(manifest().clips).toEqual([]);
  });

  it("copies an approved clip, its poster and captions as they are, and lists the file and the hero entry for approval", async () => {
    writeApprovals({ prompts: [render.promptHash] });
    const poster = path.join(root, "poster.png");
    writeFileSync(poster, PNG("poster"));
    const captions = path.join(root, "captions.vtt");
    // WebVTT with a UTF-8 byte order mark, copied byte for byte.
    const vtt = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(world.kit!.captions!)]);
    writeFileSync(captions, vtt);
    const file = clipFile();
    const before = snapshot();
    const args = { file, example: SLUG, role: "hero-culture", segment: world.segmentId, promptHash: render.promptHash, poster, captions, dryRun: true };
    await clipCommand(deps(), args);
    expect(changed(before, snapshot())).toEqual([]);
    await clipCommand(deps(), { ...args, dryRun: false });
    expect(onlyDemoWrites(changed(before, snapshot()))).toBe(true);
    const [clip] = manifest().clips;
    expect(clip).toMatchObject({ id: "food-hot-sauce-hero-culture-seg-55-and-older", role: "hero-culture", segmentId: world.segmentId, file: "/demo/food-hot-sauce/hero-culture-seg-55-and-older.mp4", poster: "/demo/food-hot-sauce/hero-culture-seg-55-and-older.poster.png", captions: "/demo/food-hot-sauce/hero-culture-seg-55-and-older.vtt", promptHash: render.promptHash });
    expect(clip.sha256).toBe(sha(mp4));
    expect(readFileSync(path.join(root, "public", clip.file))).toEqual(mp4);
    expect(new Uint8Array(readFileSync(path.join(root, "public", clip.poster!)))).toEqual(PNG("poster"));
    expect(readFileSync(path.join(root, "public", clip.captions!))).toEqual(vtt);
    const out = (await approveList({ root }, SLUG)).join("\n");
    expect(out).toContain(`"${clip.sha256}",`);
    expect(out).toContain(JSON.stringify({ id: clip.id, promptHash: clip.promptHash, sha256: clip.sha256 }));
    // An approved clip file is not replaced without --replace.
    addApprovals({ files: [clip.sha256] });
    await expect(clipCommand(deps(), { ...args, dryRun: false })).rejects.toThrow(/--replace/);
  });
});

describeRecorded("demo paths", () => {
  it("resolve only under public/demo/<slug>/", () => {
    expect(demoFile(root, SLUG, "/demo/food-hot-sauce/frames/control-shot-1.jpg")).toBe(path.join(root, "public", "demo", SLUG, "frames", "control-shot-1.jpg"));
    for (const served of ["/demo/home-candles/packshot.jpg", "/demo/food-hot-sauce/../home-candles/packshot.jpg", "/demo/manifest.json", "/elsewhere/food-hot-sauce/a.jpg"]) {
      expect(() => demoFile(root, SLUG, served), served).toThrow(DemoRefusal);
    }
  });
});

describeRecorded("approve-list", () => {
  it("lists what is unapproved and never writes approvals.json", async () => {
    const before = approvalsText();
    expect(await approveList({ root }, SLUG)).toEqual(["food-hot-sauce: everything in the manifest is approved."]);
    const packshot = { example: SLUG, file: "/demo/food-hot-sauce/packshot.jpg", promptHash: "a".repeat(64), sha256: "b".repeat(64), modelId: "fal-ai/flux/schnell" } as const;
    writeManifest({ version: 2, clips: [], storyboards: [], packshots: [packshot] });
    const out = (await approveList({ root }, SLUG)).join("\n");
    expect(out).toContain(`"${"a".repeat(64)}",`);
    expect(out).toContain(`"${"b".repeat(64)}",`);
    expect(await approveList({ root }, "home-candles")).toEqual(["home-candles: everything in the manifest is approved."]);
    expect(approvalsText()).toBe(before);
    await expect(approveList({ root }, "coffee")).rejects.toThrow(/not an example/);
  });
});
