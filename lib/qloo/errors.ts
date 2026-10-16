import type { Endpoint } from "./constants";

export class QlooError extends Error {
  override name = "QlooError";
}

/** Raised at the first live request when no API key is configured. */
export class QlooConfigError extends QlooError {
  override name = "QlooConfigError";
}

/** Raised before any network call when params fail validation. */
export class QlooParamError extends QlooError {
  override name = "QlooParamError";
  constructor(
    readonly endpoint: Endpoint,
    readonly issues: string[],
  ) {
    super(`Invalid Qloo params for ${endpoint}: ${issues.join("; ")}`);
  }
}

export class QlooHttpError extends QlooError {
  override name = "QlooHttpError";
  constructor(
    readonly endpoint: Endpoint,
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(`Qloo ${endpoint} returned ${status}${bodySnippet ? `: ${bodySnippet}` : ""}`);
  }
}

/** Raised when a run would exceed its call cap or the monthly floor. */
export class QlooBudgetError extends QlooError {
  override name = "QlooBudgetError";
}

/** Raised when a response does not match the shape Stoop relies on. */
export class QlooShapeError extends QlooError {
  override name = "QlooShapeError";
  constructor(
    readonly endpoint: Endpoint,
    readonly issues: string[],
  ) {
    super(`Unexpected Qloo response shape from ${endpoint}: ${issues.join("; ")}`);
  }
}

/** Raised in fixtures mode (QLOO_MODE=fixtures) when a request was never recorded. No call is made. */
export class QlooFixtureMissError extends QlooError {
  override name = "QlooFixtureMissError";
  constructor(readonly request: string) {
    super(`No recorded Qloo fixture for ${request}. Record it with npm run fixtures:record -- <name>.`);
  }
}

/** Removes a secret from any text before it can reach an error, log, or file. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}
