import { describe, expect, it } from "vitest";
import { checkUrl, embeddedIpv4, formatIpv6, parseIpv4, parseIpv4Loose, parseIpv6, publicAddress, typedHost, type BlockedRange } from "./address";

const rangeOf = (address: string): BlockedRange | "public" => {
  const verdict = publicAddress(address);
  return verdict.allowed ? "public" : verdict.range;
};

describe("publicAddress, IPv4", () => {
  it.each<[string, BlockedRange]>([
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "reserved"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.254", "cgnat"],
    ["100.100.100.200", "metadata"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["169.254.169.254", "metadata"],
    ["169.254.1.1", "link-local"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.8", "reserved"],
    ["192.0.2.1", "documentation"],
    ["192.88.99.1", "reserved"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "benchmark"],
    ["198.19.255.255", "benchmark"],
    ["198.51.100.7", "documentation"],
    ["203.0.113.9", "documentation"],
    ["168.63.129.16", "metadata"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["240.0.0.1", "reserved"],
    ["250.1.2.3", "reserved"],
  ])("refuses %s as %s", (address, range) => {
    expect(rangeOf(address)).toBe(range);
  });

  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "23.227.38.65", "11.0.0.1", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "198.20.0.1", "223.255.255.255"])(
    "allows the public address %s",
    (address) => {
      expect(publicAddress(address)).toEqual({ allowed: true, address, family: 4 });
    },
  );

  it("explains a refusal in plain words", () => {
    expect(publicAddress("169.254.169.254")).toMatchObject({ allowed: false, family: 4, detail: "169.254.169.254 is a cloud metadata address" });
  });
});

describe("publicAddress, IPv6", () => {
  it.each<[string, BlockedRange]>([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:169.254.169.254", "metadata"],
    ["::127.0.0.1", "loopback"],
    ["::2", "reserved"],
    ["64:ff9b::a00:1", "private"],
    ["64:ff9b:1::1", "reserved"],
    ["100::1", "reserved"],
    ["2001::1", "reserved"],
    ["2001:2::1", "benchmark"],
    ["2001:db8::1", "documentation"],
    ["2002:7f00:1::1", "reserved"],
    ["3fff::1", "documentation"],
    ["5f00::1", "reserved"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["fd00:ec2::254", "metadata"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["fec0::1", "reserved"],
    ["ff02::1", "multicast"],
    ["4000::1", "reserved"],
    ["::ffff:0:a00:1", "reserved"],
  ])("refuses %s as %s", (address, range) => {
    expect(rangeOf(address)).toBe(range);
  });

  it.each(["2606:2800:220:1::", "2606:4700:4700::1111", "2a00:1450:4001:82a::200e", "2620:fe::fe", "::ffff:93.184.216.34", "64:ff9b::5db8:d822"])(
    "allows the public address %s",
    (address) => {
      expect(publicAddress(address)).toMatchObject({ allowed: true, family: 6 });
    },
  );

  it("refuses what it cannot parse: zone ids, brackets, junk", () => {
    for (const address of ["fe80::1%en0", "[::1]", "", "localhost", "1.2.3", "::g"]) expect(rangeOf(address)).toBe("unparseable");
  });
});

describe("parseIpv4Loose", () => {
  it.each<[string, string]>([
    ["0x7f000001", "hex integer"],
    ["2130706433", "decimal integer"],
    ["017700000001", "octal integer"],
    ["0x7f.0.0.1", "hex"],
    ["0177.0.0.1", "octal"],
    ["127.1", "short form"],
    ["127.0.1", "short form"],
    ["0x7f.1", "hex, short form"],
    ["127.0.0.1.", "trailing dot"],
  ])("reads %s as 127.0.0.1 (%s)", (text, notation) => {
    expect(parseIpv4Loose(text)).toMatchObject({ address: "127.0.0.1", notation, canonical: false });
  });

  it("knows the canonical form", () => {
    expect(parseIpv4Loose("93.184.216.34")).toMatchObject({ address: "93.184.216.34", canonical: true, notation: "dotted decimal" });
    expect(parseIpv4Loose("0x5db8d822")).toMatchObject({ address: "93.184.216.34", canonical: false });
    expect(parseIpv4Loose("0")).toMatchObject({ address: "0.0.0.0" });
  });

  it.each(["256.0.0.1", "1.2.3.4.5", "0x1g", "09.0.0.1", "1..2.3", "4294967296", "1.2.65536", "", "example.com", "-1.0.0.0"])("rejects %s", (text) => {
    expect(parseIpv4Loose(text)).toBeUndefined();
  });

  it("strict parsing takes only dotted decimal", () => {
    expect(parseIpv4("10.0.0.1")).toEqual([10, 0, 0, 1]);
    for (const text of ["010.0.0.1", "10.0.1", "0xa.0.0.1", "10.0.0.256", " 10.0.0.1"]) expect(parseIpv4(text)).toBeUndefined();
  });
});

describe("parseIpv6 and formatIpv6", () => {
  it("parse compressed, full and IPv4-tailed forms", () => {
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6("1:2:3:4:5:6:1.2.3.4")).toEqual([1, 2, 3, 4, 5, 6, 0x102, 0x304]);
    expect(parseIpv6("2606:2800:0220:0001:0000:0000:0000:0000")).toEqual([0x2606, 0x2800, 0x220, 1, 0, 0, 0, 0]);
  });

  it.each(["1:2:3:4:5:6:7:8:9", ":::", "1::2::3", "12345::", "g::1", "::1.2.3", "::256.0.0.1", "1:2:3:4:5:6:7:1.2.3.4", ":1", "1:", "fe80::1%en0", "1.2.3.4"])("rejects %s", (text) => {
    expect(parseIpv6(text)).toBeUndefined();
  });

  it("format like RFC 5952 and the URL parser", () => {
    const format = (text: string) => formatIpv6(parseIpv6(text) as number[]);
    expect(format("2606:2800:0220:0001:0000:0000:0000:0000")).toBe("2606:2800:220:1::");
    expect(format("1:0:0:1:0:0:0:1")).toBe("1:0:0:1::1");
    expect(format("1:0:1:1:1:1:1:1")).toBe("1:0:1:1:1:1:1:1");
    expect(format("::ffff:127.0.0.1")).toBe("::ffff:7f00:1");
    expect(format("::")).toBe("::");
    expect(format("FE80::ABCD")).toBe("fe80::abcd");
  });

  it("find the IPv4 address inside mapped, compatible and NAT64 forms", () => {
    expect(embeddedIpv4(parseIpv6("::ffff:7f00:1") as number[])).toMatchObject({ kind: "ipv4-mapped", address: "127.0.0.1" });
    expect(embeddedIpv4(parseIpv6("::10.0.0.1") as number[])).toMatchObject({ kind: "ipv4-compatible", address: "10.0.0.1" });
    expect(embeddedIpv4(parseIpv6("64:ff9b::808:808") as number[])).toMatchObject({ kind: "nat64", address: "8.8.8.8" });
    expect(embeddedIpv4(parseIpv6("::1") as number[])).toBeUndefined();
    expect(embeddedIpv4(parseIpv6("2606:4700::1") as number[])).toBeUndefined();
  });
});

describe("typedHost", () => {
  it("returns the host exactly as typed, before normalization", () => {
    expect(typedHost("http://0x7f000001/x")).toBe("0x7f000001");
    expect(typedHost("http://user@0x7f000001:80/x")).toBe("0x7f000001");
    expect(typedHost("http:\\\\0x7f.1\\x")).toBe("0x7f.1");
    expect(typedHost("  http://[::ffff:127.0.0.1]:8080/")).toBe("[::ffff:127.0.0.1]");
    expect(typedHost("http://shop.example.com?x")).toBe("shop.example.com");
    expect(typedHost("not a url")).toBeUndefined();
  });
});

describe("checkUrl", () => {
  const reason = (input: string) => {
    const result = checkUrl(input);
    return result.ok ? "ok" : result.reason;
  };

  it("accepts public http and https links", () => {
    for (const input of ["https://shop.example.com/products/x", "http://93.184.216.34/", "https://[2606:2800:220:1::]/", "HTTPS://Shop.Example.COM/p", "https://shop.example.com:8443/x", "https://example.com./x"]) {
      expect(reason(input), input).toBe("ok");
    }
    expect(checkUrl("https://shop.example.com/x")).toMatchObject({ ok: true, host: "shop.example.com", ip: null });
    expect(checkUrl("http://93.184.216.34/")).toMatchObject({ ok: true, host: "93.184.216.34", ip: { address: "93.184.216.34", family: 4 } });
    expect(checkUrl("https://[2606:2800:220:1::]/")).toMatchObject({ ok: true, host: "2606:2800:220:1::", ip: { family: 6 } });
  });

  it.each(["", "   ", "not a url", "ftp://example.com/", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "http://user:pass@shop.example.com/", "http://user@shop.example.com/", "http://intranet/", `https://example.com/${"a".repeat(2_100)}`])(
    "refuses the bad link %s",
    (input) => {
      expect(reason(input)).toBe("bad-url");
    },
  );

  it.each([
    "http://127.0.0.1/",
    "http://0x7f000001/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "http://017700000001/",
    "http://2130706433/",
    "http://127.1/",
    "http://127.0.1/",
    "http://127.0.0.1./",
    "http://%31%32%37.0.0.1/",
    `http://${String.fromCharCode(0xff11, 0xff12, 0xff17)}.0.0.1/`,
    "http://0/",
    "http://0.0.0.0/",
    "http://[::]/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::127.0.0.1]/",
    "http://10.0.0.1/",
    "http://192.168.0.1:8080/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://100.64.0.1/",
    "http://localhost:3000/",
    "http://localhost./",
    "http://api.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://router.home.arpa/",
  ])("refuses %s as a blocked address", (input) => {
    expect(reason(input)).toBe("blocked-address");
  });

  it("names the real address behind an alternate spelling", () => {
    const result = checkUrl("http://0x7f000001/");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toBe('The link points to a blocked address: 127.0.0.1 is a loopback address ("0x7f000001" means 127.0.0.1: hex integer notation).');
    }
  });

  it("refuses a public address written in a non-canonical way", () => {
    for (const input of ["http://0x5db8d822/", "http://1572395042/", "http://93.184.216.34./", "http://[::ffff:93.184.216.34]/", "http://[::ffff:5db8:d822]/", "http://[2606:2800:0220:1::]/"]) {
      expect(reason(input), input).toBe("bad-url");
    }
    const result = checkUrl("http://0x5db8d822/");
    if (!result.ok) expect(result.detail).toContain("Use 93.184.216.34");
  });

  it("applies an injected policy to numeric hosts", () => {
    const loopbackToo = (address: string) =>
      address === "127.0.0.1" ? { allowed: true as const, address, family: 4 as const } : publicAddress(address);
    expect(checkUrl("http://127.0.0.1:8080/", loopbackToo)).toMatchObject({ ok: true });
    // Still refused: non-canonical spellings, and every other private address.
    expect(checkUrl("http://0x7f000001/", loopbackToo)).toMatchObject({ ok: false, reason: "bad-url" });
    expect(checkUrl("http://10.0.0.1/", loopbackToo)).toMatchObject({ ok: false, reason: "blocked-address" });
  });
});
