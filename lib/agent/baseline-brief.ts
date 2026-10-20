// Turns a candidate and its LLM-only baseline into the same inputs the Qloo path produces
// (ProductSpec, BriefSlots, creative direction), so the Control goes through the same concept writer
// and templates. Every cue is labeled creative: none of it comes from Qloo.
// The Control is always run 1, fixed before anyone sees the results; runs 2 and 3 exist only to show
// Gate 2's range of scores.
import { CONTROL_SEGMENT } from "../api/requests";
import { productSpecSchema, type BriefSlots, type ProductSpec } from "../prompts/brief";
import { creativeDirectionSchema, type CreativeDirection, type Cue } from "../types";
import type { Candidate } from "../demo/candidates";
import type { BaselineRun } from "./baseline";

export const CONTROL_RUN = 1;
export const CONTROL_LABEL = "LLM-only brief (no Qloo)";

const creative = (text: string): Cue => ({ text, origin: "creative", evidenceIds: [] });

function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

export function candidateProduct(candidate: Candidate): ProductSpec {
  return productSpecSchema.parse({
    slug: candidate.slug,
    name: candidate.product.name,
    // Working names only until the examples are picked; the brand name is added in the edit.
    brandName: null,
    oneLine: firstSentence(candidate.product.description),
    // The founder's own description and price: the only product facts a concept or script may state.
    sellerFacts: [candidate.product.description, candidate.product.price ? `Price: ${candidate.product.price}.` : null].filter(Boolean).join(" "),
    source: { kind: "description", lookDescription: candidate.product.lookDescription },
  });
}

export function candidateDirection(candidate: Candidate): CreativeDirection {
  return creativeDirectionSchema.parse(candidate.direction ?? {});
}

export function controlBrief(run: BaselineRun): BriefSlots {
  if (run.run !== CONTROL_RUN) throw new Error(`The Control is always run ${CONTROL_RUN}; got run ${run.run}.`);
  const { brief } = run;
  return {
    segment: { id: CONTROL_SEGMENT, label: CONTROL_LABEL, ageBands: brief.audience.ageBands },
    productRole: creative(brief.productRole),
    mood: creative(brief.mood),
    music: creative(`${brief.music.style}, ${brief.music.tempo}`),
    visual: creative(brief.visual.look),
    wardrobe: creative(brief.wardrobe.styling),
    setting: brief.setting.types.map(creative),
    voice: { tone: creative(brief.voice.tone), use: brief.voice.use, avoid: brief.voice.avoid },
    talent: brief.talent ? creative(brief.talent.description) : null,
    hooks: brief.hooks.map(creative),
    // The Control never names a city in prompts; its guessed cities stay in the brief for scoring.
    allowedPlaces: [],
  };
}
