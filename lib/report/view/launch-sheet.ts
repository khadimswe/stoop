// The Launch plan's budget helper and exports, for the browser: the brand types a daily budget, the
// test days and (optionally) a target cost per result; this splits the budget evenly across every
// cell, the Control included, says when to call the test, and writes the launch sheet (CSV) and a
// Markdown copy. Only arithmetic on the brand's own numbers: no benchmarks, no medians, no promised
// results. Money is counted in cents, so no float ever leaks into a budget.
import { toCsv } from "../../csv";
import type { LaunchCellView, LaunchPlanView } from "./launch";

export const INTEREST_HEADING = "Interest searches to try in Ads Manager";
/** Interest searches are suggestions: Meta's interest list is not Qloo's. */
export const INTEREST_NOTE = "Search these in Ads Manager's detailed targeting. Meta's interest list is separate from Qloo's, so some may not exist there.";
export const CONTROL_INTEREST_NOTE = "None: the generic brief has no Qloo audience to search from.";

export interface BudgetInput {
  /** All cells together, per day, in US dollars, as typed. */
  daily: string;
  days: string;
  /** Optional: what one result (a sale, a lead) is worth paying. */
  target: string;
}
export type BudgetField = keyof BudgetInput;
export type BudgetErrors = Partial<Record<BudgetField, string>>;

export const BUDGET_DEFAULTS: Readonly<BudgetInput> = { daily: "60", days: "7", target: "" };
export const BUDGET_LIMITS = { maxDailyDollars: 100_000, minDays: 1, maxDays: 90, maxTargetDollars: 100_000 } as const;
/** Call the test once each cell has spent this many times the target cost per result. */
export const CALL_MULTIPLE = 3;

export interface BudgetSplit {
  cells: number;
  days: number;
  dailyCents: number;
  /** Each cell's daily budget, in whole dollars (as cents). Equal for every cell, so the test is fair. */
  perCellDailyCents: number;
  /** What rounding down to whole dollars leaves unassigned per day. */
  leftoverCents: number;
  perCellTotalCents: number;
  /** What the test spends: every cell's budget over the test days (the leftover is not spent). */
  totalCents: number;
  targetCents: number | null;
  /** The spend each cell needs before you call it (CALL_MULTIPLE times the target); null without a target. */
  callAtCents: number | null;
  /** The fewest days a cell takes to spend that at its daily budget; null without a target. */
  callAfterDays: number | null;
}

export type BudgetResult = { ok: true; split: BudgetSplit } | { ok: false; errors: BudgetErrors };

const MONEY = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?$/;

