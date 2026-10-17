// The creative steps a run hands to the orchestrator: the shared concept writer, the Production Pack
// templates and the kit. The concept worlds and the LLM-only Control both go through these same
// functions, with the same model and settings, so the only difference between them is the brief.
import { adPlanEntry } from "../kit/ad-plan";
import { creatorBrief } from "../kit/creator-brief";
import { buildProductionPack, checkPack } from "../prompts/pack";
import { buildKitScripts, pickUgcFormat } from "../prompts/ugc";
import { conceptSet, writeConcepts } from "../stages/concepts";
import type { Creative } from "./orchestrator";

export const SHARED_CREATIVE: Creative = {
  writeConcepts: (product, brief, options) => writeConcepts(product, brief, options),
  conceptSet: (run, brief) => conceptSet(run, brief),
  buildPack: (input) => buildProductionPack(input),
  checkPack: (pack, brief, product, names, options) => checkPack(pack, brief, product, names, options),
  kitScripts: (input) => buildKitScripts(input),
  formatReason: (concept) => {
    const pick = pickUgcFormat(concept);
    return { format: pick.format.label, reason: pick.reason };
  },
  adPlanEntry: (input) => adPlanEntry(input),
  creatorBrief: (input) => creatorBrief(input),
};
