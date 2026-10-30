// Proof lab: prints one proof run as plain text, refs rendered to the names Qloo returned. For reading
// runs side by side; nothing is written.
//   npx tsx scripts/proof-show.ts <id>... [--brief] [--round 2]
import path from "node:path";
import { renderRefs } from "../lib/plan/refs";
import type { PlanReport } from "../lib/plan/schema";
import { readJson, roundArg, roundRuns } from "./proof-lib";

interface GenericAnswer {
  items?: { kind: string; text: string }[];
  picks?: { artists?: string[]; foods?: string[]; places?: string[] };
}

function show(id: string, brief: boolean, round: number): void {
  const PROOF_RUNS = roundRuns(round);
  const report = readJson<PlanReport>(path.join(PROOF_RUNS, id, "plan.report.json"));
  const generic = readJson<{ answers: GenericAnswer[] }>(path.join(PROOF_RUNS, id, "generic.json")).answers;
  const names = new Map<string, string>([...(report.local.city?.artists ?? []).map((a) => [a.id, a.name] as const), ...(report.local.blockMusic?.artists ?? []).map((a) => [a.id, a.name] as const), ...(report.local.block?.places ?? []).map((p) => [p.id, p.name] as const)]);
  const r = (text: string) => renderRefs(text, names);
  const out: string[] = [`=== ${id} (${report.inputs.store.city}) ===`];
  const city = report.local.city;
  out.push(`City artists (${city?.artists.length ?? 0}): ${city?.artists.map((a) => a.name).join(", ") ?? "none"}`);
  out.push(`City styles: ${city?.styles.map((s) => s.name).join(", ") || "none"}`);
  out.push(`Block (${report.local.block?.places.length ?? 0} places within ${report.local.block?.radiusM ?? "?"} m):`);
  for (const p of report.local.block?.places ?? []) out.push(`  - ${p.name} [${p.kind}] ${p.distanceM ?? "?"} m; ${p.tags.slice(0, 5).join(", ")}`);
  out.push(`Gaps: ${report.local.gaps.join(" | ") || "none"}`);
  const bm = report.local.blockMusic;
  out.push(bm ? `Block music: used=${bm.used} (${bm.reason}); signal ${bm.placeIds.map((id) => names.get(id) ?? id).join(", ")}; artists ${bm.artists.map((a) => `${a.name}${a.genres.length ? ` [${a.genres.slice(0, 3).join(", ")}]` : ""}${a.via.length ? ` via ${a.via.map((v) => names.get(v) ?? v).join("/")}` : ""}`).join("; ")}` : "Block music: not tested");
  const plan = report.plan;
  for (const c of plan?.concepts ?? []) {
    out.push(`${c.kept ? "KEPT" : "alt "} ${c.title} (${c.total}): ${r(c.hook)}`);
    if (c.kept || !brief) for (const item of c.items) out.push(`    [${item.kind}/${item.origin}] ${r(item.text)}`);
  }
  if (!brief && plan) {
    out.push("Run of show:", ...plan.runOfShow.map((s) => `  ${s.time} ${r(s.step)}`));
    out.push("Shopping:", ...plan.shopping.map((s) => `  ${s.item}${s.qty ? ` (${s.qty})` : ""}${s.estUsd !== undefined ? ` $${s.estUsd}` : ""}${s.from ? ` from ${names.get(s.from) ?? s.from}` : ""} [${s.origin}]`));
    if (plan.wheel) out.push("Wheel:", ...plan.wheel.slices.map((s) => `  ${s.label} [${s.kind}/${s.origin}] ${r(s.text)}`));
    out.push(`Estimated cost: $${plan.estimatedCostUsd}`);
  }
  out.push("Generic plan:");
  for (const item of report.baseline?.items ?? []) out.push(`    [${item.kind}] ${item.text}`);
  const last = [...generic].reverse().find((g) => (g.items?.length ?? 0) >= 4);
  out.push(`  generic picks: artists ${last?.picks?.artists?.join(", ") ?? "none"}; foods ${last?.picks?.foods?.join(", ") ?? "none"}; places ${last?.picks?.places?.join(", ") ?? "none"}`);
  out.push(`  cliches: ${report.baseline?.cliches.map((c) => c.text).join("; ") ?? "none"}`);
  out.push(`  check: ${JSON.stringify(report.baseline?.check && { ...report.baseline.check, evidenceIds: undefined })}`);
  out.push("Comparison:", ...(report.comparison?.lines ?? []).map((l) => `  ${l}`));
  console.log(out.join("\n"));
}

const args = process.argv.slice(2);
const round = roundArg(args);
for (const id of args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--round")) show(id, args.includes("--brief"), round);
