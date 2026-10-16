import { describe, expect, it } from "vitest";
import { INTAKE_CAP } from "../qloo/budget";
import { createQlooClient } from "../qloo/client";
import { QlooBudgetError } from "../qloo/errors";
import { FixtureCache, findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { tagsResponse } from "../qloo/types";
import { INTAKE_STAGE, intakeQloo } from "./qloo";
import { tagRequest } from "./tags";

describe("intakeQloo", () => {
  it("gives an intake its own context, capped at INTAKE_CAP, labeled under the intake stage", async () => {
    const { ctx, lookup } = intakeQloo(createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) }), "intake-test");
    expect(ctx.cap).toBe(INTAKE_CAP);
    const request = tagRequest("general", "hot sauce");
    if (!request) throw new Error("no request");
    const { evidence } = await lookup(request, tagsResponse);
    expect(evidence).toMatchObject({ stage: INTAKE_STAGE, label: 'Finding a Qloo tag for "hot sauce"', cached: true });
    expect(ctx.liveCalls).toBe(0);
  });

  it("stops live calls at the cap", async () => {
    // A stub transport that answers every call with one real recorded /v2/tags body; nothing goes out.
    const file = findFixture("probe-search");
    if (!file) throw new Error("probe-search fixture missing");
    const body = JSON.stringify(recorded(readFixtureFile(file), "tags-hot-sauce").body);
    const client = createQlooClient({
      apiKey: "test-key",
      fetch: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
      sleep: async () => {},
    });
    const { ctx, lookup } = intakeQloo(client, "intake-cap-test");
    const request = tagRequest("general", "hot sauce");
    if (!request) throw new Error("no request");
    for (let call = 0; call < INTAKE_CAP; call++) await lookup(request, tagsResponse);
    expect(ctx.liveCalls).toBe(INTAKE_CAP);
    await expect(lookup(request, tagsResponse)).rejects.toBeInstanceOf(QlooBudgetError);
  });
});
