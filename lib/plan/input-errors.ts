// Bad input to the plan routes (POST /api/plan, POST /api/plan/block) is the visitor's to fix, never a
// server error: it answers 400 (422 for notes the guard refuses) in the API's error shape, with one
// plain sentence and the field it is about, so the form can show it on the right input:
//   { "error": { "code": "invalid", "message": "Enter the phone as 10 digits, like 312-555-0142." }, "field": "phone" }
// The client reads error.message (lib/plan/view/live.ts apiMessageOf) and, when present, `field`.
// Nothing here is logged: a typo is not an incident.
import { ZodError } from "zod";

/** The input fields a message can point at: the plan contract's keys (lib/plan/schema.ts inputsSchema). */
export type InputField =
  | "id"
  | "name"
  | "carrier"
  | "address"
  | "city"
  | "region"
  | "phone"
  | "storeNumber"
  | "point"
  | "date"
  | "startTime"
  | "durationMinutes"
  | "setting"
  | "location"
  | "budgetUsd"
  | "offers"
  | "ageBands"
  | "notes";

const MESSAGES: Record<InputField, string> = {
  id: "That store could not be read. Pick it again.",
  name: "Give the store's name, up to 80 characters.",
  carrier: "Pick the carrier: Metro, Cricket, Boost or other.",
  address: "Give the store's street address, up to 200 characters.",
  city: "Give the store's city, up to 80 characters.",
  region: "Give the store's state, up to 40 characters.",
  phone: "Enter the phone as 10 digits, like 312-555-0142.",
  storeNumber: "Keep the store number to 24 characters.",
  point: "Drop the pin on the store's door, or use your location.",
  date: "Pick the event day.",
  startTime: "Pick a start time.",
  durationMinutes: "Pick how long the event runs, from 30 minutes to 8 hours.",
  setting: "Pick where the event happens.",
  location: "Give the event's place a name and a pin, or leave it out.",
  budgetUsd: "Set a budget in whole dollars, from $0 to $5,000.",
  offers: "Add up to 8 promos, each up to 140 characters.",
  ageBands: "Pick one to three age bands.",
  notes: "Keep your notes to 280 characters.",
};

const FALLBACK = "Check the form and try again.";

/** A refusal of the visitor's input, with the field it is about when there is one. */
export class InputProblem extends Error {
  override name = "InputProblem";
  constructor(
    message: string,
    readonly field: InputField | null = null,
    /** 400 for a field; 413 too large and 415 not sent as JSON (lib/http.ts readJson); 422 for notes the guard refuses. */
    readonly status: 400 | 413 | 415 | 422 = 400,
  ) {
    super(message);
  }
}

/** The field a zod issue path points at: a container first (an offer's text is "offers", a pin's lat is "point"). */
function fieldOf(path: readonly PropertyKey[]): InputField | null {
  const keys = path.filter((key): key is string => typeof key === "string");
  for (const container of ["location", "offers", "point", "ageBands"] as const) if (keys.includes(container)) return container;
  const last = keys.at(-1);
  return last && last in MESSAGES ? (last as InputField) : null;
}

/** A zod failure as one plain sentence about its first field. */
export function inputProblemOf(error: ZodError): InputProblem {
  const issue = error.issues[0];
  const field = issue ? fieldOf(issue.path) : null;
  return new InputProblem(field ? MESSAGES[field] : FALLBACK, field);
}

/** The 400 (or 422) answer for bad input: the API's error shape plus `field`. */
export function inputProblemResponse(problem: InputProblem): Response {
  return Response.json({ error: { code: "invalid", message: problem.message }, ...(problem.field ? { field: problem.field } : {}) }, { status: problem.status, headers: { "Cache-Control": "no-store" } });
}

/** The answer for an input error (a zod failure or an InputProblem), or null for anything else. */
export function inputErrorResponse(error: unknown): Response | null {
  if (error instanceof InputProblem) return inputProblemResponse(error);
  if (error instanceof ZodError) return inputProblemResponse(inputProblemOf(error));
  return null;
}
