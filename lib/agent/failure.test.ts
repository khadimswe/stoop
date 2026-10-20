import { describe, expect, it } from "vitest";
import { DAILY_CAP_MESSAGE } from "../qloo/shared";
import { QlooBudgetError, QlooHttpError } from "../qloo/errors";
import { FAILURE_MESSAGES, failureForLog, plainFailure } from "./failure";

const named = (name: string, message = "detail") => Object.assign(new Error(message), { name });

describe("plain failure messages", () => {
  it("never shows a Qloo endpoint, body or budget row to a visitor", () => {
    const http = new QlooHttpError("/v2/insights", 502, "upstream body snippet");
    expect(plainFailure(http)).toBe(FAILURE_MESSAGES.qloo);
    expect(plainFailure(http)).not.toMatch(/insights|502|snippet/);
    expect(plainFailure(new QlooBudgetError("Run run_x spent its 4 probes calls"))).toBe(FAILURE_MESSAGES.qlooBudget);
    expect(plainFailure(new QlooBudgetError(DAILY_CAP_MESSAGE))).toBe(DAILY_CAP_MESSAGE);
  });

  it("names model timeouts, store failures and everything else plainly", () => {
    expect(plainFailure(named("AI_APICallError"))).toBe(FAILURE_MESSAGES.model);
    expect(plainFailure(named("TimeoutError"))).toBe(FAILURE_MESSAGES.model);
    expect(plainFailure(named("StoreDownError"))).toBe(FAILURE_MESSAGES.store);
    expect(plainFailure(new TypeError("Cannot read properties of undefined"))).toBe(FAILURE_MESSAGES.other);
    expect(plainFailure("thrown string")).toBe(FAILURE_MESSAGES.other);
  });

  it("keeps the technical side for the server log, capped", () => {
    expect(failureForLog(named("AI_APICallError", "x".repeat(500)))).toBe(`AI_APICallError: ${"x".repeat(300)}`);
    expect(failureForLog(42)).toBe("non-error thrown");
  });
});
