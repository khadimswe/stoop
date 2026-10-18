// The review file sections every Production Pack export shares (scripts/export-pack.ts): the concepts
// with their rubric scores, the shot list, every asset and render prompt with its hash, the music
// note, overlays, the kit scripts and captions, the Director's Guide and the hashes to approve. The
// baselines export and the export from the example reports print them the same way.
import { getModel } from "../prompts/models.config";
import type { ProductionPack } from "../prompts/pack";
import { totalScore } from "../prompts/rubric";
import type { ConceptSet, UgcScript } from "../report/world";

export const block = (text: string) => `\`\`\`text\n${text}\n\`\`\``;

/** The concepts, kept one first, with the rubric as scored and after the specificity bound. */
export function conceptLines(ranked: Pick<ConceptSet, "best" | "others">): string[] {
  return [
    "## Concepts",
    "",
    "Specificity counts at most 1 plus the brief slots the concept declared and its own words verify; the total below is after that bound.",
    "",
    ...[ranked.best, ...ranked.others].flatMap(({ concept, rubric, uses, verifiedUses, total, status }, index) => {
      const scores = Object.entries(rubric.scores)
        .map(([id, score]) => `${id} ${score}`)
        .join(", ");
      return [
        `### ${index + 1}. ${concept.title} (${status === "kept" ? "**kept**" : status === "discarded" ? "discarded (failed a hard gate)" : "not kept"})`,
        "",
        `- Hook: ${concept.hook}`,
        `- Feeling: ${concept.emotion}. Surprise beat: ${concept.surpriseBeat}`,
        `- Tests: ${concept.testHypothesis ?? "(none: written before test hypotheses)"}`,
        `- Brief slots: declared ${uses.length ? uses.join(", ") : "none"}; verified ${verifiedUses.length ? verifiedUses.join(", ") : "none"}`,
        `- Rubric: total ${total} after the bound, ${totalScore(rubric)} as scored (${scores}); no stereotype ${rubric.gates.no_stereotype ? "pass" : "FAIL"}, surprise beat ${rubric.gates.has_surprise_beat ? "pass" : "FAIL"}`,
        `- Why: ${rubric.reason}`,
        "",
      ];
    }),
  ];
}

export interface KitLines {
  ugc: readonly UgcScript[];
  captions: string | null;
}

/** From the shot list through the Director's Guide. */
export function packLines(pack: ProductionPack, kit: KitLines, formatReason: string): string[] {
  return [
    "## Shot list",
    "",
    block(pack.shotList),
    "",
    "## Asset prompts (render these first)",
    "",
    ...pack.assets.flatMap((asset) => [
      `### ${asset.file}`,
      "",
      `- Model: ${getModel(asset.modelId).displayName}, aspect ${asset.aspect}. Draft: ${getModel(asset.modelId).draftSetting}. Final: ${getModel(asset.modelId).finalSetting}.`,
      `- References: ${asset.refs.length ? asset.refs.join(", ") : "none"}`,
      ...(asset.negative ? [`- Negative field: ${asset.negative}`] : []),
      `- promptHash: \`${asset.promptHash}\``,
      "",
      block(asset.prompt),
      "",
    ]),
    "## Render prompts",
    "",
    ...pack.renders.flatMap((render) => [
      `### ${render.id}`,
      "",
      `- Model: ${getModel(render.modelId).displayName}. Request ${render.renderSeconds} s, cut to ${render.trimTo} s. Scenes ${render.sceneIndexes.map((i) => i + 1).join(", ")}.`,
      `- References: ${render.refs.length ? render.refs.join(", ") : "none (the model takes no reference images)"}`,
      ...(render.startFrame
        ? [`- Start frame: ${render.startFrame.kind === "asset" ? render.startFrame.file : `the last frame of ${render.startFrame.job}`}`]
        : []),
      ...(render.negative ? [`- Negative field: ${render.negative}`] : []),
      `- promptHash: \`${render.promptHash}\``,
      "",
      block(render.prompt),
      "",
    ]),
    "## Music for the edit",
    "",
    `Drafts may keep the model's own music. For the final, add a licensed track that matches: ${pack.musicForEdit}`,
    "",
    ...(pack.sourcePhotos.length
      ? ["## Product photos (the brand's own, used as references)", "", ...pack.sourcePhotos.map((p) => `- ${p.file}: ${p.url}`), ""]
      : []),
    "## Overlay text (added in the edit)",
    "",
    ...(pack.overlays.length ? pack.overlays.map((o) => `- Scene ${o.scene}: "${o.text}"`) : ["- none"]),
    "",
    "## Kit scripts (short-form, for AI UGC tools and creators)",
    "",
    `Format: ${formatReason}`,
    "",
    ...kit.ugc.flatMap((script) => [`### ${script.platform} / ${script.tool} (CTA: ${script.cta})`, "", block(script.script), ""]),
    "### Captions (WebVTT)",
    "",
    kit.captions ? block(kit.captions.trimEnd()) : "None: the concept has no spoken lines or overlay text.",
    "",
    // The guide is its own document; shift its headings one level so it nests under this pack.
    pack.directorGuide.replace(/^(#+) /gm, "#$1 "),
    "",
  ];
}

export function hashLines(hashes: readonly { id: string; promptHash: string }[]): string[] {
  return ["## Hashes to approve", "", ...hashes.map((h) => `- \`${h.promptHash}\` ${h.id}`), ""];
}
