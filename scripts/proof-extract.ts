// Proof lab, step 4: the named picks in each generic plan, extracted by Claude with one fixed prompt
// per plan (recorded to data/proof/llm/proof-extract.json, so it replays). Stoop's plans need no
// extraction: they name Qloo entities only through "[[id]]" refs, which are exact.
//
// The generic plan is told to describe music and food "by style and kind, never by an artist's or a
// business's name" in its lines, and to list the real artists and food brands it leans on separately
// (picks, kept for scoring). So the extraction reads both: the lines (for any name that slipped in)
// and the picks, and sorts every name into a type, so a packaged-snack brand is not
// counted as a place on the block.
//
// Writes data/proof/extract.json.
//   cd /Users/khadim/Stoop && npx tsx <worktree>/scripts/proof-extract.ts [--replay-only] [--round 2]
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { askOnce } from "../lib/agent/ask";
import type { PlanReport } from "../lib/plan/schema";
import { loadLocalEnv } from "./env";
import { exists, json, loadStores, PROOF, proofModel, readJson, roundArg, roundPrefix, roundRuns } from "./proof-lib";

export const EXTRACT_INSTRUCTIONS = [
  "You extract named things from a short event plan. You never add, guess or correct anything.",
  "A named thing is a proper name that appears in the text: a music artist or group, a restaurant, cafe, grocery store or food chain, a packaged food or drink brand, a park, venue, landmark, street or neighborhood, or another business.",
  "Generic words are not names: 'tacos', 'Southern hip-hop', 'gift card', 'payday', 'Veterans Day', a city or state name used only to describe a style ('Atlanta-style') are not named things.",
  "Copy each name exactly as written. Give its type, and the number of the plan line it appears in (null when it appears only in the 'also leans on' list).",
].join("\n");

export const extractSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["artist", "food_business", "product_brand", "place", "other_business", "other"]),
      line: z.number().int().nullable(),
    }),
  ),
});
export type Extracted = z.infer<typeof extractSchema>;

interface GenericAnswer {
  items?: { kind: string; text: string }[];
  /** Round 1's baseline listed food brands; round 2's lists the places its lines name. */
  picks?: { artists?: string[]; foods?: string[]; places?: string[] };
}

type Picks = { artists: string[]; foods?: string[]; places?: string[] };

/** The fixed prompt. Round 1's text is unchanged (its answers replay); round 2 lists places instead of food brands. */
export function extractPrompt(lines: readonly string[], picks: Picks): string {
  const second = picks.places ? ["The plan also leans on these (artists, then the places it names):", `- artists: ${picks.artists.join("; ") || "none"}`, `- places: ${picks.places.join("; ") || "none"}`] : ["The plan also leans on these (artists, then food brands):", `- artists: ${picks.artists.join("; ") || "none"}`, `- food brands: ${(picks.foods ?? []).join("; ") || "none"}`];
  return ["Event plan lines:", ...lines.map((line, i) => `${i + 1}. ${line}`), "", ...second, "", "List every named thing."].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const replayOnly = args.includes("--replay-only");
  const round = roundArg(args);
  if (!replayOnly) loadLocalEnv();
  const { model, store } = proofModel(`${roundPrefix(round)}-extract`, { replayOnly });
  const out: Record<string, { lines: string[]; picks: Picks; extracted: Extracted | null; failure?: string }> = {};
  for (const s of loadStores()) {
    const dir = path.join(roundRuns(round), s.id);
    if (!exists(path.join(dir, "plan.report.json"))) continue;
    const report = readJson<PlanReport>(path.join(dir, "plan.report.json"));
    const answers = readJson<{ answers: GenericAnswer[] }>(path.join(dir, "generic.json")).answers;
    const last = [...answers].reverse().find((a) => (a.items?.length ?? 0) >= 4);
    const lines = (report.baseline?.items ?? []).map((i) => i.text);
    const picks: Picks = round === 1 ? { artists: last?.picks?.artists ?? [], foods: last?.picks?.foods ?? [] } : { artists: last?.picks?.artists ?? [], places: last?.picks?.places ?? [] };
    const reply = await askOnce(model, { instructions: EXTRACT_INSTRUCTIONS, prompt: extractPrompt(lines, picks), schema: extractSchema, name: "named_things", description: "Every named thing in the plan, typed." });
    const parsed = reply.failure ? null : extractSchema.safeParse(reply.output);
    out[s.id] = { lines, picks, extracted: parsed?.success ? parsed.data : null, ...(parsed?.success ? {} : { failure: reply.failure ?? "did not match the schema" }) };
    console.log(`${s.id}: ${parsed?.success ? parsed.data.entities.map((e) => `${e.name} [${e.type}${e.line ? ` l${e.line}` : ""}]`).join(", ") : out[s.id]?.failure}`);
  }
  if (!replayOnly) {
    store.prune();
    store.save();
  }
  await writeFile(path.join(PROOF, round === 1 ? "extract.json" : `extract-${round}.json`), json({ note: "Named things in each generic plan (lines and picks), extracted by Claude with the fixed prompt in scripts/proof-extract.ts.", instructions: EXTRACT_INSTRUCTIONS, plans: out }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
