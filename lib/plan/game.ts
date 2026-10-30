// The table game: a tabletop prize wheel (the default) or a drop board, a peg board where people drop a
// chip that bounces down and lands in one of 6 prize slots. The plan keeps the game in `plan.wheel`
// either way; these are the words each game uses, so a drop-board plan never says "spin" or "wheel",
// and a wheel plan reads exactly as it always has. A plain module (no server imports), for the UI too.
import type { PlanInputs } from "./schema";

export type TableGame = NonNullable<PlanInputs["game"]>;

/** The create screen's choice. */
export const GAME_LABELS: Readonly<Record<TableGame, string>> = { wheel: "Prize wheel", drop_board: "Drop board, 6 slots" };

/** A drop board has exactly this many slots. */
export const DROP_BOARD_SLOTS = 6;

/** The settings with a game at the table: outside, on the sidewalk or at a community event booth. */
export const settingHasGame = (setting: PlanInputs["setting"]): boolean => setting === "sidewalk_table" || setting === "community_event";

/** The game a plan's inputs pick: absent means the prize wheel. */
export const gameOf = (inputs: Pick<PlanInputs, "game"> | null | undefined): TableGame => inputs?.game ?? "wheel";

export interface GameWords {
  /** "Prize wheel" / "Drop board": tiles, receipts and headings. */
  title: string;
  /** "Wheel" / "Drop board": the event screen's section and jump label. */
  short: string;
  /** "prize wheel" / "drop board", mid-sentence. */
  noun: string;
  /** What the poster badge says in big type. */
  call: string;
  /** "Spin the prize wheel" / "Drop a chip on the drop board": the one line on the poster, the posts and the event page. */
  play: string;
  /** "Free to spin, no purchase needed." / "Free to play, no purchase needed." */
  free: string;
  /** One prize space: "slice" / "slot". */
  unit: string;
  units: string;
  /** The filler prize. */
  again: { label: string; text: string };
  /** The event screen's list label. */
  putOn: string;
  /** The event screen's note under the list. */
  order: string;
  /** The stat under "Free". */
  stat: string;
}

export const GAME_WORDS: Readonly<Record<TableGame, GameWords>> = {
  wheel: {
    title: "Prize wheel",
    short: "Wheel",
    noun: "prize wheel",
    call: "Spin the prize wheel",
    play: "Spin the prize wheel",
    free: "Free to spin, no purchase needed.",
    unit: "slice",
    units: "slices",
    again: { label: "Spin again", text: "One more free spin." },
    putOn: "Put these on your wheel",
    order: "Slices in order, clockwise from the top. A numbered pin is that place on the Community map.",
    stat: "to spin",
  },
  drop_board: {
    title: "Drop board",
    short: "Drop board",
    noun: "drop board",
    call: "Drop a chip",
    play: "Drop a chip on the drop board",
    free: "Free to play, no purchase needed.",
    unit: "slot",
    units: "slots",
    again: { label: "Drop again", text: "One more free drop." },
    putOn: "Put these in your board's slots",
    order: "Slots in order, left to right along the bottom of the board. A numbered pin is that place on the Community map.",
    stat: "to play",
  },
};

export const gameWords = (game: TableGame | null | undefined): GameWords => GAME_WORDS[game ?? "wheel"];

/**
 * The manager's promos that are not on the game, verbatim: a drop board's 6 slots can leave some off
 * (they stay on the poster and in the posts). A wheel carries every promo, so this is empty for one.
 */
export function offersLeftOff(offers: readonly { text: string }[], slices: readonly { kind: string; text: string }[]): string[] {
  const on = new Set(slices.filter((s) => s.kind === "promo").map((s) => s.text.trim()));
  return offers.map((o) => o.text).filter((text) => !on.has(text.trim()));
}

/** The plain note for promos a drop board could not fit, or null when every promo is on it. */
export function leftOffNote(leftOff: readonly string[], total: number): string | null {
  if (!leftOff.length) return null;
  const on = total - leftOff.length;
  return `The drop board has ${DROP_BOARD_SLOTS} slots, so it carries ${on === 1 ? "your first promo" : `your first ${on} promos`} of ${total}. Not on the board: ${leftOff.map((o) => `"${o}"`).join(", ")}. Every promo is still on the poster and in the posts.`;
}
