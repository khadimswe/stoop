import { describe, expect, it } from "vitest";
import { capText, decodeEntities, findProductNode, firstHeading, jsonLdBlocks, metaTags, parseAttributes, plainText, titleOf, visibleText } from "./html";

const EM_DASH = String.fromCharCode(0x2014);

describe("decodeEntities", () => {
  it("decodes numeric and common named entities", () => {
    expect(decodeEntities("Salt &amp; Pepper &lt;b&gt; &quot;hot&quot; Women&#39;s Men&#x27;s")).toBe(`Salt & Pepper <b> "hot" Women's Men's`);
    expect(decodeEntities("Caf&eacute; CAF&Eacute; Jalape&ntilde;o")).toBe(`Caf${String.fromCharCode(0xe9)} CAF${String.fromCharCode(0xc9)} Jalape${String.fromCharCode(0xf1)}o`);
    expect(decodeEntities("a&nbsp;b")).toBe(`a${String.fromCharCode(160)}b`);
    expect(decodeEntities("a&mdash;b")).toBe(`a${EM_DASH}b`);
    expect(decodeEntities("&#x1F336;")).toBe(String.fromCodePoint(0x1f336));
  });

  it("leaves unknown names alone and neutralizes bad code points", () => {
    expect(decodeEntities("&madeup; & &amp")).toBe("&madeup; & &amp");
    expect(decodeEntities("&#0;&#xD800;&#1114112;")).toBe(String.fromCharCode(0xfffd).repeat(3));
    expect(decodeEntities("a&#10;b&#7;c")).toBe("a b c");
  });
});

describe("visibleText", () => {
  it("drops scripts, styles, navigation, headers, footers, buttons and comments", () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body>
      <header><a href="/">Shop</a></header><nav><ul><li>Home</li></ul></nav>
      <h1>Trail&nbsp;Mug</h1><!-- hidden --><p>Keeps   coffee
      hot.</p><script>var x = "</div>";</script><button>Add to cart</button>
      <select><option>Red</option></select><footer>Copyright</footer></body></html>`;
    expect(visibleText(html)).toBe("Trail Mug Keeps coffee hot.");
  });

  it("reads only <main> when the page has one", () => {
    expect(visibleText("<body><div>Announcement</div><main id=x><p>The product</p></main><div>Newsletter</div></body>")).toBe("The product");
  });

  it("counts nested elements, ignores look-alike names and self-closing tags", () => {
    expect(visibleText("<nav>a<nav>b</nav>c</nav>after")).toBe("after");
    expect(visibleText("<navbar>kept</navbar>")).toBe("kept");
    expect(visibleText("<svg/>shown<svg><svg/>x</svg>too")).toBe("shown too");
  });

  it("survives broken markup", () => {
    expect(visibleText("text <script>never closed")).toBe("text");
    expect(visibleText("a < b and <3")).toBe("a < b and <3");
    expect(visibleText('<p title="x > y">inside</p>')).toBe("inside");
  });

  it("stays fast on hostile pages", () => {
    const started = Date.now();
    visibleText("<script>".repeat(100_000));
    visibleText("<nav>".repeat(100_000));
    visibleText(`<p a="${"x".repeat(500_000)}`);
    jsonLdBlocks('<script type="application/ld+json">'.repeat(50_000));
    metaTags("<meta ".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("tags and attributes", () => {
  it("parse quoted, unquoted and entity-encoded attributes", () => {
    expect(parseAttributes(`<meta property='og:title' content="Salt &amp; Pepper" data-x=1 hidden>`)).toEqual({
      property: "og:title",
      content: "Salt & Pepper",
      "data-x": "1",
      hidden: "",
    });
  });

  it("collect meta tags by property, name or itemprop, keeping repeats", () => {
    const meta = metaTags(`<meta property="og:image" content="https://a/1.jpg"><META NAME="Description" CONTENT=" Hot  sauce "><meta property="og:image" content="https://a/2.jpg"><meta itemprop="price" content="14">`);
    expect(meta).toEqual({ "og:image": ["https://a/1.jpg", "https://a/2.jpg"], description: ["Hot sauce"], price: ["14"] });
  });

  it("read the title and the first heading", () => {
    expect(titleOf("<head><title> Trail Mug &ndash; Shop </title></head>")).toBe(`Trail Mug ${String.fromCharCode(0x2013)} Shop`);
    expect(firstHeading("<h1 class=x>The <em>Trail</em> Mug</h1><h1>Second</h1>")).toBe("The Trail Mug");
    expect(titleOf("<p>no title</p>")).toBeUndefined();
  });
});

describe("JSON-LD", () => {
  it("parses blocks, skips broken ones and other script types", () => {
    const html = [
      '<script type="application/ld+json">{"@type":"Organization","name":"Shop"}</script>',
      '<script type="application/ld+json">{not json}</script>',
      '<script type="text/javascript">{"@type":"Product"}</script>',
      '<script type=" Application/LD+JSON ">\n<!--{"@type":"Product","name":"Mug"}-->\n</script>',
      '<script type="application/ld+json">{"@type":"Product","description":"line one\nline two"}</script>',
    ].join("");
    const blocks = jsonLdBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toEqual({ "@type": "Product", description: "line one line two" });
  });

  it("finds the Product in @graph, arrays, nested nodes and typed lists", () => {
    expect(findProductNode([{ "@graph": [{ "@type": "WebPage" }, { "@type": "Product", name: "A" }] }])?.name).toBe("A");
    expect(findProductNode([[{ "@type": "BreadcrumbList" }, { "@type": ["Thing", "Product"], name: "B" }]])?.name).toBe("B");
    expect(findProductNode([{ "@type": "WebPage", mainEntity: { "@type": "http://schema.org/Product", name: "C" } }])?.name).toBe("C");
    expect(findProductNode([{ "@type": "ProductGroup", name: "D" }])?.name).toBe("D");
    expect(findProductNode([{ "@type": "Organization" }, "text", null, 4])).toBeUndefined();
  });
});

describe("text helpers", () => {
  it("cap at a word boundary when one is near", () => {
    expect(capText("alpha beta gamma delta", 19)).toBe("alpha beta gamma");
    // No space in the last fifth: a hard cut rather than losing most of the text.
    expect(capText("one two three four", 9)).toBe("one two t");
    expect(capText("abcdefghij", 4)).toBe("abcd");
    expect(capText("short", 10)).toBe("short");
  });

  it("read markup or plain text", () => {
    expect(plainText("<p>Small&nbsp;batch</p><p>hot sauce</p>")).toBe("Small batch hot sauce");
    expect(plainText("  Women&#39;s   tee ")).toBe("Women's tee");
  });
});
