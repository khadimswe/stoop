import { describe, expect, it, vi } from "vitest";
import { postWaitlist, sourceFromPath, WaitlistPostError } from "./waitlist-client";

describe("postWaitlist", () => {
  it("posts the signup as JSON, without empty fields, and returns the position", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ position: 12 }));
    const result = await postWaitlist({ email: " ana@shop.example ", sellsOn: "shopify", consent: true, sourceReport: "home", company: "", plan: undefined }, fetchImpl);
    expect(result).toEqual({ position: 12 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/waitlist");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ana@shop.example", sellsOn: "shopify", consent: true, sourceReport: "home" });
  });

  it("keeps sellsOn null (the API needs the field) and throws on any error answer", async () => {
    const ok = vi.fn(async () => Response.json({ position: 1 }));
    await postWaitlist({ email: "ana@shop.example", sellsOn: null, consent: true }, ok);
    expect(JSON.parse(String((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body)).sellsOn).toBeNull();
    for (const response of [Response.json({ error: { code: "rate_limited", message: "Too many" } }, { status: 429 }), new Response("oops", { status: 500 }), Response.json({ position: "1" })]) {
      await expect(postWaitlist({ email: "ana@shop.example", sellsOn: null, consent: true }, async () => response)).rejects.toBeInstanceOf(WaitlistPostError);
    }
  });
});

describe("sourceFromPath", () => {
  it("names the page a signup came from, in the API's allowed shape", () => {
    expect(sourceFromPath("/")).toBe("home");
    expect(sourceFromPath("/examples/food-hot-sauce")).toBe("food-hot-sauce");
    expect(sourceFromPath("/report/run_0123456789abcdef01234567")).toBe("run_0123456789abcdef01234567");
    expect(sourceFromPath("/start")).toBe("start");
    expect(sourceFromPath("/judges/")).toBe("judges");
    expect(sourceFromPath("/%E2%9C%A8")).toBeUndefined();
  });
});
