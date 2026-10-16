import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { publicAddress, type AddressPolicy } from "./address";
import { guardedFetch, nextHop, PageBudget, USER_AGENT, type Resolver } from "./guarded-fetch";

// The real policy refuses 127.0.0.1, so these tests pass one that also allows it. Only tests do this.
const loopbackToo: AddressPolicy = (address) => (address === "127.0.0.1" ? { allowed: true, address, family: 4 } : publicAddress(address));
const local = (address = "127.0.0.1"): Resolver => async () => [{ address, family: 4 }];

let server: http.Server;
let base = "";
let port = 0;
const seen: { url: string; headers: http.IncomingHttpHeaders }[] = [];

function route(req: http.IncomingMessage, res: http.ServerResponse) {
  seen.push({ url: req.url ?? "", headers: req.headers });
  const url = new URL(req.url ?? "/", "http://x");
  const redirect = (to: string, extra: Record<string, string> = {}) => {
    res.writeHead(302, { Location: to, ...extra });
    res.end();
  };
  const hops = /^\/hops\/(\d+)$/.exec(url.pathname);
  if (hops) {
    const n = Number(hops[1]);
    if (n > 0) return redirect(`/hops/${n - 1}`);
  }
  switch (hops ? "/hops/0" : url.pathname) {
    case "/page":
    case "/hops/0":
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<html><body><h1>Hello</h1></body></html>");
    case "/json":
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    case "/latin1":
      res.writeHead(200, { "Content-Type": "text/html; charset=iso-8859-1" });
      return res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    case "/echo":
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(req.headers));
    case "/png":
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end("not really a png");
    case "/gzip":
      res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
      return res.end("compressed bytes");
    case "/forbidden":
      res.writeHead(403, { "Content-Type": "text/html" });
      return res.end("Forbidden");
    case "/declared-big":
      res.writeHead(200, { "Content-Type": "text/html", "Content-Length": "5000" });
      return res.end("x".repeat(5000));
    case "/streamed-big":
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("x".repeat(600));
      res.write("x".repeat(600));
      return res.end("x".repeat(600));
    case "/slow":
      return; // never answers
    case "/slow-body":
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("<html>");
      return; // never finishes
    case "/to-private":
      return redirect("http://10.0.0.1/");
    case "/to-hex":
      return redirect(`http://0x7f000001:${port}/page`);
    case "/to-name":
      return redirect(`http://shop.stoop.test:${port}/page`);
    case "/to-ftp":
      return redirect("ftp://example.com/file");
    case "/with-cookie":
      return redirect("/echo", { "Set-Cookie": "session=abc; Path=/" });
    case "/no-location":
      res.writeHead(302);
      return res.end();
    default:
      res.writeHead(404);
      return res.end();
  }
}

