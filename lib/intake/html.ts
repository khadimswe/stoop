// Small, dependency-free HTML reading for the page reader: entity decoding, a page's visible text,
// meta tags, the <title>, the first <h1> and JSON-LD blocks. Bodies are capped at 1 MB by the fetch.
// Every scan walks forward and resumes after what it already read (no backtracking regex over the
// page, a start tag is at most MAX_TAG_TEXT long), so the work stays linear in the page size and a
// hostile page cannot make reading slow. The output is plain text; nothing here interprets it.

// Named entities seen on product pages. Code points are written as numbers on purpose: the project
// never puts some of these characters (the long dash) in source.
const NAMED: Record<string, number> = {
  amp: 38,
  lt: 60,
  gt: 62,
  quot: 34,
  apos: 39,
  nbsp: 160,
  ensp: 0x2002,
  emsp: 0x2003,
  thinsp: 0x2009,
  shy: 173,
  ndash: 0x2013,
  mdash: 0x2014,
  lsquo: 0x2018,
  rsquo: 0x2019,
  sbquo: 0x201a,
  ldquo: 0x201c,
  rdquo: 0x201d,
  bdquo: 0x201e,
  laquo: 171,
  raquo: 187,
  hellip: 0x2026,
  bull: 0x2022,
  middot: 183,
  trade: 0x2122,
  reg: 174,
  copy: 169,
  deg: 176,
  times: 215,
  divide: 247,
  plusmn: 177,
  frac12: 189,
  frac14: 188,
  frac34: 190,
  cent: 162,
  pound: 163,
  yen: 165,
  euro: 0x20ac,
  sect: 167,
  para: 182,
  iexcl: 161,
  iquest: 191,
  szlig: 223,
};
// Latin-1 letters with accents: &eacute; &Eacute; &ntilde; and so on.
const ACCENTED: [string, number, number][] = [
  ["agrave", 0xc0, 0xe0],
  ["aacute", 0xc1, 0xe1],
  ["acirc", 0xc2, 0xe2],
  ["atilde", 0xc3, 0xe3],
  ["auml", 0xc4, 0xe4],
  ["aring", 0xc5, 0xe5],
  ["aelig", 0xc6, 0xe6],
  ["ccedil", 0xc7, 0xe7],
  ["egrave", 0xc8, 0xe8],
  ["eacute", 0xc9, 0xe9],
  ["ecirc", 0xca, 0xea],
  ["euml", 0xcb, 0xeb],
  ["igrave", 0xcc, 0xec],
  ["iacute", 0xcd, 0xed],
  ["icirc", 0xce, 0xee],
  ["iuml", 0xcf, 0xef],
  ["ntilde", 0xd1, 0xf1],
  ["ograve", 0xd2, 0xf2],
  ["oacute", 0xd3, 0xf3],
  ["ocirc", 0xd4, 0xf4],
  ["otilde", 0xd5, 0xf5],
  ["ouml", 0xd6, 0xf6],
  ["oslash", 0xd8, 0xf8],
  ["ugrave", 0xd9, 0xf9],
  ["uacute", 0xda, 0xfa],
  ["ucirc", 0xdb, 0xfb],
  ["uuml", 0xdc, 0xfc],
  ["yacute", 0xdd, 0xfd],
];
for (const [name, upper, lower] of ACCENTED) {
  NAMED[name] = lower;
  NAMED[name[0].toUpperCase() + name.slice(1)] = upper;
}

const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return String.fromCharCode(0xfffd);
  // Control characters become spaces (tab, newline and carriage return stay whitespace too).
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return " ";
  return String.fromCodePoint(code);
}

/** Decodes numeric entities and the common named ones. Unknown names are left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] === "#") return fromCodePoint(body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1)));
    const code = NAMED[body] ?? NAMED[body.toLowerCase()];
    return code === undefined ? whole : fromCodePoint(code);
  });
}

/** Every run of whitespace (including no-break spaces) as one space, trimmed. */
export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** At most `max` characters, cut at a word boundary when one is near. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.8 ? cut.slice(0, space) : cut).trim();
}

/**
 * Characters the scans below have walked over, so tests can check that the work stays linear in
 * the input instead of timing it. Counting is a single addition per scan; nothing reads it in the app.
 */
export const scanWork = { chars: 0 };

/** indexOf that counts the characters it walks over. */
function indexFrom(text: string, token: string, from: number): number {
  const at = text.indexOf(token, from);
  scanWork.chars += Math.max(0, (at < 0 ? text.length : at + token.length) - from);
  return at;
}

