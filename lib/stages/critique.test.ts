// The frame critique with the AI SDK mock as Claude, on the hot sauce example's 55 and older world:
// the frames go to the model as image file parts, issues are trimmed and capped, and every rewrite
// passes the guardrails (names, likenesses, logos, children, seller facts) before it may re-render.
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { reportNames } from "./after-run";
import { critiqueFrames, frameChecklist, guardRewrite, MAX_ISSUES, MAX_REWRITES, mentionsLogo, readCritique, type CritiqueInput } from "./critique";
import { exampleReport, knownArtist } from "./fixture-run";
import { describeRecorded, ifRecorded, itRecorded } from "../testing/recorded";

const report = ifRecorded(() => exampleReport());
const world = ifRecorded(() => report.worlds.find((w) => w.segmentId === "seg-55-and-older")!);
const pack = ifRecorded(() => world.pack!);
const brief = ifRecorded(() => world.brief!);
const product = ifRecorded(() => report.inputs.product);
const names = ifRecorded(() => reportNames(report));
/** A real name the recorded run knows, read from the recording. */
const KNOWN = ifRecorded(() => knownArtist(report));
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
const IMAGE_URLS = { "image/*": [/^https:\/\/.*$/] };

const input = (scenes: number[] = [0, 1, 3, 4]): CritiqueInput => ({
  frames: scenes.map((scene) => ({ scene, url: `https://frames.test/frames/${scene}.png`, body: `Shot ${scene + 1} body.` })),
  concept: pack.concept,
  brief,
  product,
  checklist: frameChecklist(pack, product),
  names,
});
const ctx = ifRecorded(() => ({ names, brief, product }));

function answering(output: unknown) {
  return new MockLanguageModelV4({
    supportedUrls: IMAGE_URLS,
    doGenerate: async () => ({ content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] }),
  });
}

describeRecorded("the frame checklist", () => {
  it("keeps only what a still can show, with the talent items for a cast with people", () => {
    const items = frameChecklist(pack, product).map((i) => i.id);
    expect(items).toContain("product-hero");
    expect(items).toContain("adults-only");
    expect(items).not.toContain("hook");
    expect(items).not.toContain("continuity");
    expect(frameChecklist({ cast: "product_only" }, product).map((i) => i.id)).not.toContain("adults-only");
  });
});

describeRecorded("critiqueFrames", () => {
  it("sends every frame as an image file part with its shot number and description as data", async () => {
    const model = answering({ frames: [] });
    await critiqueFrames(model, input());
    const [message] = model.doGenerateCalls[0].prompt.filter((m) => m.role === "user");
    const parts = message.content as { type: string; mediaType?: string; data?: unknown; text?: string }[];
    const files = parts.filter((p) => p.type === "file");
    expect(files).toHaveLength(4);
    expect(files.every((f) => f.mediaType?.startsWith("image"))).toBe(true);
    // The SDK passes a URL on as a tagged url part, which Anthropic fetches itself.
    expect(files.map((f) => String((f.data as { url?: URL }).url ?? f.data))).toEqual([0, 1, 3, 4].map((s) => `https://frames.test/frames/${s}.png`));
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    expect(text).toContain("Shot 4 (");
    expect(text).toContain('<data label="frame description">');
    expect(text).toContain("[blocking] The product is clearly visible and is the hero.");
  });

  it("reads Claude's review: known shots only, trimmed issues, a rewrite only for a frame with issues", async () => {
    const result = await critiqueFrames(
      answering({
        frames: [
          { shot: 1, issues: [" product hidden behind the hand. ", "product hidden behind the hand", "setting reads generic"], rewrite: "The bottle upright on a weathered porch rail at dusk, sharp and centered." },
          { shot: 2, issues: [], rewrite: "This should not be kept." },
          { shot: 9, issues: ["not a frame we sent"], rewrite: "ignored" },
        ],
      }),
      input(),
    );
    expect(result.failure).toBeNull();
    expect(result.critiques).toEqual([
      { scene: 0, issues: ["product hidden behind the hand", "setting reads generic"], rewrite: "The bottle upright on a weathered porch rail at dusk, sharp and centered." },
      { scene: 1, issues: [], rewrite: null },
    ]);
  });

  it("drops issue wording that names a real person or describes someone by ethnicity, and keeps an under-18 flag", () => {
    const raw = { frames: [{ shot: 1, issues: ["an Asian man at the counter", `looks like ${KNOWN}`, "the person looks like a teen", "product hidden"], rewrite: null }] };
    expect(readCritique(raw, input()).critiques[0].issues).toEqual(["the person looks like a teen", "product hidden"]);
  });

  it("caps issues at 6 and rewrites at 4 per world", () => {
    const frames = [0, 1, 2, 3, 4];
    const raw = { frames: frames.map((s) => ({ shot: s + 1, issues: Array.from({ length: 9 }, (_, i) => `issue ${i + 1}`), rewrite: `Shot ${s + 1}: the bottle upright on a porch rail at dusk.` })) };
    const { critiques, refused } = readCritique(raw, input(frames));
    expect(critiques.every((c) => c.issues.length === MAX_ISSUES)).toBe(true);
    expect(critiques.filter((c) => c.rewrite !== null)).toHaveLength(MAX_REWRITES);
    expect(refused).toEqual([{ scene: 4, reason: `only ${MAX_REWRITES} frames re-render per world` }]);
  });

  it("answers a malformed review with a failure line instead of throwing", async () => {
    const result = await critiqueFrames(answering("not json"), input());
    expect(result).toMatchObject({ critiques: [], failure: "the review was not valid JSON for the schema" });
  });

  it("never calls Claude without frames", async () => {
    const model = answering({ frames: [] });
    expect(await critiqueFrames(model, input([]))).toEqual({ critiques: [], refused: [], unsafe: [], failure: null });
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("guardRewrite", () => {
  itRecorded("passes a clean rewrite, tidied", () => {
    expect(guardRewrite("  A porch rail at dusk,   the bottle sharp and centered.  ", ctx)).toEqual({ ok: true, text: "A porch rail at dusk, the bottle sharp and centered." });
  });

  itRecorded("keeps the setting city, which the brief allows", () => {
    const city = brief.allowedPlaces[0];
    expect(city).toBeTruthy();
    expect(guardRewrite(`A porch in ${city} at dusk, the bottle on the rail.`, ctx).ok).toBe(true);
  });

  itRecorded("refuses real names, likenesses, logos, children, school settings and invented product facts", () => {
    const refused = (text: string) => {
      const result = guardRewrite(text, ctx);
      return result.ok ? null : result.reason;
    };
    expect(refused(`A stage like ${KNOWN} at dusk.`)).toContain("is a real name");
    expect(refused("A man who looks like a famous celebrity holds the bottle.")).toBeTruthy();
    expect(refused("A trucker cap with a big brand logo next to the bottle.")).toContain("label is the only branding");
    expect(refused("A teen at the table reaches for the bottle.")).toContain("under 18");
    expect(refused("A playground picnic with the bottle on the bench.")).toContain("invites children");
    expect(refused("The bottle with a price card reading $4 on the rail.")).toContain("product fact the seller never gave");
    expect(refused(`A porch at dusk. ${"Very long. ".repeat(100)}`)).toContain("ran past");
  });

  it("reads a negated logo as the rule it is, not a logo on screen", () => {
    expect(mentionsLogo("Plain mugs with no logos, the bottle in front.")).toBeNull();
    expect(mentionsLogo("A mug with a logo in front.")).toBe("logo");
  });
});