beforeAll(async () => {
  server = http.createServer(route);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const fetchLocal = (path: string, options: Parameters<typeof guardedFetch>[1] = {}) => guardedFetch(`${base}${path}`, { policy: loopbackToo, ports: [port], ...options });

describe("guardedFetch, address policy", () => {
  it("refuses 127.0.0.1 under the default policy, without connecting", async () => {
    const before = seen.length;
    const result = await guardedFetch(`${base}/page`);
    expect(result).toMatchObject({ ok: false, reason: "blocked-address" });
    expect(seen.length).toBe(before);
  });

  it("refuses a name when any resolved address is private, without connecting", async () => {
    const before = seen.length;
    const mixed: Resolver = async () => [
      { address: "127.0.0.1", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ];
    const result = await guardedFetch(`http://shop.stoop.test:${port}/page`, { policy: loopbackToo, ports: [port], resolve: mixed });
    expect(result).toMatchObject({ ok: false, reason: "blocked-address" });
    expect(result.ok ? "" : result.detail).toContain("10.0.0.7");
    expect(seen.length).toBe(before);
  });

  it("reports a name that does not resolve", async () => {
    const nowhere: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await guardedFetch("http://shop.stoop.test/page", { resolve: nowhere })).toMatchObject({ ok: false, reason: "dns-failed" });
    expect(await guardedFetch("http://shop.stoop.test/page", { resolve: async () => [] })).toMatchObject({ ok: false, reason: "dns-failed" });
  });

  it("refuses bad links before any lookup", async () => {
    const resolve = vi.fn(local());
    expect(await guardedFetch("ftp://shop.stoop.test/", { resolve })).toMatchObject({ ok: false, reason: "bad-url" });
    expect(await guardedFetch("http://0x7f000001/", { resolve, policy: loopbackToo, ports: [port] })).toMatchObject({ ok: false, reason: "bad-url" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses ports that are not storefront ports, without connecting", async () => {
    const before = seen.length;
    const resolve = vi.fn(local());
    // The local server's own port is refused unless a test allows it.
    expect(await guardedFetch(`http://shop.stoop.test:${port}/page`, { policy: loopbackToo, resolve })).toMatchObject({ ok: false, reason: "bad-url" });
    expect(await guardedFetch("http://shop.stoop.test:6379/", { policy: loopbackToo, resolve })).toMatchObject({ ok: false, reason: "bad-url" });
    expect(resolve).not.toHaveBeenCalled();
    expect(seen.length).toBe(before);
  });
});

describe("guardedFetch, pinned connection", () => {
  it("connects to the checked address and keeps the hostname in the Host header", async () => {
    const resolve = vi.fn(local());
    const result = await guardedFetch(`http://shop.stoop.test:${port}/echo`, { policy: loopbackToo, ports: [port], resolve });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = JSON.parse(result.body) as Record<string, string>;
    expect(headers.host).toBe(`shop.stoop.test:${port}`);
    expect(headers["user-agent"]).toBe(USER_AGENT);
    expect(headers["accept-encoding"]).toBe("identity");
    expect(headers.cookie).toBeUndefined();
    // Resolved once, by the check. The socket used the pinned answer, not a second lookup.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("shop.stoop.test");
  });

  it("re-resolves and re-checks on every hop, so a rebind to a private address is caught", async () => {
    const answers = ["127.0.0.1", "10.0.0.9"];
    const rebinding: Resolver = async () => [{ address: answers.shift() ?? "10.0.0.9", family: 4 }];
    const result = await guardedFetch(`http://shop.stoop.test:${port}/to-name`, { policy: loopbackToo, ports: [port], resolve: rebinding });
    expect(result).toMatchObject({ ok: false, reason: "blocked-address" });
  });

  it("passes the pinned lookup, the hostname as SNI and no shared agent to https.request", async () => {
    let captured: https.RequestOptions | undefined;
    vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions) => {
      captured = options;
      const fake = Object.assign(new EventEmitter(), { end: () => setImmediate(() => fake.emit("error", new Error("no network in tests"))) });
      return fake as unknown as http.ClientRequest;
    }) as unknown as typeof https.request);
    const result = await guardedFetch("https://shop.stoop.test/products/mug?variant=2", { policy: loopbackToo, resolve: local() });
    expect(result).toMatchObject({ ok: false, reason: "network-error" });
    expect(captured).toMatchObject({ hostname: "shop.stoop.test", servername: "shop.stoop.test", port: 443, path: "/products/mug?variant=2", agent: false });
    expect(captured?.headers).toMatchObject({ Host: "shop.stoop.test", "User-Agent": USER_AGENT });
    const lookup = captured?.lookup;
    expect(lookup).toBeTypeOf("function");
    const one = await new Promise((resolve) => lookup?.("evil.example", {}, (_error, address, family) => resolve({ address, family })));
    expect(one).toEqual({ address: "127.0.0.1", family: 4 });
    const all = await new Promise((resolve) => lookup?.("shop.stoop.test", { all: true }, (_error, address) => resolve(address)));
    expect(all).toEqual([{ address: "127.0.0.1", family: 4 }]);
    await guardedFetch("https://shop.stoop.test./x", { policy: loopbackToo, resolve: local() });
    expect(captured).toMatchObject({ hostname: "shop.stoop.test.", servername: "shop.stoop.test" });
  });
});

describe("guardedFetch, responses", () => {
  it("returns the body, status, type and final URL", async () => {
    const result = await fetchLocal("/page#top");
    expect(result).toMatchObject({ ok: true, status: 200, contentType: "text/html", finalUrl: `${base}/page`, redirects: 0 });
    expect(result.ok && result.body).toContain("<h1>Hello</h1>");
  });

  it("decodes the declared charset", async () => {
    const result = await fetchLocal("/latin1");
    expect(result.ok && result.body).toBe(`caf${String.fromCharCode(0xe9)}`);
  });

  it("refuses other content types, compressed bodies and narrowed types", async () => {
    expect(await fetchLocal("/png")).toMatchObject({ ok: false, reason: "unsupported-content-type" });
    expect(await fetchLocal("/gzip")).toMatchObject({ ok: false, reason: "unsupported-content-type" });
    expect(await fetchLocal("/page", { accept: ["application/json"] })).toMatchObject({ ok: false, reason: "unsupported-content-type" });
    expect(await fetchLocal("/json", { accept: ["application/json"] })).toMatchObject({ ok: true, contentType: "application/json" });
  });

  it("reports HTTP errors with their status", async () => {
    expect(await fetchLocal("/forbidden")).toMatchObject({ ok: false, reason: "http-error", status: 403 });
    expect(await fetchLocal("/missing")).toMatchObject({ ok: false, reason: "http-error", status: 404 });
    expect(await fetchLocal("/no-location")).toMatchObject({ ok: false, reason: "http-error", status: 302 });
  });

  it("caps the body, by declared length and while streaming", async () => {
    expect(await fetchLocal("/declared-big", { maxBytes: 1000 })).toMatchObject({ ok: false, reason: "too-large" });
    expect(await fetchLocal("/streamed-big", { maxBytes: 1000 })).toMatchObject({ ok: false, reason: "too-large" });
    expect(await fetchLocal("/streamed-big", { maxBytes: 2000 })).toMatchObject({ ok: true });
  });

  it("times out on a silent server and on a stalled body", async () => {
    expect(await fetchLocal("/slow", { timeoutMs: 150 })).toMatchObject({ ok: false, reason: "timeout" });
    expect(await fetchLocal("/slow-body", { timeoutMs: 150 })).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    expect(await fetchLocal("/slow", { signal: controller.signal })).toMatchObject({ ok: false, reason: "timeout", detail: "The read was cancelled." });
  });
});

describe("guardedFetch, redirects", () => {
  it("follows up to 3 redirects and refuses a 4th", async () => {
    expect(await fetchLocal("/hops/3")).toMatchObject({ ok: true, redirects: 3, finalUrl: `${base}/hops/0` });
    expect(await fetchLocal("/hops/4")).toMatchObject({ ok: false, reason: "too-many-redirects" });
  });

  it("re-checks every target like the first link", async () => {
    expect(await fetchLocal("/to-private")).toMatchObject({ ok: false, reason: "blocked-address" });
    expect(await fetchLocal("/to-hex")).toMatchObject({ ok: false, reason: "bad-url" });
    expect(await fetchLocal("/to-ftp")).toMatchObject({ ok: false, reason: "bad-url" });
  });

  it("never sends cookies a redirect tried to set", async () => {
    const result = await fetchLocal("/with-cookie");
    expect(result.ok).toBe(true);
    if (result.ok) expect((JSON.parse(result.body) as Record<string, string>).cookie).toBeUndefined();
  });

  it("refuses https to http, resolves relative targets and drops fragments", () => {
    expect(nextHop(new URL("https://shop.example.com/a"), "http://shop.example.com/b")).toMatchObject({ ok: false, reason: "insecure-redirect" });
    expect(nextHop(new URL("https://shop.example.com/a/b"), "../c#x")).toEqual({ ok: true, url: "https://shop.example.com/c" });
    expect(nextHop(new URL("http://shop.example.com/a"), "https://shop.example.com/b")).toEqual({ ok: true, url: "https://shop.example.com/b" });
    expect(nextHop(new URL("https://shop.example.com/a"), "http://[::1")).toMatchObject({ ok: false, reason: "bad-url" });
  });

  it("keeps a redirect target's host as written, so its spelling is checked", () => {
    const from = new URL("http://shop.example.com/a");
    expect(nextHop(from, "http://0x7f000001/page")).toEqual({ ok: true, url: "http://0x7f000001/page" });
    expect(nextHop(from, "//2130706433/page")).toEqual({ ok: true, url: "http://2130706433/page" });
    expect(nextHop(from, "/b")).toEqual({ ok: true, url: "http://shop.example.com/b" });
  });
});

describe("PageBudget", () => {
  it("allows the product page and its Shopify JSON once each, and nothing else", () => {
    const budget = new PageBudget("https://shop.example.com/products/trail-mug?variant=12#reviews");
    expect(budget.pageUrl).toBe("https://shop.example.com/products/trail-mug?variant=12");
    expect(budget.jsonUrl).toBe("https://shop.example.com/products/trail-mug.json");
    expect(budget.claim("https://shop.example.com/products/other").ok).toBe(false);
    expect(budget.claim("https://evil.example/products/trail-mug.json").ok).toBe(false);
    expect(budget.claim("https://shop.example.com/products/trail-mug.json").ok).toBe(true);
    expect(budget.claim("https://shop.example.com/products/trail-mug.json").ok).toBe(false);
    expect(budget.claim("https://shop.example.com/products/trail-mug?variant=12").ok).toBe(true);
    expect(budget.claim("https://shop.example.com/products/trail-mug?variant=12").ok).toBe(false);
  });

  it("accepts either JSON form for a nested product path, but only one of them", () => {
    const budget = new PageBudget("https://shop.example.com/collections/mugs/products/trail-mug/");
    expect(budget.jsonUrl).toBe("https://shop.example.com/collections/mugs/products/trail-mug.json");
    expect(budget.claim("https://shop.example.com/products/trail-mug.json").ok).toBe(true);
    expect(budget.claim("https://shop.example.com/collections/mugs/products/trail-mug.json").ok).toBe(false);
  });

  it("has no JSON sibling for other paths", () => {
    expect(new PageBudget("https://shop.example.com/p/trail-mug").jsonUrl).toBeNull();
    expect(new PageBudget("https://shop.example.com/products/trail-mug.json").jsonUrl).toBeNull();
    expect(new PageBudget("not a url").pageUrl).toBeNull();
  });

  it("refuses an over-budget fetch without touching the network", async () => {
    const before = seen.length;
    const budget = new PageBudget(`${base}/page`);
    expect(await budget.fetch(`${base}/page`, { policy: loopbackToo, ports: [port] })).toMatchObject({ ok: true });
    expect(await budget.fetch(`${base}/page`, { policy: loopbackToo, ports: [port] })).toMatchObject({ ok: false, reason: "over-budget" });
    expect(await budget.fetch(`${base}/json`, { policy: loopbackToo, ports: [port] })).toMatchObject({ ok: false, reason: "over-budget" });
    expect(seen.length).toBe(before + 1);
  });
});
