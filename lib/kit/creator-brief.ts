// A one-page brief per concept world that a brand can hand to a UGC creator it hires (plan 13.5):
// the kind of creator to recruit, 3 hooks to try, the details to hit and to avoid, and the
// disclosure rules. The creator profile is an interpreted cue built from the world's creators field
// (Qloo person and podcast affinities, measured for the whole audience), so it carries their
// receipts; with no sources there is no profile and no brief. It never names a creator (the names
// stay in the receipts) and never asks for a real person's likeness. Zero Qloo calls.
//
// Disclosure sources (read Oct 16, 2026):
//   https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers (disclose in
//     the video itself, in simple words such as "ad"; #ad is fine; a platform's tool alone may not be
//     enough; audio plus on-screen text is noticed more)
//   https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
//     (no testimonials that misrepresent who is speaking or whether they used the product)
import { checkText } from "../guardrails";
import type { BriefSlots } from "../prompts/brief";
import { creatorBriefSchema, type ConceptSet, type CreatorBrief, type CultureFieldResult } from "../report/world";

export const CREATOR_DISCLOSURE =
  "Disclose the paid partnership in the video itself, out loud and on screen: \"ad\" or #ad works. " +
  "Also turn on the platform's paid-partnership or branded-content label; the label alone may not be enough (FTC). " +
  "Speak as the brand's partner: present the brand's lines as the brand's, not as your own review, and claim only what the brand states (FTC rule on reviews and testimonials, Aug 2024). " +
  "Keep the platform's AI label on any AI-made footage.";

const AVOID_ALWAYS = "Copying a real person's look or voice, and any third-party logo";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The profile text: the culture stage's own wording when it names no one, else a plain template. */
function profileText(creators: CultureFieldResult): string {
  const names = creators.sources.map((source) => source.name);
  const worded = creators.cues.find((cue) => (cue.origin === "qloo" || cue.origin === "interpreted") && checkText(cue.text, { names }).length === 0);
  const people = creators.sources.filter((s) => s.type === "urn:entity:person").length;
  const podcasts = creators.sources.filter((s) => s.type === "urn:entity:podcast").length;
  const measured = [people ? plural(people, "person", "people") : null, podcasts ? plural(podcasts, "podcast", "podcasts") : null].filter(Boolean).join(" and ");
  const scope = creators.scope === "audience" ? "this product's whole taste neighborhood" : "this world";
  const base = worded
    ? worded.text.trim().replace(/[.!?]+$/, "")
    : `A creator whose own audience overlaps ${scope}: Qloo measured an affinity for ${measured || plural(creators.sources.length, "creator", "creators")} among these people (the receipts list them)`;
  return `${base}. Recruit someone with a similar format and tone in their own voice, never someone asked to imitate a real person.`;
}

export interface CreatorBriefInput {
  brief: BriefSlots;
  /** The world's creators field (person and podcast affinities), or null when the world has none. */
  creators: CultureFieldResult | null;
  concepts: ConceptSet;
}

export function creatorBrief({ brief, creators, concepts }: CreatorBriefInput): CreatorBrief | null {
  if (creators && creators.field !== "creators") throw new Error(`A creator brief is built from the creators field, not "${creators.field}".`);
  if (!creators || creators.signal === "none" || creators.sources.length === 0) return null;
  const receipts = [...new Set([...creators.sources.flatMap((s) => s.evidenceIds), ...creators.cues.flatMap((c) => c.evidenceIds)])];

  // The kept concept's hook first, then the ranked ones, then the brief's own hook ideas. Discarded concepts never.
  const hooks = [
    concepts.best.concept.hook,
    ...concepts.others.filter((c) => c.status === "ranked").map((c) => c.concept.hook),
    ...brief.hooks.map((cue) => cue.text),
  ];
  // One line per brief field, settings joined, so all six fit and no craft cue is cut.
  const hit = [
    `Mood: ${brief.mood.text}`,
    `Voice: ${brief.voice.tone.text}`,
    `Music feel: ${brief.music.text}`,
    `Look: ${brief.visual.text}`,
    `${brief.setting.length > 1 ? "Settings" : "Setting"}: ${brief.setting.map((cue) => cue.text).join("; ")}`,
    ...(brief.wardrobe ? [`Wardrobe: ${brief.wardrobe.text}`] : []),
  ];
  return creatorBriefSchema.parse({
    profile: { text: profileText(creators), origin: "interpreted", evidenceIds: receipts },
    hooks: [...new Set(hooks)].slice(0, 3),
    hit,
    avoid: [...new Set([...brief.voice.avoid, AVOID_ALWAYS])].slice(0, 6),
    disclosure: CREATOR_DISCLOSURE,
  });
}
