// The reviewable marketing export for an example store (scripts/export-marketing.ts): the frozen poster
// art prompt and its hash, the exact text layer, the posts, and the poster.updated and posts.ready
// payloads the example's events take once the founder approves them. Drafts stay in
// data/plans/<slug>/marketing/, never in public/: pages show demo media only after approval.
import { z } from "zod";
import { POSTER_MODEL } from "../prompts/models.config";
import { posterSchema, postsSchema, type PlanReport, type Poster, type Posts } from "./schema";
import { checkPosterPrompt } from "./poster-prompt";
import { posterText, withFrontConcept } from "./poster-text";
import { instagramCopy, whatsappMessage } from "./share";

export const MARKETING_EXPORT_VERSION = 1;
/** Background renders allowed per example store, ever (drafts included). */
export const MAX_DRAFT_RENDERS = 2;

export const draftSchema = z.strictObject({
  /** File names inside data/plans/<slug>/marketing/. */
  file: z.string().regex(/^poster-bg-[0-9a-f]{12}\.(?:png|jpg|webp)$/),
  previews: z.array(z.string().regex(/^poster-preview-[0-9a-f]{12}-(?:portrait|og)\.png$/)),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  modelId: z.string().min(1),
  renderedAt: z.iso.datetime(),
});
export type Draft = z.infer<typeof draftSchema>;

export const marketingExportSchema = z.strictObject({
  version: z.literal(MARKETING_EXPORT_VERSION),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  id: z.string().min(1),
  generatedAt: z.iso.datetime(),
  writer: z.strictObject({ source: z.enum(["claude", "fallback"]), modelId: z.string().nullable(), attempts: z.number().int().nonnegative(), refusedFor: z.array(z.string()) }),
  /** The two event payloads, in order (an event takes seq and at when it is appended). */
  events: z.tuple([z.strictObject({ type: z.literal("poster.updated"), poster: posterSchema }), z.strictObject({ type: z.literal("posts.ready"), posts: postsSchema })]),
  drafts: z.array(draftSchema).max(MAX_DRAFT_RENDERS),
  /** An A/B test's variant B, when it runs a second concept: its own poster prompt and posts. */
  variantB: z.strictObject({ conceptId: z.string().min(1), poster: posterSchema, posts: postsSchema }).optional(),
});
export type MarketingExport = z.infer<typeof marketingExportSchema>;

const fence = (text: string) => ["```text", text, "```"].join("\n");

