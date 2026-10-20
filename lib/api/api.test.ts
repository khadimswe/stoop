import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema";
import { intakeRequestSchema, lastEventIdSchema, reviseRequestSchema, runStartRequestSchema, searchRequestSchema, voteRequestSchema, waitlistRequestSchema } from "./requests";
import { reportResponseSchema, runStartResponseSchema, siteReadingSchema, voteResponseSchema } from "./responses";
import { itRecorded } from "../testing/recorded";

const intakeId = `in_${"0".repeat(24)}`;

describe("API request schemas", () => {
  it("takes a link or a description, never neither, and defaults the region", () => {
    expect(intakeRequestSchema.parse({ url: "https://porchlight.example/products/red" }).region).toBe("United States");
    expect(intakeRequestSchema.safeParse({ description: "A fermented red chile hot sauce in small batches." }).success).toBe(true);
    expect(intakeRequestSchema.safeParse({ region: "Texas" }).success).toBe(false);
    expect(intakeRequestSchema.safeParse({ url: "ftp://porchlight.example" }).success).toBe(false);
    expect(intakeRequestSchema.safeParse({ url: `https://a.example/${"x".repeat(2_100)}` }).success).toBe(false);
    expect(intakeRequestSchema.safeParse({ description: "x".repeat(2_001) }).success).toBe(false);
  });

  it("caps a run's seeds, refuses repeats and unknown fields, and caps the stated customer", () => {
    const start = { intakeId, seedIds: ["a", "b", "c"], statedCustomer: "Home cooks 25 to 40", region: "United States" };
    expect(runStartRequestSchema.parse(start).direction).toEqual({ look: "auto", cast: "auto", energy: "auto" });
    expect(runStartRequestSchema.safeParse({ ...start, seedIds: ["a"] }).success).toBe(false);
    expect(runStartRequestSchema.safeParse({ ...start, seedIds: ["a", "a"] }).success).toBe(false);
    expect(runStartRequestSchema.safeParse({ ...start, seedIds: Array.from({ length: 9 }, (_, i) => `s${i}`) }).success).toBe(false);
    expect(runStartRequestSchema.safeParse({ ...start, statedCustomer: "x".repeat(281) }).success).toBe(false);
    expect(runStartRequestSchema.safeParse({ ...start, seeds: [] }).success).toBe(false);
    expect(runStartRequestSchema.safeParse({ ...start, intakeId: "in_nothex" }).success).toBe(false);
  });

  it("takes only the seed types Prove reads from search", () => {
    expect(searchRequestSchema.safeParse({ intakeId, q: "Hot Ones", type: "tv_show" }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ intakeId, q: "Hot Ones", type: "destination" }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ intakeId, q: "H", type: "brand" }).success).toBe(false);
  });

  it("revises one cue or the whole world, with a capped reason", () => {
    const revise = { runId: `run_${"a".repeat(24)}`, segmentId: "seg-55-and-older", field: "music" };
    expect(reviseRequestSchema.parse(revise)).toMatchObject({ exclude: [], reason: "" });
    expect(reviseRequestSchema.safeParse({ ...revise, field: "world" }).success).toBe(true);
    expect(reviseRequestSchema.safeParse({ ...revise, field: "talent" }).success).toBe(false);
    expect(reviseRequestSchema.safeParse({ ...revise, reason: "x".repeat(281) }).success).toBe(false);
    expect(reviseRequestSchema.safeParse({ ...revise, exclude: ["4E7B6F1A-QLOO-ENTITY"] }).success).toBe(true);
    expect(reviseRequestSchema.safeParse({ ...revise, exclude: Array.from({ length: 13 }, (_, i) => `id-${i}`) }).success).toBe(false);
  });

  it("checks the waitlist's email, where they sell and the plan", () => {
    const signup = { email: "founder@example.com", sellsOn: "shopify", consent: true };
    expect(waitlistRequestSchema.safeParse(signup).success).toBe(true);
    expect(waitlistRequestSchema.safeParse({ ...signup, sellsOn: null, plan: "studio" }).success).toBe(true);
    expect(waitlistRequestSchema.safeParse({ ...signup, email: "not an email" }).success).toBe(false);
    expect(waitlistRequestSchema.safeParse({ ...signup, sellsOn: "etsy" }).success).toBe(false);
    expect(waitlistRequestSchema.safeParse({ ...signup, plan: "enterprise" }).success).toBe(false);
    // The source lands in the CSV export, so it is an id, never text a spreadsheet could run.
    expect(waitlistRequestSchema.safeParse({ ...signup, sourceReport: "food-hot-sauce" }).success).toBe(true);
    expect(waitlistRequestSchema.safeParse({ ...signup, sourceReport: "=HYPERLINK(\"x\")" }).success).toBe(false);
  });

  it("takes votes only for the shipped examples", () => {
    expect(voteRequestSchema.safeParse({ example: "food-hot-sauce", choice: "culture" }).success).toBe(true);
    expect(voteRequestSchema.safeParse({ example: "made-up-example", choice: "culture" }).success).toBe(false);
  });
});

describe("API response schemas", () => {
  it("answers a start with a live run or an example replay, with its reason", () => {
    expect(runStartResponseSchema.safeParse({ mode: "live", runId: `run_${"b".repeat(24)}`, eventsUrl: "/api/run/x/events", reportUrl: "/report/x", joined: false }).success).toBe(true);
    expect(runStartResponseSchema.safeParse({ mode: "example", slug: "food-hot-sauce", reason: "busy", message: "Live runs are busy right now." }).success).toBe(true);
    expect(runStartResponseSchema.safeParse({ mode: "example", slug: "food-hot-sauce", reason: "error", message: "x" }).success).toBe(false);
  });

  itRecorded("serves a stored example report as a finished report", () => {
    const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
    expect(reportResponseSchema.parse({ status: "done", report, eventsUrl: null })).toEqual({ status: "done", report, eventsUrl: null });
  });

  it("reads Last-Event-ID as attempt and seq", () => {
    expect(lastEventIdSchema.parse("2:41")).toEqual({ attempt: 2, seq: 41 });
    expect(lastEventIdSchema.safeParse("41").success).toBe(false);
    expect(lastEventIdSchema.safeParse("0:41").success).toBe(false);
  });

  it("labels a site reading's age bands from the bucket, so the youngest band always reads 18 to 24", () => {
    const reading = { label: "Read from your site", ageBands: [{ bucket: "24_and_younger", label: "18 to 24" }], genderSkew: null, place: null, tags: [] };
    expect(siteReadingSchema.safeParse(reading).success).toBe(true);
    expect(siteReadingSchema.safeParse({ ...reading, ageBands: [{ bucket: "24_and_younger", label: "teens" }] }).success).toBe(false);
  });

  it("keeps vote counts honest: n is the sum, and early results under 30", () => {
    const votes = { example: "food-hot-sauce", culture: 12, control: 5, n: 17, early: true, yours: null };
    expect(voteResponseSchema.safeParse(votes).success).toBe(true);
    expect(voteResponseSchema.safeParse({ ...votes, n: 30 }).success).toBe(false);
    expect(voteResponseSchema.safeParse({ ...votes, early: false }).success).toBe(false);
    expect(voteResponseSchema.safeParse({ ...votes, culture: 25, n: 30, early: false }).success).toBe(true);
  });
});
