// The plan for the kept concept: a run of show (setup, peak, wrap), a shopping list bought from block
// partners where it can be, a checklist and an estimated cost inside the budget. Claude writes the
// run of show, the shopping list and a few checks specific to the concept; code checks every line,
// fixes the order of the day, sums the cost and adds the checks every store needs (sidewalk rules,
// carrier brand rules, staffing, cleanup, no alcohol or tobacco, nothing aimed at minors). If Claude's
// answer still fails after one repair, a plain plan built from the concept stands in, so a run never
// ends without one.
import { z } from "zod";
import { askOnce, cachedInstructions } from "../agent/ask";
import { stripEmDashes } from "../guardrails";
import { planDecide, type PlanEnv } from "./env";
import { textIssues, type GuardContext } from "./guard";
import { clock, endTime, evidenceFor, inputsText, PLAN_RULES, PLANNER_ROLE, REF_RULES, startMinutes, toKeyRefs, toRealRefs, type Aliases } from "./prompt";
import { refsIn } from "./refs";
import type { Concept, Plan, PlanInputs } from "./schema";

export const PLAN_TIMEOUT_MS = 90_000;
/** Setup may start this long before the event, and the wrap may end this long after it. */
export const SETUP_MARGIN_MIN = 90;
export const MAX_STEPS = 10;
export const MAX_SHOPPING = 12;
export const MAX_EXTRA_CHECKS = 4;

/** Checks every plan carries, whatever the concept. */
export function baseChecklist(inputs: PlanInputs, hasPartners: boolean): string[] {
  const lines = [
    inputs.setting === "sidewalk_table"
      ? "Check the city's sidewalk rules before the day: a table, a tent or amplified sound can need a permit."
      : "Check the city's rules for the setting before the day, including any permit for amplified sound.",
    "Carrier brand rules: use only the store's official signage and assets, make no logos of your own, and nothing may imply the carrier sponsors the event.",
    "Staff the table and the floor at the same time: one person outside, at least one inside for walk-ins, and a plan for breaks.",
    "No alcohol or tobacco at the table, in giveaways or in anything a partner brings.",
    "Nothing aimed at minors: the music, the games and the giveaways are for adults on a public sidewalk.",
    "Keep the walkway clear and the volume friendly to neighbors and the businesses next door.",
    "Clean up the sidewalk and take down every sign when the event ends.",
  ];
  if (hasPartners) lines.push("Confirm each partner order (quantity, price, pickup time) a few days ahead, and get the price in writing.");
  return lines;
}

const llmPlan = z.object({
  runOfShow: z.array(z.object({ time: z.string().describe("24 hour HH:MM"), step: z.string().describe("What happens, at most 160 characters. Artists and places only as keys.") })).describe("4 to 8 steps: setup, opening, the peak, the wrap"),
  shopping: z
    .array(
      z.object({
        item: z.string().describe("What to buy or rent, at most 120 characters, no prices in the text"),
        qty: z.string().describe("How many, e.g. '40 tacos' or '1'"),
        estUsd: z.number().describe("Estimated dollars for this line"),
        from: z.string().nullable().describe("The p-key of the block place to buy it from, or null"),
      }),
    )
    .describe("Everything the event needs that the store does not have, inside the budget"),
  checks: z.array(z.string()).describe("1 to 4 extra checks specific to this concept, at most 200 characters each"),
});
type LlmPlan = z.infer<typeof llmPlan>;

const TASK = [
  "Task:",
  "Turn the kept concept below into a plan the manager can run: a run of show, a shopping list and a few checks specific to this concept.",
  "Run of show: 4 to 8 steps from setup (before the start time) through the peak to the wrap, with 24 hour times.",
  "Shopping list: only what the store does not already have. Buy food from the block's places where the concept uses them (set from to that place's key). Every line has a realistic price estimate, and the total stays within the budget.",
  "Checks: only what this concept adds (for example, confirming a partner's order size). The standard checks (permits, carrier brand rules, staffing, cleanup, no alcohol or tobacco, nothing for minors) are added for you.",
].join("\n");

export function planInstructions(): string {
  return [PLANNER_ROLE, PLAN_RULES, REF_RULES, TASK].join("\n\n");
}

