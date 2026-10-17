// Craft: turns a world's guarded Culture Brief into the two shapes the rest of the run uses, with
// origins and signal levels decided by code, never by the model.
//   BriefSlots   what the concept writer and the prompt templates read (lib/prompts/brief.ts)
//   culture      the report's per-field view: signal, the Qloo sources behind it, the cues
// A cue that rests on Qloo candidates is `interpreted` (LLM wording that cites Qloo items) and
// carries their receipts; tempo, camera and lens are never higher than that. A field with no valid
// cite shows "No Qloo signal": required brief slots then carry a creative suggestion, labeled as
// not from Qloo. Hooks and the product's role are always creative.
import type { BriefSlots } from "../prompts/brief";
import type { AgeBucket } from "../qloo/constants";
import { STRONG_SHARE } from "../data-check/score";
import type { CultureField, CultureFieldResult, CultureSource, SettingCity } from "../report/world";
import { ageBandLabel, type Cue } from "../types";
import type { GuardedBrief, GuardedCue } from "../agent/grounding";
import type { CultureCandidate } from "./culture";

/** A cue's receipts: every ledger id behind the candidates it cites. */
const receiptsOf = (cites: readonly CultureCandidate[]) => [...new Set(cites.flatMap((c) => c.evidenceIds))];

const interpreted = (cue: GuardedCue): Cue => ({ text: cue.text, origin: "interpreted", evidenceIds: receiptsOf(cue.cites) });
const creative = (text: string): Cue => ({ text, origin: "creative", evidenceIds: [] });

/** A cited cue, or a creative one when nothing it cites survived (or the cue itself was dropped). */
function slotCue(cue: GuardedCue | null, fallback: string): Cue {
  if (cue && cue.cites.length > 0) return interpreted(cue);
  return creative(cue?.text ?? fallback);
}

/** A strong source beats at least 75% of the panel; a place is strong when Qloo explained it. */
const strong = (c: CultureCandidate) => (c.position ? c.position.of > 0 && c.position.beats / c.position.of >= STRONG_SHARE : c.field === "setting" ? c.why.length > 0 : c.field === "creators");

/** rich: 3 or more strong sources; thin: any cited source; none: nothing Qloo backs. */
export function signalOf(cites: readonly CultureCandidate[]): CultureFieldResult["signal"] {
  if (cites.length === 0) return "none";
  return cites.filter(strong).length >= 3 ? "rich" : "thin";
}

const source = (c: CultureCandidate): CultureSource => ({
  kind: c.kind,
  id: c.id,
  name: c.name,
  type: c.type,
  rank: c.rank,
  position: c.position,
  why: c.why.slice(0, 3),
  evidenceIds: c.evidenceIds,
});

export interface CraftInput {
  segmentId: string;
  label: string;
  bucket: AgeBucket;
  brief: GuardedBrief;
  settingCity: SettingCity | null;
  /** The product's one line, for creative fallbacks. */
  productLine: string;
}

export interface Crafted {
  brief: BriefSlots;
  culture: CultureFieldResult[];
  richSlots: string[];
}

export function craftWorld(input: CraftInput): Crafted {
  const g = input.brief;
  const settings = g.setting.length > 0 ? g.setting : [];
  const brief: BriefSlots = {
    segment: { id: input.segmentId, label: input.label, ageBands: [input.bucket] },
    productRole: creative(g.productRole ?? input.productLine),
    mood: slotCue(g.mood, `${ageBandLabel(input.bucket)} everyday warmth`),
    music: slotCue(g.music, "an unobtrusive instrumental bed"),
    visual: slotCue(g.visual, "natural light, simple framing"),
    wardrobe: g.wardrobe ? slotCue(g.wardrobe, g.wardrobe.text) : null,
    setting: settings.length ? settings.map((s) => slotCue(s, s.text)) : [creative("an everyday space where the product is used")],
    voice: { tone: slotCue(g.voice.tone, "plain and warm"), use: g.voice.use, avoid: g.voice.avoid },
    talent: g.talent ? slotCue(g.talent, g.talent.text) : null,
    hooks: g.hooks.map(creative),
    allowedPlaces: input.settingCity && settings.some((s) => s.cites.length > 0) ? [input.settingCity.label] : [],
  };

  const field = (name: CultureField, cues: (GuardedCue | null)[], briefCues: Cue[], scope: "segment" | "audience" = "segment"): CultureFieldResult => {
    const cites = [...new Map(cues.flatMap((c) => c?.cites ?? []).map((c) => [c.id, c])).values()];
    const signal = signalOf(cites);
    // With no signal, only creative cues may show (labeled "Creative suggestion (not from Qloo)").
    const shown = signal === "none" ? briefCues.filter((c) => c.origin === "creative") : briefCues;
    return { field: name, signal, scope, sources: cites.map(source), cues: shown.slice(0, 3) };
  };
  const culture: CultureFieldResult[] = [
    field("music", [g.music], [brief.music]),
    field("visual", [g.visual], [brief.visual]),
    field("wardrobe", [g.wardrobe], brief.wardrobe ? [brief.wardrobe] : []),
    field("setting", settings, brief.setting),
    field("mood", [g.mood], [brief.mood]),
    field("voice", [g.voice.tone], [brief.voice.tone]),
    field("creators", [g.creators], g.creators && g.creators.cites.length ? [interpreted(g.creators)] : [], "audience"),
  ];

  const rich = new Set(culture.filter((f) => f.signal === "rich").map((f) => f.field));
  const richSlots = [
    ...(rich.has("music") && brief.music.origin === "interpreted" ? ["music"] : []),
    ...(rich.has("visual") && brief.visual.origin === "interpreted" ? ["visual"] : []),
    ...(rich.has("wardrobe") && brief.wardrobe?.origin === "interpreted" ? ["wardrobe"] : []),
    ...(rich.has("setting") ? brief.setting.flatMap((cue, i) => (cue.origin === "interpreted" ? [`setting.${i}`] : [])) : []),
    ...(rich.has("mood") && brief.mood.origin === "interpreted" ? ["mood"] : []),
    ...(rich.has("voice") && brief.voice.tone.origin === "interpreted" ? ["voice.tone"] : []),
  ];
  return { brief, culture, richSlots };
}