export function marketingMarkdown(report: Pick<PlanReport, "inputs" | "plan" | "local" | "meta">, exported: MarketingExport): string {
  const [{ poster }, { posts }] = exported.events;
  const text = posterText(report);
  const issues = checkPosterPrompt(poster.prompt, report);
  return [
    `# Marketing drafts: ${report.inputs.store.name} (${exported.id})`,
    "",
    "Not public. Nothing here is shown on a page until the founder approves it: the background drafts stay in this folder, and the coordinator copies an approved one into public/ and points the poster at it.",
    "",
    "## Poster",
    "",
    `- Background model: ${POSTER_MODEL.displayName}, \`${POSTER_MODEL.endpoint}\`, ${POSTER_MODEL.aspectRatio} at ${POSTER_MODEL.resolution}, about $${POSTER_MODEL.usdPerImage.toFixed(2)} per image (verified ${POSTER_MODEL.verifiedAt}: ${POSTER_MODEL.sourceUrls[0]})`,
    `- promptHash: \`${poster.promptHash}\``,
    `- Poster check: ${issues.length === 0 ? "passes (no names, no numbers, no text, no logos, no people)" : `FAILS: ${issues.map((i) => i.message).join("; ")}`}`,
    `- Status in the payload: ${poster.status}${poster.reason ? ` (${poster.reason})` : ""}`,
    "",
    "### Background prompt (frozen)",
    "",
    fence(poster.prompt),
    "",
    "### Text layer (set by code, exact)",
    "",
    `- Title: ${text.title}`,
    `- Date: ${text.date}`,
    `- Time: ${text.time}`,
    `- Store: ${text.store}`,
    `- Address: ${text.address}`,
    ...(text.offers.length ? text.offers.map((o, i) => `- Offer ${i + 1} (verbatim): ${o}`) : ["- Offers: none"]),
    `- Small line: ${text.disclaimer ?? "none"}`,
    `- Alt text: ${poster.alt}`,
    "",
    "### Background drafts",
    "",
    ...(exported.drafts.length
      ? exported.drafts.map((d) => `- \`${d.file}\` (sha256 \`${d.sha256.slice(0, 16)}...\`, ${d.modelId}, ${d.renderedAt}); previews: ${d.previews.map((p) => `\`${p}\``).join(", ")}`)
      : ["- None rendered yet (`scripts/render-poster.ts`, at most 2 per store)."]),
    "",
    `## Posts (written by ${exported.writer.source === "claude" ? `Claude, ${exported.writer.modelId ?? "model unknown"}, ${exported.writer.attempts} attempt${exported.writer.attempts === 1 ? "" : "s"}` : "the plain template"})`,
    ...(exported.writer.refusedFor.length ? ["", "Refused answers failed:", ...exported.writer.refusedFor.map((r) => `- ${r}`)] : []),
    "",
    "### Facebook",
    "",
    fence(posts.facebook.text),
    "",
    "### Instagram (caption and hashtags, copied as one)",
    "",
    fence(instagramCopy(posts)),
    "",
    "### WhatsApp (the event link is added at share time)",
    "",
    fence(whatsappMessage(posts.whatsapp.text, `<site>/e/${exported.id}`)),
    "",
    ...(exported.variantB ? variantLines(report, exported.variantB) : []),
    "## To approve",
    "",
    "1. Read the posts: names only from the plan's Qloo refs, offers word for word, no invented facts.",
    "2. Pick one background draft (or none: the plain background is fine) and check it has no text, logos or people.",
    `3. The coordinator copies the approved draft into public/ and sets the poster payload to status "ready" with its absolute URL, then appends both payloads to the example's events.`,
    "",
  ].join("\n");
}

function variantLines(report: Pick<PlanReport, "inputs" | "plan" | "local" | "meta">, b: NonNullable<MarketingExport["variantB"]>): string[] {
  const text = posterText(withFrontConcept(report, b.conceptId));
  return [
    `## Variant B (concept \`${b.conceptId}\`, for the A/B test)`,
    "",
    `- Title on its poster: ${text.title}`,
    `- promptHash: \`${b.poster.promptHash}\``,
    "",
    fence(b.poster.prompt),
    "",
    "### Facebook (B)",
    "",
    fence(b.posts.facebook.text),
    "",
    "### Instagram (B)",
    "",
    fence(instagramCopy(b.posts)),
    "",
    "### WhatsApp (B)",
    "",
    fence(b.posts.whatsapp.text),
    "",
  ];
}

/** The poster payload for an example before approval: prompt frozen, plain background. */
export function pendingPoster(poster: Pick<Poster, "prompt" | "promptHash" | "alt">, reason: string): Poster {
  return { status: "skipped", prompt: poster.prompt, promptHash: poster.promptHash, alt: poster.alt, reason };
}

export function exportOf(input: { slug: string; generatedAt: string; writer: MarketingExport["writer"]; poster: Poster; posts: Posts; drafts?: Draft[]; variantB?: MarketingExport["variantB"] }): MarketingExport {
  return marketingExportSchema.parse({
    version: MARKETING_EXPORT_VERSION,
    slug: input.slug,
    id: `ex-${input.slug}`,
    generatedAt: input.generatedAt,
    writer: input.writer,
    events: [
      { type: "poster.updated", poster: input.poster },
      { type: "posts.ready", posts: input.posts },
    ],
    drafts: input.drafts ?? [],
    ...(input.variantB ? { variantB: input.variantB } : {}),
  });
}
