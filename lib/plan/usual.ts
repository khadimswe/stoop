// What most prepaid stores put outside today, as store managers describe it: the fixed reference for
// the side by side and for the A/B test's "usual" variant. It is a description from the floor, not a
// measurement, and it is labeled as one wherever it shows. Pending the founder's confirmation.
export const USUAL_TABLE = {
  label: "What most stores do today, per store managers",
  lines: [
    "A folding table by the door",
    "A speaker playing whatever is on",
    "Balloons tied to the table",
    "Store-bought snacks and water",
    "A sign with this month's promo",
  ],
  /** Set to true once the founder has confirmed the wording. */
  confirmed: false,
} as const;

/** The usual table in one sentence, for the comparison. */
export const USUAL_TABLE_LINE = "Most stores today: a folding table, a speaker, balloons, store-bought snacks and a promo sign.";
