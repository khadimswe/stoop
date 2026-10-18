// Open Graph cards for the marketing pages and the examples (1200 x 630, PNG), drawn with next/og at
// build time. Daylight paper with one dark "screen" object, as on the site. Fonts are static instances
// of Bricolage Grotesque and Figtree (SIL Open Font License 1.1, see ./fonts/OFL.txt), read once.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ExampleSlug } from "@/lib/demo/examples";
import { realityCard } from "@/lib/marketing/landing";
import { loadExampleReport } from "@/lib/report/load";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const C = {
  paper: "#fbf5ec",
  sunSoft: "#ffe7a8",
  ink: "#1d1a2b",
  inkSoft: "#4b4660",
  screen: "#14121f",
  paperDim: "#b9b3c9",
  dusk: "#5b45e0",
  duskLight: "#a99bff",
  concreteScreen: "#9c968c",
} as const;

const FONT_DIR = join(process.cwd(), "components/stoop/marketing/og/fonts");
const fonts = Promise.all([readFile(join(FONT_DIR, "bricolage-grotesque-800-condensed.ttf")), readFile(join(FONT_DIR, "figtree-600.ttf"))]);

export interface OgLine {
  text: string;
  /** A small tag under the line, as on the site: who it speaks for. */
  tag?: "Qloo" | "Brand" | "Not from Qloo";
  mono?: boolean;
}

export interface OgCard {
  kicker: string;
  title: string;
  sub?: string;
  screen: { label: string; lines: OgLine[] };
}

function Tag({ tag }: { tag: NonNullable<OgLine["tag"]> }) {
  const qloo = tag === "Qloo";
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        marginTop: 10,
        padding: "4px 14px",
        borderRadius: 999,
        fontSize: 18,
        border: `2px ${tag === "Not from Qloo" ? "dashed" : "solid"} ${qloo ? C.duskLight : tag === "Brand" ? C.paper : C.concreteScreen}`,
        background: qloo ? C.duskLight : "transparent",
        color: qloo ? C.screen : tag === "Brand" ? C.paper : C.concreteScreen,
      }}
    >
      {tag}
    </div>
  );
}

export async function ogImage(card: OgCard): Promise<ImageResponse> {
  const [display, sans] = await fonts;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.paper, fontFamily: "Figtree", color: C.ink }}>
        <div style={{ position: "absolute", top: -170, left: -150, width: 520, height: 520, borderRadius: 999, background: C.sunSoft }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640, padding: "56px 0 56px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="9" fill={C.ink} />
              <path d="M8 22h16M10 18h12M12 14h8M14 10h4" stroke={C.paper} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div style={{ fontFamily: "Bricolage", fontSize: 44, letterSpacing: -1 }}>Stoop</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontSize: 22, letterSpacing: 2.5, textTransform: "uppercase", color: C.inkSoft }}>{card.kicker}</div>
            <div style={{ fontFamily: "Bricolage", fontSize: card.title.length > 30 ? 72 : 86, lineHeight: 0.94, letterSpacing: -2 }}>{card.title}</div>
            {card.sub && <div style={{ fontSize: 30, lineHeight: 1.3, color: C.inkSoft }}>{card.sub}</div>}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", padding: "48px 64px 48px 32px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 22,
              width: "100%",
              padding: 32,
              borderRadius: 28,
              border: `4px solid ${C.ink}`,
              boxShadow: `10px 12px 0 ${C.ink}`,
              background: C.screen,
              color: C.paper,
            }}
          >
            <div style={{ fontSize: 16, letterSpacing: 2.5, textTransform: "uppercase", color: C.paperDim }}>{card.screen.label}</div>
            {card.screen.lines.map((line, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    fontFamily: line.tag === "Qloo" ? "Bricolage" : "Figtree",
                    fontSize: line.tag === "Qloo" ? 30 : 22,
                    lineHeight: 1.2,
                    color: line.tag === "Not from Qloo" ? C.concreteScreen : C.paper,
                  }}
                >
                  {line.text}
                </div>
                {line.tag && <Tag tag={line.tag} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Bricolage", data: display, weight: 800, style: "normal" },
        { name: "Figtree", data: sans, weight: 600, style: "normal" },
      ],
    },
  );
}

/** The screen lines for an example: the founder's words and what Qloo measured, verbatim. */
export function exampleScreen(slug: ExampleSlug): OgCard["screen"] {
  const card = realityCard(slug, loadExampleReport(slug));
  const lines: OgLine[] = [];
  const said = card?.lines.find((l) => l.kind === "said");
  const measured = card?.lines.find((l) => l.kind === "measured");
  if (said) lines.push({ text: said.text, tag: "Brand" });
  if (measured) lines.push({ text: measured.text, tag: "Qloo" });
  return { label: `Reality Check · ${card?.brand ?? slug}`, lines };
}

/** An example report's card: for app/(app)/examples/[slug]/opengraph-image.tsx. */
export async function exampleOgImage(slug: ExampleSlug): Promise<ImageResponse> {
  const report = loadExampleReport(slug);
  const { product } = report.inputs;
  return ogImage({
    kicker: "Example · recorded Qloo",
    title: product.brandName ?? product.name,
    sub: `${product.name.charAt(0).toUpperCase()}${product.name.slice(1)}: the Reality Check, concept worlds and Campaign Kit.`,
    screen: exampleScreen(slug),
  });
}
