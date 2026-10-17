// A refusal the API answers with (lib/api/responses.ts apiErrorSchema): a code, a plain message and
// an HTTP status. Anything else that escapes a route is a 500 with a generic message.
import type { API_ERROR_CODES } from "../api/responses";

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiFailure extends Error {
  override name = "ApiFailure";
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The hour a per-visitor limit counts in: "2026-10-17T05". */
export const hourOf = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 13);
