// What a visitor reads when a run fails: plain words, never an internal message. Qloo endpoints, response
// bodies, schema issues and model errors stay in the server log; the page gets one sentence that says what
// happened and what still works.
import { DAILY_CAP_MESSAGE } from "../qloo/shared";
import { QlooBudgetError, QlooError } from "../qloo/errors";

export const FAILURE_MESSAGES = {
  qlooDaily: DAILY_CAP_MESSAGE,
  qlooBudget: "This run used its share of Qloo calls before it finished. The examples still show the full flow.",
  qloo: "Qloo couldn't answer part of this run, so it stopped. The examples still show the full flow.",
  model: "The writing model didn't answer in time, so this run stopped. Try again in a minute.",
  store: "The run's records could not be saved, so it stopped. Try again in a minute.",
  other: "Something went wrong on our side, so this run stopped. The examples still show the full flow.",
} as const;

const MODEL_ERROR = /^(AI_|AbortError$|TimeoutError$)/;

/** The one plain sentence a page shows for a failed run. */
export function plainFailure(error: unknown): string {
  if (error instanceof QlooBudgetError) return error.message === DAILY_CAP_MESSAGE ? FAILURE_MESSAGES.qlooDaily : FAILURE_MESSAGES.qlooBudget;
  if (error instanceof QlooError) return FAILURE_MESSAGES.qloo;
  if (error instanceof Error) {
    if (error.name === "StoreDownError") return FAILURE_MESSAGES.store;
    if (MODEL_ERROR.test(error.name)) return FAILURE_MESSAGES.model;
  }
  return FAILURE_MESSAGES.other;
}

/** The technical side, for the server log only: the error's name and a capped message. */
export function failureForLog(error: unknown): string {
  if (!(error instanceof Error)) return "non-error thrown";
  return `${error.name}: ${error.message.slice(0, 300)}`;
}
