import { describe, expect, it, vi } from "vitest";
import type { WaitlistRequest } from "./api/requests";
import { keys } from "./store/keys";
import { MemoryStore } from "./store/memory";
import { saltedHash } from "./store/visitor";
import { joinWaitlist, listEntries, newSignupToken, nextPosition, normalizeEmail, validSignupToken, waitlistEntrySchema } from "./waitlist";

const signup = (email: string, extra: Partial<WaitlistRequest> = {}) => ({ email, sellsOn: "shopify" as const, consent: true, ...extra });
const browser = newSignupToken();
const other = newSignupToken();
const as = (token: string, iso?: string) => ({ token, ...(iso ? { now: new Date(iso) } : {}) });

describe("joinWaitlist", () => {
  it("gives each new email the next real position, starting at 1", async () => {
    const store = new MemoryStore();
    expect((await joinWaitlist(store, signup("ana@shop.example"), as(browser))).entry.position).toBe(1);
    expect((await joinWaitlist(store, signup("ben@shop.example"), as(other))).entry.position).toBe(2);
    expect((await joinWaitlist(store, signup("cy@shop.example"), as(browser))).entry.position).toBe(3);
    expect(await store.get(keys.waitlist.position)).toBe(3);
  });

  it("lets the browser that signed up rewrite its entry, keeping the position and creation date", async () => {
    const store = new MemoryStore();
    const first = await joinWaitlist(store, signup("Ana@Shop.example ", { sourceReport: "home" }), as(browser, "2026-10-17T10:00:00.000Z"));
    await joinWaitlist(store, signup("ben@shop.example"), as(other));
    const again = await joinWaitlist(
      store,
      signup("ana@shop.example", { plan: "studio", productLink: "https://shop.example/products/sauce", sourceReport: "food-hot-sauce", sellsOn: null, consent: false }),
      as(browser, "2026-10-17T11:00:00.000Z"),
    );
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.entry).toEqual({
      position: 1,
      email: "ana@shop.example",
      sellsOn: "shopify",
      consent: false,
      plan: "studio",
      sourceReport: "food-hot-sauce",
      productLink: "https://shop.example/products/sauce",
      editKey: first.entry.editKey,
      createdAt: "2026-10-17T10:00:00.000Z",
      updatedAt: "2026-10-17T11:00:00.000Z",
    });
    // A later post without a link keeps the link it already gave.
    expect((await joinWaitlist(store, signup("ana@shop.example"), as(browser))).entry.productLink).toBe("https://shop.example/products/sauce");
    expect(await store.get(keys.waitlist.position)).toBe(2);
  });

  it("lets anyone else only fill empty fields: never consent, never a field already set", async () => {
    const store = new MemoryStore();
    await joinWaitlist(store, signup("ana@shop.example", { plan: "founder", consent: true }), as(browser, "2026-10-17T10:00:00.000Z"));
    const stranger = await joinWaitlist(
      store,
      signup("ana@shop.example", { plan: "studio", consent: false, sellsOn: "amazon", productLink: "https://elsewhere.example/p" }),
      as(other, "2026-10-17T12:00:00.000Z"),
    );
    expect(stranger.created).toBe(false);
    expect(stranger.entry).toMatchObject({ position: 1, plan: "founder", consent: true, sellsOn: "shopify", productLink: "https://elsewhere.example/p" });
    // Nothing left to fill: the entry is not touched at all.
    const noop = await joinWaitlist(store, signup("ana@shop.example", { plan: "campaign" }), as(other, "2026-10-17T13:00:00.000Z"));
    expect(noop.entry.updatedAt).toBe("2026-10-17T12:00:00.000Z");
  });

  it("keys entries by the salted hash of the normalized email, never the email, the token or an IP", async () => {
    const store = new MemoryStore();
    const { entry } = await joinWaitlist(store, signup("  ANA@shop.example"), as(browser));
    const hash = await saltedHash(store, "ana@shop.example");
    expect(hash).toMatch(/^h_[0-9a-f]{32}$/);
    expect(waitlistEntrySchema.parse(await store.get(keys.waitlist.entry(hash))).email).toBe("ana@shop.example");
    expect(entry.editKey).toMatch(/^h_[0-9a-f]{32}$/);
    expect(JSON.stringify(entry)).not.toContain(browser);
    expect(await store.range(keys.waitlist.entries, 0, -1)).toEqual([hash]);
  });

  it("counts a signup once when the same email arrives twice at the same moment", async () => {
    const store = new MemoryStore();
    const [a, b] = await Promise.all([joinWaitlist(store, signup("ana@shop.example"), as(browser)), joinWaitlist(store, signup("ana@shop.example", { plan: "founder" }), as(browser))]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(a.entry.position).toBe(b.entry.position);
    expect(await listEntries(store)).toHaveLength(1);
  });

  it("lists an entry before writing it, so a failed write never hides a retried signup from the export", async () => {
    const store = new MemoryStore();
    await saltedHash(store, "warm-up"); // the salt is made with a set of its own on first use
    const set = store.set.bind(store);
    const flaky = vi.spyOn(store, "set").mockImplementationOnce(async () => {
      throw new Error("Upstash timed out");
    });
    await expect(joinWaitlist(store, signup("ana@shop.example"), as(browser))).rejects.toThrow("Upstash timed out");
    flaky.mockImplementation(set);
    const retry = await joinWaitlist(store, signup("ana@shop.example"), as(browser));
    expect(retry.created).toBe(true);
    expect((await listEntries(store)).map((e) => e.email)).toEqual(["ana@shop.example"]);
  });
});

describe("the rest of the waitlist", () => {
  it("normalizes emails by trimming and lowercasing", () => {
    expect(normalizeEmail("  Ana@Shop.Example ")).toBe("ana@shop.example");
  });

  it("accepts only signup tokens Stoop could have set", () => {
    expect(validSignupToken(browser)).toBe(browser);
    for (const bad of [null, "", "abc", `${browser}0`, browser.toUpperCase()]) expect(validSignupToken(bad)).toBeNull();
  });

  it("tells a honeypot hit the next position without writing anything", async () => {
    const store = new MemoryStore();
    expect(await nextPosition(store)).toBe(1);
    await joinWaitlist(store, signup("ana@shop.example"), as(browser));
    expect(await nextPosition(store)).toBe(2);
    expect(await nextPosition(store)).toBe(2);
    expect(await store.get(keys.waitlist.position)).toBe(1);
  });

  it("lists every entry in signup order, across batches, skipping one that no longer parses", async () => {
    const store = new MemoryStore();
    for (const name of ["a", "b", "c", "d", "e"]) await joinWaitlist(store, signup(`${name}@shop.example`), as(browser));
    await store.set(keys.waitlist.entry(await saltedHash(store, "c@shop.example")), { email: "c@shop.example" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entries = await listEntries(store, { batch: 2 });
    expect(entries.map((e) => [e.position, e.email])).toEqual([
      [1, "a@shop.example"],
      [2, "b@shop.example"],
      [4, "d@shop.example"],
      [5, "e@shop.example"],
    ]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
