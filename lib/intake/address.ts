// Which hosts the page reader may reach. The reader fetches one page from a link a stranger typed,
// so every host is treated as hostile: only public unicast addresses pass, and a numeric host must be
// written the one canonical way. The URL parser and inet_aton both read "0x7f000001", "0177.0.0.1",
// "2130706433", "127.1" and "[::ffff:127.0.0.1]" as 127.0.0.1, so those spellings are normalized
// here, classified, and refused even when the address behind them is public. Pure functions, no
// I/O: lib/intake/guarded-fetch.ts does the DNS lookup and applies the same policy to every address.

export type Family = 4 | 6;

/** Why an address is refused. Every range is refused for IPv4 and IPv6 alike. */
export const BLOCKED_RANGES = [
  "unspecified",
  "loopback",
  "private",
  "link-local",
  "cgnat",
  "metadata",
  "multicast",
  "broadcast",
  "documentation",
  "benchmark",
  "unique-local",
  "reserved",
  "unparseable",
] as const;
export type BlockedRange = (typeof BLOCKED_RANGES)[number];

const RANGE_TEXT: Record<BlockedRange, string> = {
  unspecified: "an unspecified address",
  loopback: "a loopback address",
  private: "a private network address",
  "link-local": "a link-local address",
  cgnat: "a carrier-grade NAT address",
  metadata: "a cloud metadata address",
  multicast: "a multicast address",
  broadcast: "the broadcast address",
  documentation: "a documentation-only address",
  benchmark: "a benchmarking address",
  "unique-local": "a unique-local (private) IPv6 address",
  reserved: "a reserved address",
  unparseable: "not an address Stoop can check",
};

export type AddressVerdict =
  | { allowed: true; address: string; family: Family }
  | { allowed: false; address: string; family: Family | null; range: BlockedRange; detail: string };

/** Decides whether one address (as DNS or the URL parser writes it) may be connected to. */
export type AddressPolicy = (address: string) => AddressVerdict;

// --- IPv4 --------------------------------------------------------------------------------------

type Bytes4 = [number, number, number, number];

const DOTTED = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const OCTET = /^(?:0|[1-9]\d{0,2})$/;

/** The canonical dotted-decimal form only ("93.184.216.34"): no leading zeros, no other notation. */
export function parseIpv4(text: string): Bytes4 | undefined {
  const match = DOTTED.exec(text);
  if (!match) return undefined;
  const parts = match.slice(1).map((part) => (OCTET.test(part) ? Number(part) : NaN));
  return parts.every((part) => part <= 255) ? (parts as Bytes4) : undefined;
}

export interface LooseIpv4 {
  bytes: Bytes4;
  address: string;
  /** How it was written, e.g. "dotted decimal", "hex integer", "octal", "short form". */
  notation: string;
  canonical: boolean;
}

/**
 * Reads every IPv4 spelling inet_aton and the WHATWG URL parser accept: 1 to 4 dot-separated parts,
 * each decimal, hex (0x) or octal (leading 0), the last part filling the remaining bytes, and an
 * optional trailing dot. Returns undefined when the text is not a number in any of these forms.
 */
export function parseIpv4Loose(text: string): LooseIpv4 | undefined {
  let parts = text.split(".");
  let trailingDot = false;
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts = parts.slice(0, -1);
    trailingDot = true;
  }
  if (parts.length < 1 || parts.length > 4) return undefined;
  const values: number[] = [];
  const bases = new Set<"decimal" | "hex" | "octal">();
  for (const part of parts) {
    let value: number;
    if (/^0x[0-9a-f]*$/i.test(part)) {
      value = part.length === 2 ? 0 : parseInt(part.slice(2), 16);
      bases.add("hex");
    } else if (/^0[0-7]+$/.test(part)) {
      value = parseInt(part, 8);
      bases.add("octal");
    } else if (/^(?:0|[1-9]\d*)$/.test(part)) {
      value = Number(part);
      bases.add("decimal");
    } else {
      return undefined;
    }
    if (!Number.isSafeInteger(value)) return undefined;
    values.push(value);
  }
  const last = values[values.length - 1];
  if (values.slice(0, -1).some((value) => value > 255)) return undefined;
  if (last >= 256 ** (5 - values.length)) return undefined;
  let total = last;
  values.slice(0, -1).forEach((value, index) => {
    total += value * 256 ** (3 - index);
  });
  const bytes: Bytes4 = [Math.floor(total / 2 ** 24) % 256, Math.floor(total / 2 ** 16) % 256, Math.floor(total / 2 ** 8) % 256, total % 256];
  const address = bytes.join(".");
  const canonical = address === text;
  let notation: string;
  if (canonical) notation = "dotted decimal";
  else if (parts.length === 1) notation = `${[...bases][0]} integer`;
  else {
    const kinds: string[] = [...bases].filter((base) => base !== "decimal");
    if (parts.length < 4) kinds.push("short form");
    if (trailingDot) kinds.push("trailing dot");
    if (kinds.length === 0) kinds.push("leading zeros");
    notation = kinds.join(", ");
  }
  return { bytes, address, notation, canonical };
}

