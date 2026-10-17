// Writes the full Control Production Pack for one candidate (or all) for the founder to review before
// any render: the brief with its origins, all three concepts with rubric scores, every asset and render
// prompt with its hash and start frame, the shot list, the kit scripts and captions, the critique
// checklist and the Director's Guide. Concepts written with older instructions still export, with a warning.
//   npm run prompts:export -- <slug>|--all [--freeze]
// Review files go to exports/<slug>/ (gitignored). --freeze also writes data/packs/<slug>/control.json,
// the committed record of an approved pack; approved hashes then go in public/demo/approvals.json.
// Zero API calls: it reads the committed baseline and concepts.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { baselineNames, baselineRunSchema, type BaselineRun } from "../lib/agent/baseline";
import { candidateDirection, candidateProduct, CONTROL_RUN, controlBrief } from "../lib/agent/baseline-brief";
import { CANDIDATES, type Candidate } from "../lib/demo/candidates";
import { defaultPackSettings, type BriefSlots, type ProductSpec } from "../lib/prompts/brief";
import { getModel } from "../lib/prompts/models.config";
import { buildProductionPack, checkPack, packHashes, type ProductionPack } from "../lib/prompts/pack";
import { totalScore } from "../lib/prompts/rubric";
import { buildKitScripts, pickUgcFormat } from "../lib/prompts/ugc";
import { bestConcept, conceptRunSchema, conceptSet, conceptsStatus, type ConceptRun } from "../lib/stages/concepts";
import { ageBandLabel, type Cue } from "../lib/types";

