// The creative steps a run hands to the orchestrator: the shared concept writer, the Production Pack
// templates and the kit. Gate 4's lane B is rebuilding the concept writer (verified slot use, test
// hypotheses), the Kling and Runway templates and the kit; until it lands, concepts are not written
// here, so a run records its Qloo calls and Culture briefs and stops each world at "concepts".
import { buildProductionPack, checkPack } from "../prompts/pack";
import type { Creative } from "./orchestrator";

const pending = () => {
  throw new Error("Concepts are written once the Gate 4 concept writer lands.");
};

export const INTERIM_CREATIVE: Creative = {
  writeConcepts: async () => pending(),
  conceptSet: () => pending(),
  buildPack: (input) => buildProductionPack(input),
  checkPack: (pack, brief, product, names) => checkPack(pack, brief, product, names),
  kitScripts: () => ({ captions: null, ugc: [] }),
  adPlanEntry: () => pending(),
  creatorBrief: () => null,
};