export function planPrompt(inputs: PlanInputs, concept: Concept, aliases: Aliases): string {
  const places = [...aliases.places.values()].map((p) => `- [[${aliases.keys.get(p.id)}]] ${p.name} (${p.kind}${p.tags.length ? `; ${p.tags.slice(0, 4).join(", ")}` : ""})`);
  const lines = concept.items.map((i) => `- ${i.kind}: ${toKeyRefs(i.text, aliases)}`);
  return [
    inputsText(inputs),
    `The kept concept: ${concept.title}. ${concept.hook}\n${lines.join("\n")}`,
    places.length ? `Block places you may buy from:\n${places.join("\n")}` : "There are no block places to buy from.",
    "Write the plan.",
  ].join("\n\n");
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface PlanCheck {
  plan: Omit<Plan, "conceptId" | "concepts"> | null;
  issues: string[];
}

/** Checks one answer and builds the plan from what passes. */
export function checkPlan(raw: LlmPlan, inputs: PlanInputs, aliases: Aliases, guard: GuardContext): PlanCheck {
  const answer = stripEmDashes(raw);
  const issues: string[] = [];
  const start = startMinutes(inputs);
  const end = start + inputs.durationMinutes;

  const runOfShow: Plan["runOfShow"] = [];
  answer.runOfShow.slice(0, MAX_STEPS).forEach((s, i) => {
    const at = `runOfShow.${i + 1}`;
    const time = s.time.trim().padStart(5, "0");
    const step = toRealRefs(s.step.trim(), aliases);
    const problems = textIssues(step, guard);
    if (!HHMM.test(time)) problems.push(`time must be HH:MM (24 hour), got "${s.time}".`);
    else if (toMinutes(time) < start - SETUP_MARGIN_MIN || toMinutes(time) > end + SETUP_MARGIN_MIN) problems.push(`time ${time} is outside the day (${clock(start - SETUP_MARGIN_MIN)} to ${clock(end + SETUP_MARGIN_MIN)}).`);
    if (!step || step.length > 160) problems.push("step must be 1 to 160 characters.");
    if (problems.length) issues.push(...problems.map((p) => `${at}: ${p}`));
    else runOfShow.push({ time, step });
  });
  runOfShow.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  if (runOfShow.length < 3) issues.push("runOfShow: needs at least 3 steps that pass the checks (setup, the peak, the wrap).");

  const shopping: Plan["shopping"] = [];
  answer.shopping.slice(0, MAX_SHOPPING).forEach((s, i) => {
    const at = `shopping.${i + 1}`;
    const item = s.item.trim();
    const problems = textIssues(item, guard);
    if (refsIn(item).length) problems.push("item names a place; set from to its key instead.");
    if (!item || item.length > 120) problems.push("item must be 1 to 120 characters.");
    const fromKey = s.from?.trim().toLowerCase() || null;
    const from = fromKey ? aliases.ids.get(fromKey) : undefined;
    if (fromKey && (!from || !aliases.places.has(from))) problems.push(`from "${s.from}" is not a block place key.`);
    if (!Number.isFinite(s.estUsd) || s.estUsd < 0) problems.push("estUsd must be 0 or more.");
    if (problems.length) {
      issues.push(...problems.map((p) => `${at}: ${p}`));
      return;
    }
    const qty = s.qty.trim().slice(0, 40);
    const estUsd = Math.round(s.estUsd * 100) / 100;
    shopping.push({ item, ...(qty ? { qty } : {}), estUsd, ...(from ? { from, origin: "interpreted" as const, evidenceIds: evidenceFor(aliases, [from], []) } : { origin: "creative" as const, evidenceIds: [] }) });
  });
  const estimatedCostUsd = Math.round(shopping.reduce((sum, s) => sum + (s.estUsd ?? 0), 0));
  if (estimatedCostUsd > inputs.budgetUsd) issues.push(`shopping: the total is $${estimatedCostUsd}, over the $${inputs.budgetUsd} budget. Cut or shrink lines.`);

  const extras: string[] = [];
  answer.checks.slice(0, MAX_EXTRA_CHECKS).forEach((c, i) => {
    const check = c.trim();
    const problems = textIssues(check, guard);
    if (refsIn(check).length) problems.push("checks name places by key; describe the check without the key.");
    if (!check || check.length > 200) problems.push("each check must be 1 to 200 characters.");
    if (problems.length) issues.push(...problems.map((p) => `checks.${i + 1}: ${p}`));
    else extras.push(check);
  });

  const checklist = [...baseChecklist(inputs, shopping.some((s) => s.from)), ...extras].filter((line, i, all) => all.indexOf(line) === i);
  const plan = runOfShow.length >= 3 && estimatedCostUsd <= inputs.budgetUsd ? { runOfShow, shopping, checklist, estimatedCostUsd } : null;
  return { plan, issues };
}

/** A plain plan from the concept alone, when Claude's answer cannot be used: the day's shape, no purchases guessed. */
export function fallbackPlan(inputs: PlanInputs, concept: Concept): Omit<Plan, "conceptId" | "concepts"> {
  const start = startMinutes(inputs);
  const peak = start + Math.round(inputs.durationMinutes / 2);
  const runOfShow = [
    { time: clock(start - 45), step: "Set up the table, the speaker and the store's official signage." },
    { time: clock(start), step: `Open the table: ${concept.title}.` },
    { time: clock(peak), step: "Peak: both staff on the sidewalk side, one ready to bring people inside." },
    { time: endTime(inputs), step: "Wrap: pack up, clean the sidewalk and take down every sign." },
  ];
  return { runOfShow, shopping: [], checklist: baseChecklist(inputs, false), estimatedCostUsd: 0 };
}

function repairPrompt(prompt: string, previous: unknown, issues: readonly string[]): string {
  return [prompt, `Your previous answer failed these checks:\n${issues.map((i) => `- ${i}`).join("\n")}`, "Fix every issue and return the whole plan again.", `Previous answer (JSON):\n${JSON.stringify(previous)}`].join("\n\n");
}

/** One plan call, plus one repair. Always returns a plan: the fallback when Claude's cannot be used. */
export async function buildPlan(env: PlanEnv, inputs: PlanInputs, concepts: Concept[], aliases: Aliases, guard: GuardContext): Promise<Plan> {
  const kept = concepts.find((c) => c.kept) ?? (concepts[0] as Concept);
  const instructions = cachedInstructions(planInstructions());
  const prompt = planPrompt(inputs, kept, aliases);
  let ask = prompt;
  let built: PlanCheck["plan"] = null;
  for (let attempt = 1; attempt <= 2 && !built; attempt++) {
    const reply = await askOnce(env.model, { instructions, prompt: ask, schema: llmPlan, name: "event_plan", description: "The run of show, shopping list and checks.", timeoutMs: env.timeoutMs ?? PLAN_TIMEOUT_MS, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) });
    const parsed = reply.failure ? null : llmPlan.safeParse(reply.output);
    if (!parsed?.success) {
      planDecide(env, "plan", attempt === 1 ? "Asked Claude again for the plan" : "Claude's plan did not come back usable", reply.failure ?? "The answer did not match the plan format.");
      continue;
    }
    const check = checkPlan(parsed.data, inputs, aliases, guard);
    if (check.plan && check.issues.length === 0) built = check.plan;
    else if (attempt === 1) {
      planDecide(env, "plan", `Sent ${check.issues.length} ${check.issues.length === 1 ? "problem" : "problems"} back to Claude`, check.issues.slice(0, 4).join(" "));
      ask = repairPrompt(prompt, parsed.data, check.issues);
    } else if (check.plan) {
      built = check.plan;
      planDecide(env, "plan", "Dropped the lines that still failed the checks", check.issues.slice(0, 4).join(" "));
    }
  }
  if (!built) {
    planDecide(env, "plan", "Built a plain plan from the concept", "Claude's plan could not be used, so the day's shape and the standard checks stand in. Nothing is bought or priced for you.");
    built = fallbackPlan(inputs, kept);
  }
  const partners = built.shopping.filter((s) => s.from).length;
  planDecide(env, "plan", `Planned the day: ${built.runOfShow.length} steps, ${built.shopping.length} things to buy`, `About $${built.estimatedCostUsd} of the $${inputs.budgetUsd} budget${partners ? `, ${partners} bought from block partners` : ""}.`);
  return { conceptId: kept.id, concepts, ...built };
}
