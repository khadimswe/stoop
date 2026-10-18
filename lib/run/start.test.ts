import { describe, expect, it, vi } from "vitest";
import { intakeRequestSchema, runStartRequestSchema } from "../api/requests";
import { REPLAY_REASONS, runStartResponseSchema } from "../api/responses";
import { EXAMPLES } from "../demo/examples";
import {
  callApi,
  checkDescription,
  checkRegion,
  EXAMPLE_CHIPS,
  exampleSlugOf,
  intakeBody,
  isReplayReason,
  normalizeLink,
  readApiError,
  REPLAY_NOTES,
  reportHref,
  runBody,
  searchUrl,
  singleFlight,
  startHref,
} from "./start";

const RUN_ID = `run_${"a1".repeat(12)}`;
const INTAKE_ID = `in_${"b2".repeat(12)}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the link field", () => {
  it("adds https:// to a pasted address and keeps what the API accepts", () => {
    for (const [raw, url] of [
      ["porchlight.example/products/red", "https://porchlight.example/products/red"],
      ["  https://shop.example.com/products/a?variant=2  ", "https://shop.example.com/products/a?variant=2"],
      ["http://shop.example.com", "http://shop.example.com/"],
    ]) {
      const checked = normalizeLink(raw);
      expect(checked).toEqual({ ok: true, value: url });
      expect(intakeRequestSchema.safeParse({ url }).success).toBe(true);
    }
  });

  it("says plainly what is wrong with anything else", () => {
    expect(normalizeLink("")).toEqual({ ok: false, message: "Paste a store or product link." });
    for (const raw of ["not a link", "localhost", "shop", "ftp://shop.example.com/file"]) expect(normalizeLink(raw).ok, raw).toBe(false);
    expect(normalizeLink(`https://shop.example.com/${"a".repeat(2100)}`)).toMatchObject({ ok: false, message: expect.stringContaining("too long") });
  });
});

describe("step 1", () => {
  it("asks for a description of 20 characters or more", () => {
    expect(checkDescription("Hot sauce")).toMatchObject({ ok: false });
    expect(checkDescription("  A fermented red chile hot sauce, $14.  ")).toEqual({ ok: true, value: "A fermented red chile hot sauce, $14." });
    expect(checkDescription("x".repeat(2001))).toMatchObject({ ok: false });
  });

  it("needs a region Qloo can place", () => {
    expect(checkRegion(" Texas ")).toEqual({ ok: true, value: "Texas" });
    expect(checkRegion("x").ok).toBe(false);
  });

  it("sends the link, or the description with a blocked link kept, in the API's shape", () => {
    const link = intakeBody({ mode: "link", link: "porchlight.example/products/red", description: "", region: "United States" });
    expect(link).toEqual({ ok: true, value: { url: "https://porchlight.example/products/red", region: "United States" } });
    const described = intakeBody({ mode: "describe", link: "porchlight.example/products/red", description: "A fermented red chile hot sauce, small batch.", region: "Texas" });
    expect(described).toEqual({ ok: true, value: { url: "https://porchlight.example/products/red", description: "A fermented red chile hot sauce, small batch.", region: "Texas" } });
    for (const body of [link, described]) if (body.ok) expect(intakeRequestSchema.parse(body.value)).toMatchObject(body.value);
    expect(intakeBody({ mode: "link", link: "", description: "", region: "United States" })).toMatchObject({ ok: false });
  });
});

describe("step 2", () => {
  it("starts a run on 2 to 8 distinct seeds, with an empty stated customer sent as null", () => {
    expect(runBody({ intakeId: INTAKE_ID, seedIds: ["a"], statedCustomer: "", region: "United States" })).toMatchObject({ ok: false });
    expect(runBody({ intakeId: INTAKE_ID, seedIds: Array.from({ length: 9 }, (_, i) => `s${i}`), statedCustomer: "", region: "United States" })).toMatchObject({ ok: false });
    const body = runBody({ intakeId: INTAKE_ID, seedIds: ["a", "b", "a"], statedCustomer: "  ", region: "United States" });
    expect(body).toEqual({ ok: true, value: { intakeId: INTAKE_ID, seedIds: ["a", "b"], statedCustomer: null, region: "United States" } });
    if (body.ok) expect(runStartRequestSchema.safeParse(body.value).success).toBe(true);
    expect(runBody({ intakeId: INTAKE_ID, seedIds: ["a", "b"], statedCustomer: "x".repeat(281), region: "United States" })).toMatchObject({ ok: false });
  });
});

