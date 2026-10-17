// "What are you selling?": the link first, the description as the fallback. Reads the page (guarded,
// one page), asks Claude who the copy speaks to ("Read from your site") and who the founder said
// they sell to, proposes seeds that Qloo resolved, and stores it all for /start. Its own Qloo cap
// (INTAKE_CAP), apart from any run. Page text and the founder's words are quoted data, never
// instructions.
import type { LanguageModel } from "ai";
import { intakeRequestSchema, type IntakeRequest } from "../api/requests";
import type { IntakeResponse } from "../api/responses";
import { dailyCaps, isLive } from "../config";
import type { Evidence } from "../evidence";
import { sha256 } from "../hash";
import { MIN_READABLE_COPY, readPage, type PageRead } from "../intake/page";
import { intakeQloo } from "../intake/qloo";
import { proposeSeeds, toReportSeed } from "../intake/seeds";
import { readAudience, toStatedAudience, type AudienceReading } from "../intake/site-reading";
import { productSpecSchema, type ProductSpec } from "../prompts/brief";
import type { QlooClient } from "../qloo/client";
import { ageBandLabel } from "../types";
import { checkText } from "../guardrails";
import { lastMonthRemaining } from "../qloo/shared";
import { keys, TTL } from "../store/keys";
import { ApiFailure, hourOf } from "./errors";
import { saveIntake } from "./record";
import type { RequestContext } from "./types";

/** Intakes per visitor per hour (each costs Claude calls and up to INTAKE_CAP Qloo calls). */
export const INTAKES_PER_HOUR = 6;
/** Intakes per day for everyone, as a multiple of the live-run cap: most intakes lead to a run. */
export const INTAKES_PER_RUN = 4;

export interface IntakeDeps {
  client: QlooClient;
  model: LanguageModel;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  /** Tests replace the page reader. */
  read?: (url: string) => Promise<PageRead>;
  /** Random hex for ids; tests make it fixed. */
  randomHex?: (bytes: number) => string;
}

export const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

const firstSentence = (text: string) => (text.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? text).trim();
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
/** A lowercase slug of at most 48 characters, cut first and trimmed after, so it never ends in a dash. */
export const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "") || "product";

/** The product as the run will use it: the page's facts first, the founder's description as the fallback. */
export function productFrom(input: { description?: string; brandName?: string }, page: PageRead | null): ProductSpec {
  const read = page?.product ?? null;
  const description = [read?.description, input.description].find((t) => t && t.trim().length >= 20)?.trim() ?? read?.name ?? input.description ?? "";
  const name = clip(read?.name ?? firstSentence(input.description ?? "your product"), 120);
  const price = read?.price ? `Price: ${read.price}${read.currency ? ` ${read.currency}` : ""}.` : null;
  const look = description.length >= 20 ? clip(description, 600) : `${name}, as shown on its product page.`;
  return productSpecSchema.parse({
    slug: slugOf(name),
    name,
    brandName: input.brandName?.trim() || read?.brand?.trim() || null,
    oneLine: clip(firstSentence(description || name), 280),
    // The seller's own words: the only product facts a concept or script may state.
    sellerFacts: clip([description, price].filter(Boolean).join(" "), 2000),
    // Product photos become references once a vision check rules out people in them; until then, the look is described.
    source: { kind: "description", lookDescription: look.length >= 20 ? look : `${look} A product photo.` },
  });
}

function siteOf(reading: AudienceReading | null): IntakeResponse["site"] {
  if (!reading) return null;
  return {
    label: "Read from your site",
    ageBands: reading.ageBands.map((band) => ({ bucket: band.bucket, label: ageBandLabel(band.bucket) })),
    genderSkew: reading.genderSkew,
    place: reading.place,
    tags: reading.tags.map((tag) => ({ id: tag.id, name: tag.name, evidenceIds: tag.evidenceIds })),
  };
}