const toInt = (bytes: Bytes4) => ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];

const V4_BLOCKS: [string, number, BlockedRange][] = [
  ["0.0.0.0", 32, "unspecified"],
  ["0.0.0.0", 8, "reserved"], // "this network"
  ["10.0.0.0", 8, "private"],
  ["100.100.100.200", 32, "metadata"], // Alibaba Cloud
  ["100.64.0.0", 10, "cgnat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.169.254", 32, "metadata"], // AWS, GCP, Azure, Oracle and most others
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"], // IETF protocol assignments
  ["192.0.2.0", 24, "documentation"], // TEST-NET-1
  ["192.88.99.0", 24, "reserved"], // former 6to4 relay anycast
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmark"],
  ["198.51.100.0", 24, "documentation"], // TEST-NET-2
  ["203.0.113.0", 24, "documentation"], // TEST-NET-3
  ["168.63.129.16", 32, "metadata"], // Azure platform endpoint (a public-looking address)
  ["224.0.0.0", 4, "multicast"],
  ["255.255.255.255", 32, "broadcast"],
  ["240.0.0.0", 4, "reserved"],
];

const V4_TABLE = V4_BLOCKS.map(([base, prefix, range]) => ({ base: toInt(parseIpv4(base) as Bytes4), prefix, range }));

function classifyBytes4(bytes: Bytes4): BlockedRange | null {
  const ip = toInt(bytes);
  for (const { base, prefix, range } of V4_TABLE) {
    // A shift by 0 (prefix 32) compares every bit; no entry has prefix 0, which would shift by 32.
    if (((ip ^ base) >>> (32 - prefix)) === 0) return range;
  }
  return null;
}

// --- IPv6 --------------------------------------------------------------------------------------

type Pieces = number[]; // 8 pieces of 16 bits

/** Any valid IPv6 text (brackets optional, "::" compression, a dotted IPv4 tail). Zone ids are refused. */
export function parseIpv6(text: string): Pieces | undefined {
  let rest = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  if (!rest || !/^[0-9a-f:.]+$/i.test(rest)) return undefined;
  let tail: number[] = [];
  if (rest.includes(".")) {
    const colon = rest.lastIndexOf(":");
    if (colon < 0) return undefined;
    const v4 = parseIpv4(rest.slice(colon + 1));
    if (!v4) return undefined;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    rest = rest.slice(0, colon + 1);
    if (!rest.endsWith("::")) rest = rest.slice(0, -1);
  }
  const halves = rest.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = groups(halves[0]);
  const after = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !after) return undefined;
  if (halves.length === 1) {
    const pieces = [...head, ...tail];
    return pieces.length === 8 ? pieces : undefined;
  }
  const fill = 8 - head.length - after.length - tail.length;
  if (fill < 1) return undefined;
  return [...head, ...new Array<number>(fill).fill(0), ...after, ...tail];
}