/** ASCII-only lowercase, so indexes into it match the original (toLowerCase can change length). */
function asciiLower(text: string): string {
  scanWork.chars += text.length;
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

const isSpace = (code: number) => code === 32 || (code >= 9 && code <= 13);

/** The longest start tag read. A longer one (or one never closed) is not a tag. */
export const MAX_TAG_TEXT = 65_536;

/**
 * Index just past the ">" closing the tag that opens at `start`, honoring quoted values, or -1 when
 * there is none within MAX_TAG_TEXT characters. Callers then skip ahead by MAX_TAG_TEXT, so a page
 * full of unclosed tags is walked once, not once per tag.
 */
function tagEnd(html: string, start: number): number {
  let quote = 0;
  let previous = 0;
  const stop = Math.min(html.length, start + MAX_TAG_TEXT);
  for (let i = start + 1; i < stop; i++) {
    const code = html.charCodeAt(i);
    if (quote) {
      if (code === quote) quote = 0;
      continue;
    }
    if ((code === 34 || code === 39) && previous === 61) quote = code;
    else if (code === 62) {
      scanWork.chars += i + 1 - start;
      return i + 1;
    }
    if (!isSpace(code)) previous = code;
  }
  scanWork.chars += stop - start;
  return -1;
}

/** The next "<name" (or "</name") at a tag boundary, so "<nav" does not match "<navbar". */
function findTag(lower: string, token: string, from: number): number {
  for (let at = indexFrom(lower, token, from); at >= 0; at = indexFrom(lower, token, at + 1)) {
    const next = lower.charCodeAt(at + token.length);
    if (Number.isNaN(next) || isSpace(next) || next === 62 || next === 47) return at;
  }
  return -1;
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attributes of one start tag, names lowercased, values entity-decoded. */
export function parseAttributes(tag: string): Record<string, string> {
  const inner = tag.slice(0, MAX_TAG_TEXT).replace(/^<\/?[A-Za-z][A-Za-z0-9:-]*/, "").replace(/\/?>$/, "");
  const attributes: Record<string, string> = {};
  for (const match of inner.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** Every start tag with this name, as attribute maps (e.g. every <meta>). */
function startTags(html: string, name: string, limit: number): { attributes: Record<string, string>; end: number }[] {
  const lower = asciiLower(html);
  const found: { attributes: Record<string, string>; end: number }[] = [];
  // Each search resumes after the last tag (or after the stretch a broken tag covered), never at
  // `at + 1`, so no part of the page is scanned twice.
  let resume = 0;
  for (let at = findTag(lower, `<${name}`, 0); at >= 0 && found.length < limit; at = findTag(lower, `<${name}`, Math.max(at + 1, resume))) {
    const end = tagEnd(html, at);
    if (end < 0) {
      resume = at + MAX_TAG_TEXT;
      continue;
    }
    resume = end;
    found.push({ attributes: parseAttributes(html.slice(at, end)), end });
  }
  return found;
}

/** The raw text between an element's start tag and its close (first close; no nesting). */
function rawContent(html: string, lower: string, name: string, from = 0): { text: string; next: number } | undefined {
  const at = findTag(lower, `<${name}`, from);
  if (at < 0) return undefined;
  const start = tagEnd(html, at);
  if (start < 0) return undefined;
  const close = findTag(lower, `</${name}`, start);
  const stop = close < 0 ? html.length : close;
  return { text: html.slice(start, stop), next: stop };
}

// Elements whose content is never visible text. Raw-text elements end at their first close tag; the
// rest may nest, so their closes are counted.
const SKIP_RAW = new Set(["script", "style", "noscript", "template", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const SKIP_NESTED = new Set(["head", "nav", "footer", "header", "aside", "svg", "select", "button", "dialog", "canvas", "object"]);
const TAG_NAME = /<(\/?)([a-z][a-z0-9:-]*)/y;

function skipRaw(html: string, lower: string, name: string, from: number): number {
  const close = findTag(lower, `</${name}`, from);
  if (close < 0) return html.length;
  const end = indexFrom(html, ">", close);
  return end < 0 ? html.length : end + 1;
}

/** Index after the close tag that matches an open element, counting nested opens. Unclosed: the end. */
function skipNested(html: string, lower: string, name: string, from: number): number {
  const open = `<${name}`;
  const close = `</${name}`;
  let depth = 1;
  let position = from;
  let nextOpen: number | undefined;
  let nextClose: number | undefined;
  while (depth > 0) {
    // Each search runs only when the position has passed its last answer, so the walk stays linear.
    if (nextOpen === undefined || (nextOpen >= 0 && nextOpen < position)) nextOpen = findTag(lower, open, position);
    if (nextClose === undefined || (nextClose >= 0 && nextClose < position)) nextClose = findTag(lower, close, position);
    if (nextClose < 0) return html.length;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const end = tagEnd(html, nextOpen);
      if (end < 0) return html.length;
      if (html.charCodeAt(end - 2) !== 47) depth++; // "<svg/>" opens nothing
      position = end;
    } else {
      depth--;
      position = nextClose + close.length;
    }
  }
  const end = indexFrom(html, ">", position);
  return end < 0 ? html.length : end + 1;
}

/** The part of a page inside <main>, when it has one: that is where the product lives. */
function mainPart(html: string, lower: string): string {
  const at = findTag(lower, "<main", 0);
  if (at < 0) return html;
  const start = tagEnd(html, at);
  scanWork.chars += html.length;
  const close = lower.lastIndexOf("</main");
  if (start < 0 || close < start) return html;
  return html.slice(start, close);
}

/**
 * The text a visitor would read: inside <main> when there is one, without scripts, styles,
 * navigation, headers, footers, forms' buttons and selects, or comments; entities decoded and
 * whitespace collapsed.
 */
export function visibleText(html: string): string {
  const part = mainPart(html, asciiLower(html));
  const lower = asciiLower(part);
  const out: string[] = [];
  let i = 0;
  while (i < part.length) {
    const lt = indexFrom(part, "<", i);
    if (lt < 0) {
      out.push(part.slice(i));
      break;
    }
    if (lt > i) out.push(part.slice(i, lt));
    if (lower.startsWith("<!--", lt)) {
      const end = indexFrom(part, "-->", lt + 4);
      i = end < 0 ? part.length : end + 3;
      out.push(" ");
      continue;
    }
    if (lower.startsWith("<!", lt) || lower.startsWith("<?", lt)) {
      const end = indexFrom(part, ">", lt);
      i = end < 0 ? part.length : end + 1;
      continue;
    }
    TAG_NAME.lastIndex = lt;
    const match = TAG_NAME.exec(lower);
    if (!match) {
      out.push("<");
      i = lt + 1;
      continue;
    }
    const end = tagEnd(part, lt);
    if (end < 0) {
      // Not a tag within the cap: skip the stretch it covers rather than rescanning it.
      i = lt + MAX_TAG_TEXT;
      out.push(" ");
      continue;
    }
    out.push(" ");
    i = end;
    const [, slash, name] = match;
    if (slash) continue;
    if (SKIP_RAW.has(name)) i = skipRaw(part, lower, name, end);
    else if (SKIP_NESTED.has(name) && part.charCodeAt(end - 2) !== 47) i = skipNested(part, lower, name, end);
  }
  return collapse(decodeEntities(out.join("")));
}

/** Text that may hold markup (a product description): its visible text; otherwise decoded and collapsed. */
export function plainText(text: string): string {
  return /<[a-z!/]/i.test(text) ? visibleText(text) : collapse(decodeEntities(text));
}

/** <meta> contents keyed by property, name or itemprop (lowercased). A key may repeat (og:image). */
export function metaTags(html: string, limit = 500): Record<string, string[]> {
  const meta: Record<string, string[]> = {};
  for (const { attributes } of startTags(html, "meta", limit)) {
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop)?.trim().toLowerCase();
    const content = attributes.content === undefined ? undefined : collapse(attributes.content);
    if (!key || !content) continue;
    (meta[key] ??= []).push(content);
  }
  return meta;
}

export function titleOf(html: string): string | undefined {
  const found = rawContent(html, asciiLower(html), "title");
  const text = found ? collapse(decodeEntities(found.text)) : "";
  return text || undefined;
}

export function firstHeading(html: string): string | undefined {
  const found = rawContent(html, asciiLower(html), "h1");
  const text = found ? visibleText(found.text) : "";
  return text || undefined;
}

const MAX_JSON_LD_BLOCKS = 20;
const MAX_JSON_LD_CHARS = 200_000;

/** Parsed JSON-LD blocks. A block that does not parse is skipped, never fatal. */
export function jsonLdBlocks(html: string): unknown[] {
  const lower = asciiLower(html);
  const blocks: unknown[] = [];
  for (let from = 0, seen = 0; seen < 200 && blocks.length < MAX_JSON_LD_BLOCKS; seen++) {
    const at = findTag(lower, "<script", from);
    if (at < 0) break;
    const start = tagEnd(html, at);
    if (start < 0) {
      from = at + MAX_TAG_TEXT;
      continue;
    }
    const close = findTag(lower, "</script", start);
    const stop = close < 0 ? html.length : close;
    from = stop;
    const type = parseAttributes(html.slice(at, start)).type?.trim().toLowerCase();
    if (type !== "application/ld+json") continue;
    const text = html
      .slice(start, Math.min(stop, start + MAX_JSON_LD_CHARS))
      .trim()
      .replace(/^<!--|-->$/g, "")
      .replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "");
    for (const candidate of [text, text.replace(/[\x00-\x1f]+/g, " ")]) {
      try {
        blocks.push(JSON.parse(candidate) as unknown);
        break;
      } catch {
        // Try the next cleanup, then give up on this block.
      }
    }
  }
  return blocks;
}

const PRODUCT_TYPES = new Set(["product", "productgroup", "individualproduct", "productmodel", "someproducts"]);

function isProductNode(node: Record<string, unknown>): boolean {
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return types.some((type) => typeof type === "string" && PRODUCT_TYPES.has(type.split(/[/:#]/).pop()?.toLowerCase() ?? ""));
}

/** The first schema.org Product in JSON-LD values: top level, arrays, @graph or nested (bounded walk). */
export function findProductNode(values: readonly unknown[]): Record<string, unknown> | undefined {
  const queue: { value: unknown; depth: number }[] = values.map((value) => ({ value, depth: 0 }));
  for (let visited = 0; queue.length > 0 && visited < 2_000; visited++) {
    const { value, depth } = queue.shift() as { value: unknown; depth: number };
    if (Array.isArray(value)) {
      if (depth < 6) for (const item of value) queue.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    if (isProductNode(node)) return node;
    if (depth < 6) for (const child of Object.values(node)) if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
  }
  return undefined;
}