export async function runIntake(deps: IntakeDeps, raw: IntakeRequest, ctx: RequestContext): Promise<IntakeResponse> {
  const env = deps.env ?? process.env;
  if (!isLive(env)) throw new ApiFailure("off", "Live runs are off right now. The examples show a full run.", 503);
  const input = intakeRequestSchema.parse(raw);
  const now = deps.now ?? Date.now;
  const hex = deps.randomHex ?? randomHex;
  // The founder's words reach Claude as quoted data, after the guardrails (ethnicity, minors).
  const stated = input.statedCustomer ? checkText(input.statedCustomer) : [];
  if (stated.length) throw new ApiFailure("invalid", `Describe your customer by age band, place or taste, not by who they are: ${stated[0].message}`, 422);

  const used = await ctx.store.incr(keys.rate("intake", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 });
  if (used > INTAKES_PER_HOUR) throw new ApiFailure("rate_limited", "That is a lot of products in an hour. Try again a little later.", 429);
  // Intake spends live Qloo calls too, so a spent day stops it before any work.
  const caps = dailyCaps(env);
  const today = (await ctx.store.get<number>(keys.daily("qloo"))) ?? 0;
  if (today >= caps.qloo) throw new ApiFailure("daily_cap", "Today's live runs are used up. The examples still show a full run.", 503);
  // Claude's side of intake has its own daily ceiling, since cached Qloo answers never count above.
  if ((await ctx.store.incr(keys.daily("intakes"), { ttlSeconds: TTL.daily })) > caps.liveRuns * INTAKES_PER_RUN) {
    throw new ApiFailure("daily_cap", "Today's live runs are used up. The examples still show a full run.", 503);
  }

  const intakeId = `in_${hex(12)}`;
  const monthRemaining = await lastMonthRemaining(ctx.store, now());
  const { lookup } = intakeQloo(deps.client, `intake-${sha256(intakeId).slice(0, 12)}`, monthRemaining === undefined ? {} : { monthRemaining });
  const notes: string[] = [];
  const evidence = new Map<string, Evidence>();
  const keep = (list: readonly Evidence[]) => list.forEach((e) => evidence.set(e.id, e));

  const page = input.url ? await (deps.read ?? ((url) => readPage(url)))(input.url) : null;
  if (page?.blocked) notes.push(`Could not read the page: ${page.blocked.reason}${input.description ? " Used your description instead." : ""}`);
  if (!page?.product && !input.description) throw new ApiFailure("invalid", "Stoop could not read that page. Add a short description of the product.", 422);
  const product = productFrom(input, page);

  // Who the page speaks to, and who the founder says they sell to: one Claude call each.
  const copy = page && !page.blocked && page.copy.length >= MIN_READABLE_COPY ? page.copy : null;
  const [siteReading, statedReading] = await Promise.all([
    copy ? readAudience(copy, { model: deps.model, lookup, origin: "site", ...(ctx.signal ? { abortSignal: ctx.signal } : {}) }) : Promise.resolve(null),
    input.statedCustomer ? readAudience(input.statedCustomer, { model: deps.model, lookup, origin: "stated", ...(ctx.signal ? { abortSignal: ctx.signal } : {}) }) : Promise.resolve(null),
  ]);
  for (const reading of [siteReading, statedReading]) {
    if (!reading) continue;
    keep(reading.evidence);
    notes.push(...reading.notes);
  }

  const proposal = await proposeSeeds({
    product: { name: product.name, ...(product.brandName ? { brand: product.brandName } : {}), ...(page?.product?.category ? { category: page.product.category } : {}), description: product.sellerFacts ?? product.oneLine },
    ...(page && !page.blocked ? { page } : {}),
    model: deps.model,
    lookup,
    ...(ctx.signal ? { abortSignal: ctx.signal } : {}),
  });
  keep(proposal.evidence);
  notes.push(...proposal.notes);
  const seeds = proposal.seeds.map(toReportSeed);

  await saveIntake(ctx.store, {
    intakeId,
    createdAt: new Date(now()).toISOString(),
    product,
    region: input.region,
    statedCustomer: input.statedCustomer ?? null,
    site: siteReading ? toStatedAudience(siteReading) : null,
    stated: statedReading ? toStatedAudience(statedReading) : null,
    seeds,
    evidence: [...evidence.values()],
  });

  return {
    intakeId,
    product,
    site: siteOf(siteReading),
    blocked: page?.blocked ?? null,
    seeds,
    evidence: [...evidence.values()],
    notes,
  };
}
