// What a world shows right now. After a "Not this vibe" revision, the newest revision with a pack
// replaces the world's own concepts, pack and kit; frames show only next to the pack they came from.
import type { ConceptSet, Control, Kit, World } from "../world";
import type { ProductionPack } from "../../prompts/pack";

export interface CurrentParts {
  /** The revision on show, or null for the world's own brief (and always for the Control). */
  revisionId: string | null;
  concepts: ConceptSet | null;
  pack: ProductionPack | null;
  kit: Kit | null;
}

export function currentWorld(world: World): CurrentParts {
  const revision = world.revisions.findLast((r) => r.pack !== null);
  if (revision) return { revisionId: revision.id, concepts: revision.concepts, pack: revision.pack, kit: revision.kit };
  return { revisionId: null, concepts: world.concepts, pack: world.pack, kit: world.kit };
}

export function currentControl(control: Control): CurrentParts {
  return { revisionId: null, concepts: control.concepts, pack: control.pack, kit: control.kit };
}

/** The kept concept: the pack's when there is one (the pack freezes it), else the concept set's best. */
export function keptConcept(parts: CurrentParts) {
  return parts.pack?.concept ?? parts.concepts?.best.concept ?? null;
}
