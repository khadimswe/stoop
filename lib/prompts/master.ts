// The platform-neutral shot list: a plain-text version of the concept that a person can read, edit
// in their head, and hand to any tool or crew. It is not sent to a model, so it is not hashed.
import { CAMERA_PRESETS, ENERGY_PRESETS, LOOK_PRESETS } from "./models.config";
import type { BriefSlots, Concept, PackSettings, ProductSpec } from "./brief";
import { timecodes, type ResolvedCast } from "./lines";

export function renderShotList(product: ProductSpec, brief: BriefSlots, concept: Concept, settings: PackSettings, cast: ResolvedCast): string {
  const spans = timecodes(concept);
  const { direction } = settings;
  const lines = [
    `PRODUCT: ${product.brandName ? `${product.brandName}, ` : ""}${product.name}. ${product.oneLine}`,
    `AUDIENCE: ${brief.segment.label}`,
    `FORMAT: vertical ${settings.aspect}, ${settings.seconds} s, Meta Reels and TikTok`,
    `CAST: ${cast === "adult_talent" ? "fictional adult talent" : cast === "pet" ? "a real-behaving pet" : "product only"}`,
    `CONCEPT: ${concept.title}. Feeling: ${concept.emotion}. Surprise beat: ${concept.surpriseBeat}`,
    `HOOK: ${concept.hook}`,
    ...concept.scenes.map((scene, index) => {
      const { start, end } = spans[index];
      return `SHOT ${index + 1} (${start}-${end}s, ${scene.beat}): ${scene.action} | ${scene.framing} | camera: ${CAMERA_PRESETS[scene.camera].label} | at: ${scene.location}${scene.overlayText ? ` | overlay: "${scene.overlayText}"` : ""}${scene.dialogue ? ` | says: "${scene.dialogue}"` : ""}`;
    }),
    `MOOD: ${brief.mood.text}`,
    `LOOK: ${direction.look === "auto" ? "from the brief" : LOOK_PRESETS[direction.look].label}; ${brief.visual.text}`,
    `ENERGY: ${direction.energy === "auto" ? "from the concept" : ENERGY_PRESETS[direction.energy].label}`,
    `SETTING: ${brief.setting.map((cue) => cue.text).join("; ")}`,
    brief.wardrobe ? `WARDROBE: ${brief.wardrobe.text}` : null,
    `MUSIC: ${brief.music.text}; original instrumental, no lyrics, no real songs`,
    `VOICE: ${brief.voice.tone.text}; use: ${brief.voice.use.join(", ") || "-"}; avoid: ${brief.voice.avoid.join(", ") || "-"}`,
    `OVERLAY TEXT (added in the edit): ${concept.scenes.map((scene) => scene.overlayText).filter(Boolean).join(" / ") || "-"}`,
  ];
  return lines.filter(Boolean).join("\n");
}
