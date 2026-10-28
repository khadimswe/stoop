// The "Log results" form: what the manager counted after the event, as POST /api/plan/[id]/results
// takes it. Pure, so the browser and the tests check it the same way.

export interface ResultsFormValues {
  walkIns: string;
  sales: string;
  facebook: boolean;
  instagram: boolean;
  whatsapp: boolean;
  notes: string;
}

export interface ResultsBody {
  walkIns: number | null;
  sales: number | null;
  posted: { facebook: boolean; instagram: boolean; whatsapp: boolean };
  notes?: string;
}

export type ResultsField = "walkIns" | "sales" | "notes";

export const NOTES_MAX = 280;

/** A count the manager typed: blank is "not counted" (null), anything else a whole number from 0. */
function count(text: string): { value: number | null } | { error: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  if (!/^\d+$/.test(t)) return { error: "Enter a whole number, or leave it blank." };
  const n = Number(t);
  if (n > 100_000) return { error: "That looks too high. Check the number." };
  return { value: n };
}

export function parseResults(values: ResultsFormValues): { ok: true; body: ResultsBody } | { ok: false; errors: Partial<Record<ResultsField, string>> } {
  const errors: Partial<Record<ResultsField, string>> = {};
  const walkIns = count(values.walkIns);
  const sales = count(values.sales);
  if ("error" in walkIns) errors.walkIns = walkIns.error;
  if ("error" in sales) errors.sales = sales.error;
  const notes = values.notes.trim();
  if (notes.length > NOTES_MAX) errors.notes = `Keep notes to ${NOTES_MAX} characters.`;
  if ("value" in walkIns && "value" in sales && walkIns.value === null && sales.value === null && !notes && !values.facebook && !values.instagram && !values.whatsapp) {
    errors.walkIns = "Add at least one number, a channel you posted on, or a note.";
  }
  if (Object.keys(errors).length > 0 || "error" in walkIns || "error" in sales) return { ok: false, errors };
  return {
    ok: true,
    body: {
      walkIns: walkIns.value,
      sales: sales.value,
      posted: { facebook: values.facebook, instagram: values.instagram, whatsapp: values.whatsapp },
      ...(notes ? { notes } : {}),
    },
  };
}