/** A typed dollar amount ("60", "$1,200", "24.50") in cents, or null when it is not one. */
export function parseCents(text: string): number | null {
  const match = MONEY.exec(text.trim());
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ""));
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$20", "$1,400", "$0.50": cents only when there are any. Fixed locale, so server and browser agree. */
export function formatUsd(cents: number): string {
  return `$${cents % 100 === 0 ? WHOLE.format(cents / 100) : CENTS.format(cents / 100)}`;
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Validates the brand's numbers and splits the daily budget evenly across `cells` cells, in whole dollars. */
export function planBudget(input: BudgetInput, cells: number): BudgetResult {
  const errors: BudgetErrors = {};
  const n = Math.max(1, Math.floor(cells));

  const dailyText = input.daily.trim();
  const daily = parseCents(dailyText);
  if (!dailyText) errors.daily = "Enter a daily budget, like 60.";
  else if (daily === null) errors.daily = "Enter a dollar amount, like 60 or 60.50.";
  else if (daily < n * 100) errors.daily = `Use at least ${formatUsd(n * 100)} a day, so each of the ${n} cells gets $1.`;
  else if (daily > BUDGET_LIMITS.maxDailyDollars * 100) errors.daily = `Use ${formatUsd(BUDGET_LIMITS.maxDailyDollars * 100)} a day or less.`;

  const daysText = input.days.trim();
  const dayCount = /^\d+$/.test(daysText) ? Number(daysText) : null;
  if (!daysText) errors.days = "Enter the test days, like 7.";
  else if (dayCount === null) errors.days = "Enter whole days, like 7.";
  else if (dayCount < BUDGET_LIMITS.minDays || dayCount > BUDGET_LIMITS.maxDays) errors.days = `Use ${BUDGET_LIMITS.minDays} to ${BUDGET_LIMITS.maxDays} days.`;

  const targetText = input.target.trim();
  const target = targetText ? parseCents(targetText) : null;
  if (targetText && target === null) errors.target = "Enter a dollar amount, like 25, or leave it empty.";
  else if (target === 0) errors.target = "Use more than $0, or leave it empty.";
  else if (target !== null && target > BUDGET_LIMITS.maxTargetDollars * 100) errors.target = `Use ${formatUsd(BUDGET_LIMITS.maxTargetDollars * 100)} or less.`;

  if (Object.keys(errors).length > 0 || daily === null || dayCount === null) return { ok: false, errors };

  const perCellDailyCents = Math.floor(daily / n / 100) * 100;
  const callAtCents = target === null ? null : target * CALL_MULTIPLE;
  return {
    ok: true,
    split: {
      cells: n,
      days: dayCount,
      dailyCents: daily,
      perCellDailyCents,
      leftoverCents: daily - perCellDailyCents * n,
      perCellTotalCents: perCellDailyCents * dayCount,
      totalCents: perCellDailyCents * n * dayCount,
      targetCents: target,
      callAtCents,
      callAfterDays: callAtCents === null ? null : Math.ceil(callAtCents / perCellDailyCents),
    },
  };
}

/** "$20 a day per cell · $140 per cell over 7 days · $420 in total". */
export function splitLine(split: BudgetSplit): string {
  return `${formatUsd(split.perCellDailyCents)} a day per cell · ${formatUsd(split.perCellTotalCents)} per cell over ${days(split.days)} · ${formatUsd(split.totalCents)} in total`;
}

/** What rounding to whole dollars leaves out, or null when the budget splits evenly. */
export function leftoverLine(split: BudgetSplit): string | null {
  if (split.leftoverCents === 0) return null;
  return `${formatUsd(split.leftoverCents)} a day stays unspent, so every cell gets the same budget.`;
}

/** Step 1 of the rule: when to call the test. */
export function callLine(split: BudgetSplit): string {
  if (split.callAtCents === null || split.targetCents === null) return split.days === 1 ? "Wait until the 1 test day is over." : `Wait until the ${split.days} test days are over.`;
  return `Wait until each cell has spent at least ${formatUsd(split.callAtCents)}, ${CALL_MULTIPLE} times your ${formatUsd(split.targetCents)} target cost per result.`;
}

/** How long that takes at each cell's budget (arithmetic, not a forecast). */
export function paceLine(split: BudgetSplit): string {
  if (split.callAfterDays === null) return `With a target cost per result, you can call it on spend instead.`;
  const at = `At ${formatUsd(split.perCellDailyCents)} a day per cell, that takes at least ${days(split.callAfterDays)}`;
  return split.callAfterDays > split.days ? `${at}, longer than your ${days(split.days)}: run the test longer or raise the budget.` : `${at}.`;
}

/** Step 1 before the numbers are valid: the rule in words. */
export const CALL_GENERIC = `Wait until each cell has spent at least ${CALL_MULTIPLE} times your target cost per result or, without a target, until the test days are over.`;
export const RULE_STEPS = ["Keep the worlds whose cost per result beats the Control's.", "Pause the rest, and move their budget to the best world."] as const;
export const NO_WINNER = "If no world beats the Control, keep the Control and try new concept worlds.";
export const PILOT_NOTE =
  "This is how a brand measures whether Qloo-built ads beat a generic AI brief. We don't claim they do: measuring that lift is our November pilot.";
export const ACCOUNT_NOTE = "Stoop never connects to your ad account: you set this up and read the results yourself.";
export const SETUP_LINE = "Set it up in Ads Manager in about 10 minutes.";
export const BOTH_PLATFORMS = "Running Meta and TikTok? Split each cell's budget evenly between its ad set and its ad group, so every cell still gets the same.";

/** Where a cell's prompts are: the report's Output card, as a link when the page URL is known. */
export function promptReference(cell: LaunchCellView, pageUrl: string | null): string {
  if (pageUrl) return `${pageUrl.replace(/#.*$/, "")}#${cell.creative.anchor}`;
  return `Output section, ${cell.kind === "control" ? "Control" : cell.label}`;
}

function optionsFrom(cell: LaunchCellView): string {
  return cell.optionsFrom === "qloo" ? "Qloo taste data (optional)" : "Generic AI brief, not from Qloo";
}

function receiptIds(cell: LaunchCellView): string[] {
  return [...new Set([...cell.ageBands, ...cell.cities, ...cell.interests].flatMap((o) => o.evidenceIds))];
}

export const LAUNCH_SHEET_COLUMNS = [
  "Campaign",
  "Ad set name",
  "Ad name",
  "Daily budget (USD)",
  "Placements",
  "Age bands",
  "Cities",
  "Interest searches (suggestions)",
  "Audience options from",
  "Hook",
  "Prompt reference",
  "What to watch",
  "Qloo receipts",
] as const;

/** One row per cell, in cell order (the Control first). */
export function launchSheetRows(view: LaunchPlanView, split: BudgetSplit, pageUrl: string | null = null): string[][] {
  return view.cells.map((cell) => {
    const ids = receiptIds(cell);
    return [
      view.campaign,
      cell.adSetName,
      cell.creative.title,
      (split.perCellDailyCents / 100).toFixed(0),
      cell.placements.join("; "),
      cell.ageBands.map((o) => o.text).join("; "),
      cell.cities.map((o) => o.text).join("; "),
      cell.interests.map((i) => i.name).join("; "),
      optionsFrom(cell),
      cell.creative.hook,
      promptReference(cell, pageUrl),
      cell.watch,
      ids.length > 0 ? ids.join(" ") : "None: not from Qloo",
    ];
  });
}

/** The launch sheet: a UTF-8 byte order mark (so spreadsheet apps read the dots as written), then the CSV, every cell guarded against formulas. */
export function launchSheetCsv(view: LaunchPlanView, split: BudgetSplit, pageUrl: string | null = null): string {
  return "﻿" + toCsv([[...LAUNCH_SHEET_COLUMNS], ...launchSheetRows(view, split, pageUrl)]);
}

/** Inline Markdown text: one line, with the characters that would turn into markup escaped. */
function md(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/([\\`*_[\]<>|])/g, "\\$1");
}

function optionList(options: LaunchCellView["ageBands"]): string {
  if (options.length === 0) return "none";
  return options.map((o) => (o.detail ? `${md(o.text)} (${md(o.detail)})` : md(o.text))).join(", ");
}

function cellMarkdown(cell: LaunchCellView, split: BudgetSplit, pageUrl: string | null): string[] {
  const from = cell.optionsFrom === "qloo" ? "Qloo, optional" : "from the generic brief, not from Qloo";
  const ids = receiptIds(cell);
  return [
    `## ${md(cell.name)}: ${md(cell.label)}`,
    "",
    `- Ad set (Meta) or ad group (TikTok): ${md(cell.adSetName)}`,
    `- Ad: ${md(cell.creative.title)}`,
    `- Daily budget: ${formatUsd(split.perCellDailyCents)}`,
    `- Placements: ${cell.placements.map(md).join(", ")}`,
    `- Hook: ${md(cell.creative.hook)}`,
    `- Age bands (${from}): ${optionList(cell.ageBands)}`,
    `- Cities (${from}): ${optionList(cell.cities)}`,
    cell.kind === "control"
      ? `- ${INTEREST_HEADING}: ${CONTROL_INTEREST_NOTE}`
      : `- ${INTEREST_HEADING} (Qloo, suggestions): ${cell.interests.length > 0 ? cell.interests.map((i) => `${md(i.name)} (${md(i.kind)})`).join(", ") : "none"}`,
    ...(ids.length > 0 ? [`- Qloo receipts: ${ids.map((id) => `\`${id}\``).join(", ")}`] : []),
    `- Prompts: ${pageUrl ? promptReference(cell, pageUrl) : md(promptReference(cell, null))}`,
    `- What to watch: ${md(cell.watch)}`,
  ];
}

/** The whole plan as Markdown, for a doc or a message ("Copy as Markdown"). */
export function launchSheetMarkdown(view: LaunchPlanView, split: BudgetSplit, pageUrl: string | null = null): string {
  const leftover = leftoverLine(split);
  return [
    `# Launch plan: ${md(view.brand)}`,
    "",
    `A fair test of each concept world against the generic AI brief. ${SETUP_LINE}`,
    "",
    `- Campaign: ${md(view.campaign)}`,
    `- Budget: ${formatUsd(split.dailyCents)} a day for ${days(split.days)}, split evenly across ${split.cells} cells: ${splitLine(split)}.${leftover ? ` ${leftover}` : ""}`,
    `- ${BOTH_PLATFORMS}`,
    "",
    ...view.cells.flatMap((cell) => [...cellMarkdown(cell, split, pageUrl), ""]),
    "## How to call it",
    "",
    `1. ${callLine(split)} ${paceLine(split)}`,
    ...RULE_STEPS.map((step, i) => `${i + 2}. ${step}`),
    "",
    NO_WINNER,
    "",
    md(view.optionsNote),
    "",
    `${INTEREST_HEADING}: ${INTEREST_NOTE}`,
    "",
    `${PILOT_NOTE} ${ACCOUNT_NOTE}`,
    "",
  ].join("\n");
}
