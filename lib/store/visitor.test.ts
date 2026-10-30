import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";
import { ipGroup, networkVisitorId, tokenVisitorId, visitorId } from "./visitor";

const idFor = (store: MemoryStore, ip: string) => visitorId(store, new Headers({ "x-forwarded-for": ip }));

describe("visitor ids", () => {
  it("keep IPv4 addresses as they are", async () => {
    expect(ipGroup("203.0.113.7")).toBe("203.0.113.7");
    const store = new MemoryStore();
    expect(await idFor(store, "203.0.113.7")).not.toBe(await idFor(store, "203.0.113.8"));
    expect(await idFor(store, "203.0.113.7")).toMatch(/^v_[0-9a-f]{24}$/);
  });

  it("group IPv6 addresses by their /64, however they are written", async () => {
    expect(ipGroup("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(ipGroup("2001:0DB8:ABCD:0012:ffff:0:0:1")).toBe("2001:db8:abcd:12::/64");
    expect(ipGroup("[2001:db8:abcd:12::9]")).toBe("2001:db8:abcd:12::/64");
    expect(ipGroup("2001:db8:abcd:12::9%eth0")).toBe("2001:db8:abcd:12::/64");
    expect(ipGroup("2001:db8::1")).toBe("2001:db8:0:0::/64");
    const store = new MemoryStore();
    // Two addresses in one /64 are one visitor; the next /64 is another.
    expect(await idFor(store, "2001:db8:abcd:12::1")).toBe(await idFor(store, "2001:db8:abcd:12:ffff:ffff:ffff:fffe"));
    expect(await idFor(store, "2001:db8:abcd:12::1")).not.toBe(await idFor(store, "2001:db8:abcd:13::1"));
  });

  it("count an IPv4-mapped IPv6 address as its IPv4 address, and leave anything unparseable as sent", async () => {
    expect(ipGroup("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipGroup("::ffff:cb00:7107")).toBe("203.0.113.7");
    const store = new MemoryStore();
    expect(await idFor(store, "::ffff:203.0.113.7")).toBe(await idFor(store, "203.0.113.7"));
    expect(ipGroup("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(ipGroup("not:an:address")).toBe("not:an:address");
  });

  it("name an MCP token by its hash, never by the token", () => {
    expect(tokenVisitorId("a".repeat(64))).toBe(`t_${"a".repeat(24)}`);
    expect(() => tokenVisitorId("stp_notahash")).toThrow();
  });

  it("group an IPv6 network by its /48 for daily caps, and IPv4 as the address", async () => {
    expect(ipGroup("2001:db8:aa:1::9", 48)).toBe("2001:db8:aa::/48");
    expect(ipGroup("2001:db8:aa:1::9")).toBe("2001:db8:aa:1::/64");
    expect(ipGroup("203.0.113.7", 48)).toBe("203.0.113.7");
    const store = new MemoryStore();
    const net = (ip: string) => networkVisitorId(store, new Headers({ "x-forwarded-for": ip }));
    expect(await net("2001:db8:aa:1::9")).toBe(await net("2001:db8:aa:ffff::1"));
    expect(await net("2001:db8:aa:1::9")).not.toBe(await net("2001:db8:ab:1::9"));
    expect(await idFor(store, "2001:db8:aa:1::9")).not.toBe(await idFor(store, "2001:db8:aa:2::9"));
    expect(await net("203.0.113.7")).toBe(await idFor(store, "203.0.113.7"));
  });
});