const EM_DASH = String.fromCharCode(0x2014);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJson(file: string): Promise<unknown> {
  if (!existsSync(file)) fail(`Missing ${file}. Run npm run baseline -- <slug> first.`);
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadControl(candidate: Candidate): Promise<{ run: BaselineRun; concepts: ConceptRun }> {
  const dir = path.join("data", "baselines", candidate.slug);
  const run = baselineRunSchema.parse(await readJson(path.join(dir, `run-${CONTROL_RUN}.json`)));
  const concepts = conceptRunSchema.parse(await readJson(path.join(dir, "concepts.json")));
  return { run, concepts };
}

const origin = (cue: Cue) => (cue.origin === "creative" ? "not from Qloo" : cue.origin);
const block = (text: string) => `\`\`\`text\n${text}\n\`\`\``;

function markdown(candidate: Candidate, run: BaselineRun, concepts: ConceptRun, brief: BriefSlots, product: ProductSpec, pack: ProductionPack): string {
  const hashes = packHashes(pack);
  const ranked = conceptSet(concepts, brief);
  const format = pickUgcFormat(pack.concept);
  const kit = buildKitScripts({ product, brief, concept: pack.concept });
  const { audience, references, assumedCities } = run.brief;
  const lines: string[] = [
    `# Production Pack: ${candidate.workingName} (Control)`,
    "",
    "**Status: not approved.** Review every prompt before any render. Approve by adding the hashes at the end to `public/demo/approvals.json`.",
    "",
    `This is the **Control**: an LLM-only brief written with no Qloo data (run ${run.run} of the baseline, fixed in advance). It uses the same concept writer, templates, models and settings as the culture-made packs; only the brief differs.`,
    "",
    `- Model: ${run.modelId}, effort ${run.effort}. Baseline ${run.generatedAt}, concepts ${concepts.generatedAt}.`,
    `- Template version ${pack.templateVersion}. Settings hash \`${pack.settingsHash}\`.`,
    `- Creative direction: look ${pack.settings.direction.look}, cast ${pack.settings.direction.cast} (resolved: ${pack.cast}), energy ${pack.settings.direction.energy}${pack.settings.direction.notes ? `, notes "${pack.settings.direction.notes}"` : ""}.`,
    "",
    "## Product",
    "",
    `- ${candidate.product.name}, ${candidate.product.price}, ${candidate.product.category}`,
    `- ${candidate.product.description}`,
    `- Look (for the packshot): ${candidate.product.lookDescription}`,
    `- Seeds: ${candidate.seeds.join(", ")}`,
    `- Stated customer: ${candidate.statedCustomer}`,
    "",
    "## The LLM-only brief",
    "",
    `- Assumed audience: ${audience.ageBands.map(ageBandLabel).join(", ")}, gender skew ${audience.genderSkew}. ${audience.description}`,
    `- Product role (${origin(brief.productRole)}): ${brief.productRole.text}`,
    `- Mood (${origin(brief.mood)}): ${brief.mood.text}`,
    `- Music (${origin(brief.music)}): ${brief.music.text}`,
    `- Visual language (${origin(brief.visual)}): ${brief.visual.text}`,
    brief.wardrobe ? `- Wardrobe (${origin(brief.wardrobe)}): ${brief.wardrobe.text}` : "- Wardrobe: none",
    `- Setting (not from Qloo): ${brief.setting.map((cue) => cue.text).join("; ")}`,
    `- Voice (${origin(brief.voice.tone)}): ${brief.voice.tone.text}. Use: ${brief.voice.use.join(", ")}. Avoid: ${brief.voice.avoid.join(", ")}`,
    brief.talent ? `- Talent (${origin(brief.talent)}): ${brief.talent.text}` : "- Talent: none (no people on screen)",
    `- Hooks: ${brief.hooks.map((cue) => `"${cue.text}"`).join(" / ")}`,
    "",
    "**Named references** (kept for Qloo scoring in Gate 2; never in any prompt):",
    "",
    ...Object.entries(references).map(([type, names]) => `- ${type}: ${names.length ? names.join(", ") : "-"}`),
    `- assumed cities: ${assumedCities.length ? assumedCities.join(", ") : "-"}`,
    "",
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
    `Format: ${format.reason}`,
    "",
    ...kit.ugc.flatMap((script) => [`### ${script.platform} / ${script.tool} (CTA: ${script.cta})`, "", block(script.script), ""]),
    "### Captions (WebVTT)",
    "",
    kit.captions ? block(kit.captions.trimEnd()) : "None: the concept has no spoken lines or overlay text.",
    "",
    // The guide is its own document; shift its headings one level so it nests under this pack.
    pack.directorGuide.replace(/^(#+) /gm, "#$1 "),
    "",
    "## Hashes to approve",
    "",
    ...hashes.map((h) => `- \`${h.promptHash}\` ${h.id}`),
    "",
  ];
  return lines.join("\n");
}

async function writeChecked(file: string, text: string): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (key && text.includes(key)) fail(`Refusing to write ${file}: an API key appeared in the output.`);
  if (text.includes(EM_DASH)) fail(`Refusing to write ${file}: it contains an em dash.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function exportOne(candidate: Candidate, freeze: boolean): Promise<boolean> {
  const { run, concepts } = await loadControl(candidate);
  const product = candidateProduct(candidate);
  const settings = defaultPackSettings(candidateDirection(candidate));
  const brief = controlBrief(run);
  const status = conceptsStatus(concepts, product, brief, settings.direction);
  if (status === "other-input") {
    console.error(`${candidate.slug}: concepts.json was written from a different run 1. Run npm run baseline -- ${candidate.slug} to refresh it.`);
    return false;
  }
  if (status === "stale-instructions") {
    // Same brief, older concept writer: still a valid review file, but never one to approve.
    if (freeze) {
      console.error(`${candidate.slug}: concepts.json was written with older concept instructions. Refresh it (npm run baseline -- ${candidate.slug}) before freezing.`);
      return false;
    }
    console.warn(`${candidate.slug}: concepts.json was written with older concept instructions (no declared slots or test hypothesis). Exporting for review; refresh it before approving.`);
  }
  const pack = buildProductionPack({ product, brief, concept: bestConcept(concepts), settings });
  // The Control has no Qloo data, so no slot is rich.
  const problems = checkPack(pack, brief, product, baselineNames(run, candidate), { richSlots: [] });
  if (problems.length > 0) {
    console.error(`${candidate.slug}: ${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
    return false;
  }
  const dir = path.join("exports", candidate.slug);
  await writeChecked(path.join(dir, "production-pack.md"), markdown(candidate, run, concepts, brief, product, pack));
  await writeChecked(path.join(dir, "hashes.json"), `${JSON.stringify(packHashes(pack), null, 2)}\n`);
  if (freeze) await writeChecked(path.join("data", "packs", candidate.slug, "control.json"), `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`${candidate.slug}: ${pack.assets.length} assets, ${pack.renders.length} render prompts -> ${dir}/production-pack.md${freeze ? " (frozen)" : ""}`);
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith("--"));
  const all = args.includes("--all");
  const freeze = args.includes("--freeze");
  if (!slug && !all) fail("Usage: npm run prompts:export -- <slug>|--all [--freeze]");
  if (freeze && all) fail("--freeze takes one slug at a time, after the founder approves that pack.");
  const targets = all ? CANDIDATES : CANDIDATES.filter((c) => c.slug === slug);
  if (targets.length === 0) fail(`Unknown candidate "${slug}". Known: ${CANDIDATES.map((c) => c.slug).join(", ")}`);
  let ok = true;
  for (const candidate of targets) ok = (await exportOne(candidate, freeze)) && ok;
  if (!ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  void main();
}
