// CSV for the founder's waitlist export. Every cell is guarded against formula injection: a spreadsheet
// runs a cell that starts with = + - @ (or a tab or carriage return before one) as a formula, so such
// a cell gets a leading apostrophe (OWASP's CSV injection advice). Cells are then quoted per RFC 4180.

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, guarded and quoted when it needs to be. Null and undefined become empty cells. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text.startsWith("'") ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text with CRLF line ends, the first row being the header. */
export function toCsv(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