describe("calling the API", () => {
  it("reads the API's error shape and nothing else", () => {
    expect(readApiError(503, { error: { code: "off", message: "Live runs are off right now." } })).toEqual({ ok: false, status: 503, code: "off", message: "Live runs are off right now." });
    expect(readApiError(500, "<html>")).toMatchObject({ code: "failed", message: expect.stringContaining("examples still work") });
    expect(readApiError(400, { error: { code: "weird", message: "" } })).toMatchObject({ code: "failed" });
  });

  it("returns the data, the refusal, or a plain network failure", async () => {
    await expect(callApi(async () => json({ position: 3 }), "/api/x")).resolves.toEqual({ ok: true, data: { position: 3 } });
    await expect(callApi(async () => json({ error: { code: "busy", message: "Busy." } }, 503), "/api/x")).resolves.toMatchObject({ ok: false, code: "busy", status: 503 });
    await expect(
      callApi(async () => {
        throw new TypeError("Failed to fetch");
      }, "/api/x"),
    ).resolves.toMatchObject({ ok: false, code: "network", status: 0 });
  });

  it("builds the search URL with the intake, the query and the type", () => {
    expect(searchUrl({ intakeId: INTAKE_ID, q: " Hot Ones ", type: "tv_show" })).toBe(`/api/search?intakeId=${INTAKE_ID}&q=Hot+Ones&type=tv_show`);
  });

  it("never starts twice from a double click: the second call joins the first", async () => {
    let resolve!: (value: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const start = singleFlight(fn);
    const first = start();
    const second = start();
    expect(second).toBe(first);
    resolve("run");
    await expect(Promise.all([first, second])).resolves.toEqual(["run", "run"]);
    expect(fn).toHaveBeenCalledTimes(1);
    // Once it settled, the next click starts a new call.
    const third = start();
    resolve("again");
    await expect(third).resolves.toBe("again");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("where a start lands", () => {
  it("goes to the live trace, or to the example's replay with its reason", () => {
    const live = runStartResponseSchema.parse({ mode: "live", runId: RUN_ID, eventsUrl: `/api/run/${RUN_ID}/events`, reportUrl: `/report/${RUN_ID}`, joined: false });
    expect(startHref(live)).toBe(`/run/${RUN_ID}`);
    const example = runStartResponseSchema.parse({ mode: "example", slug: "food-hot-sauce", reason: "busy", message: "Busy." });
    expect(startHref(example)).toBe("/run/example-food-hot-sauce?why=busy");
  });

  it("has a plain note for every replay reason, and checks the reason it is given", () => {
    expect(Object.keys(REPLAY_NOTES).sort()).toEqual([...REPLAY_REASONS].sort());
    expect(isReplayReason("busy")).toBe(true);
    expect(isReplayReason("<script>")).toBe(false);
    expect(isReplayReason("toString")).toBe(false);
  });

  it("opens the finished report: the example's own page, or the live run's", () => {
    expect(exampleSlugOf("example-home-candles")).toBe("home-candles");
    expect(exampleSlugOf("example-nope")).toBeNull();
    expect(reportHref("example-pets-outfits")).toBe("/examples/pets-outfits");
    expect(reportHref(RUN_ID)).toBe(`/report/${RUN_ID}`);
  });

  it("offers every shipped example as a chip", () => {
    expect(EXAMPLE_CHIPS.map((c) => c.slug)).toEqual(EXAMPLES.map((e) => e.slug));
    for (const chip of EXAMPLE_CHIPS) expect(chip.label).toBeTruthy();
  });
});