/** RFC 5952 text, which is also how the WHATWG URL parser writes it: lowercase, longest zero run as "::". */
export function formatIpv6(pieces: Pieces): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    if (pieces[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && pieces[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = pieces.map((piece) => piece.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

function v6Prefix(text: string, prefix: number) {
  return { base: parseIpv6(text) as Pieces, prefix };
}

function inPrefix(pieces: Pieces, { base, prefix }: { base: Pieces; prefix: number }): boolean {
  for (let bit = 0; bit < prefix; bit += 16) {
    const index = bit / 16;
    const width = Math.min(16, prefix - bit);
    const mask = (0xffff << (16 - width)) & 0xffff;
    if ((pieces[index] & mask) !== (base[index] & mask)) return false;
  }
  return true;
}

const V6_BLOCKS: { block: ReturnType<typeof v6Prefix>; range: BlockedRange }[] = (
  [
    ["::", 128, "unspecified"],
    ["::1", 128, "loopback"],
    ["fd00:ec2::254", 128, "metadata"], // AWS (IPv6 instance metadata)
    ["64:ff9b:1::", 48, "reserved"], // local-use NAT64
    ["100::", 64, "reserved"], // discard-only
    ["2001:2::", 48, "benchmark"],
    ["2001::", 23, "reserved"], // IETF protocol assignments, including Teredo
    ["2001:db8::", 32, "documentation"],
    ["2002::", 16, "reserved"], // 6to4, deprecated
    ["3fff::", 20, "documentation"],
    ["5f00::", 16, "reserved"], // SRv6 segment ids
    ["fc00::", 7, "unique-local"],
    ["fe80::", 10, "link-local"],
    ["fec0::", 10, "reserved"], // deprecated site-local
    ["ff00::", 8, "multicast"],
  ] as const
).map(([text, prefix, range]) => ({ block: v6Prefix(text, prefix), range }));

const MAPPED = v6Prefix("::ffff:0:0", 96);
const COMPATIBLE = v6Prefix("::", 96);
const NAT64 = v6Prefix("64:ff9b::", 96);

export type EmbeddedKind = "ipv4-mapped" | "ipv4-compatible" | "nat64";

/** The IPv4 address inside an IPv4-mapped, IPv4-compatible or NAT64 IPv6 address, if any. */
export function embeddedIpv4(pieces: Pieces): { kind: EmbeddedKind; address: string; bytes: Bytes4 } | undefined {
  const kind: EmbeddedKind | undefined = inPrefix(pieces, MAPPED)
    ? "ipv4-mapped"
    : inPrefix(pieces, NAT64)
      ? "nat64"
      : inPrefix(pieces, COMPATIBLE) && (pieces[6] !== 0 || pieces[7] > 1)
        ? "ipv4-compatible"
        : undefined;
  if (!kind) return undefined;
  const bytes: Bytes4 = [pieces[6] >> 8, pieces[6] & 0xff, pieces[7] >> 8, pieces[7] & 0xff];
  return { kind, address: bytes.join("."), bytes };
}

// --- The policy --------------------------------------------------------------------------------

const refuse = (address: string, family: Family | null, range: BlockedRange, extra = ""): AddressVerdict => ({
  allowed: false,
  address,
  family,
  range,
  detail: `${address} is ${RANGE_TEXT[range]}${extra}`,
});

/**
 * The production policy: only public unicast addresses. IPv4 is checked against every special-use
 * range; IPv6 must be global unicast (2000::/3) outside the special-use blocks, and an IPv6 address
 * that carries an IPv4 address (mapped, compatible, NAT64) is judged by that IPv4 address.
 */
export const publicAddress: AddressPolicy = (address) => {
  const v4 = parseIpv4(address);
  if (v4) {
    const range = classifyBytes4(v4);
    return range ? refuse(address, 4, range) : { allowed: true, address, family: 4 };
  }
  const pieces = parseIpv6(address);
  if (!pieces || address.startsWith("[")) return refuse(address, null, "unparseable");
  for (const { block, range } of V6_BLOCKS) if (inPrefix(pieces, block)) return refuse(address, 6, range);
  const embedded = embeddedIpv4(pieces);
  if (embedded) {
    const range = classifyBytes4(embedded.bytes);
    if (range) return refuse(address, 6, range, ` (${embedded.kind} ${embedded.address})`);
    return { allowed: true, address, family: 6 };
  }
  if ((pieces[0] & 0xe000) !== 0x2000) return refuse(address, 6, "reserved", " (not global unicast)");
  return { allowed: true, address, family: 6 };
};

// --- URLs --------------------------------------------------------------------------------------

export const MAX_URL_LENGTH = 2_048;

/** Names that only ever mean "this machine" or a private network (RFC 6761, 6762, 8375, ICANN .internal). */
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "localdomain"];

export type UrlCheck =
  | {
      ok: true;
      url: URL;
      /** The hostname to resolve, or the address itself for a numeric host (no brackets). */
      host: string;
      /** Set when the host is an IP literal: then there is nothing to resolve. */
      ip: { address: string; family: Family } | null;
    }
  | { ok: false; reason: "bad-url" | "blocked-address"; detail: string };

/**
 * The host exactly as typed, before the URL parser normalizes it. It mirrors the parser's own
 * splitting (tabs and newlines removed, backslashes count as slashes, userinfo before the last "@"),
 * so "http://0x7f000001/" yields "0x7f000001" while the parsed hostname is "127.0.0.1".
 */
export function typedHost(input: string): string | undefined {
  const cleaned = input.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
  const match = /^[a-z][a-z0-9+.-]*:[/\\]*([^/\\?#]*)/i.exec(cleaned);
  if (!match) return undefined;
  const authority = match[1].slice(match[1].lastIndexOf("@") + 1);
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end < 0 ? authority : authority.slice(0, end + 1);
  }
  const colon = authority.indexOf(":");
  return colon < 0 ? authority : authority.slice(0, colon);
}

const badUrl = (detail: string): UrlCheck => ({ ok: false, reason: "bad-url", detail });
const blocked = (detail: string): UrlCheck => ({ ok: false, reason: "blocked-address", detail });

/**
 * Checks one link before anything is fetched: http or https only, no credentials, a public host.
 * A numeric host is classified by the address it really means, refused when that address is not
 * public, and refused anyway when it is not written in canonical form. Domain names still need the
 * DNS check in guarded-fetch.ts, which applies the same policy to every address they resolve to.
 */
export function checkUrl(input: string, policy: AddressPolicy = publicAddress): UrlCheck {
  if (typeof input !== "string" || input.trim() === "") return badUrl("The link is empty.");
  if (input.length > MAX_URL_LENGTH) return badUrl(`The link is longer than ${MAX_URL_LENGTH} characters.`);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return badUrl("That is not a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return badUrl("Only http and https links can be read.");
  if (url.username || url.password) return badUrl("Links with a user name or password are not read.");
  const hostname = url.hostname;
  if (!hostname) return badUrl("The link has no host.");
  const typed = (typedHost(input) ?? hostname).toLowerCase();

  if (hostname.startsWith("[")) {
    const pieces = parseIpv6(hostname);
    if (!pieces) return badUrl("The link's IPv6 address is not valid.");
    const address = formatIpv6(pieces);
    const verdict = policy(address);
    if (!verdict.allowed) return blocked(`The link points to a blocked address: ${verdict.detail}.`);
    const embedded = embeddedIpv4(pieces);
    if (embedded && embedded.kind !== "nat64") {
      return badUrl(`"${typed}" is the IPv4 address ${embedded.address} written as IPv6 (${embedded.kind}). Use ${embedded.address}.`);
    }
    if (typed !== hostname) return badUrl(`"${typed}" is not the canonical form of ${hostname}. Use ${hostname}.`);
    return { ok: true, url, host: address, ip: { address, family: 6 } };
  }

  if (parseIpv4(hostname)) {
    const loose = typed === hostname ? undefined : parseIpv4Loose(typed);
    const spelled = typed === hostname ? "" : ` ("${typed}" means ${hostname}${loose ? `: ${loose.notation} notation` : ""})`;
    const verdict = policy(hostname);
    if (!verdict.allowed) return blocked(`The link points to a blocked address: ${verdict.detail}${spelled}.`);
    if (typed !== hostname) return badUrl(`The link's address is not written the standard way${spelled}. Use ${hostname}.`);
    return { ok: true, url, host: hostname, ip: { address: hostname, family: 4 } };
  }

  const name = hostname.replace(/\.$/, "");
  if (LOCAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`))) {
    return blocked(`${name} is a local network name.`);
  }
  if (!name.includes(".")) return badUrl(`${name} is not a public domain name.`);
  return { ok: true, url, host: hostname, ip: null };
}
