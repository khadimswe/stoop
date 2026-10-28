// The poster as one PNG, drawn with next/og, in the look of the posters stores already put up, a bit
// cleaner: a dark ground in the carrier's color set (colors only, never a logo), a neon date pill, one
// huge glowing headline, the deals as up to 4 cards (a short label over the offer verbatim), a prize
// wheel badge when the plan has a wheel, and the store's name, address and phone in the footer. The
// background is the plan's rendered art under a dark scrim, or a plain neon-lit ground when there is
// none. Every word is set by code from lib/plan/poster-text.ts, so the text is always exact. A store's
// own official logo, when it supplies one, sits at the top; Stoop never draws or generates one.
// 1080 by 1350 for Instagram portrait; 1200 by 630 for link previews.
// Fonts are the OG cards' static instances (SIL Open Font License 1.1), embedded in ./poster-fonts.ts
// so they ship with the route's bundle; a font that fails to decode falls back to next/og's built-in
// font, so the poster always draws.
import { ImageResponse } from "next/og";
import { POSTER_DISPLAY_FONT_BASE64, POSTER_SANS_FONT_BASE64 } from "./poster-fonts";
import type { PosterText } from "./poster-text";
import type { Store } from "./schema";

export const POSTER_SIZES = {
  portrait: { width: 1080, height: 1350 },
  og: { width: 1200, height: 630 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

/** One carrier's colors: a dark ground, a neon primary and three accents, and the text colors on them. */
export interface PosterPalette {
  ground: string;
  ground2: string;
  card: string;
  primary: string;
  glow: string;
  accent: string;
  accent2: string;
  hot: string;
  text: string;
  muted: string;
}

/** Colors only, never a logo. Every text color meets AA on the ground and on the cards (poster-image.test.ts). */
export const CARRIER_PALETTES: Record<Store["carrier"], PosterPalette> = {
  metro: { ground: "#0b0612", ground2: "#1c0b31", card: "#1a0c2c", primary: "#b26bff", glow: "rgba(178,107,255,0.6)", accent: "#c6ff3d", accent2: "#ff9b2f", hot: "#ff5fd9", text: "#ffffff", muted: "#ddd2ee" },
  cricket: { ground: "#03110a", ground2: "#0a2a19", card: "#0b2216", primary: "#3fe684", glow: "rgba(63,230,132,0.55)", accent: "#d4ff4a", accent2: "#ffd23f", hot: "#6ff5c6", text: "#ffffff", muted: "#d2ecdd" },
  boost: { ground: "#120802", ground2: "#2b1304", card: "#26110a", primary: "#ff8a1f", glow: "rgba(255,138,31,0.55)", accent: "#ffd23f", accent2: "#ff7a59", hot: "#ffb46b", text: "#ffffff", muted: "#f2dfcf" },
  other: { ground: "#0b0c10", ground2: "#1b1e28", card: "#181b24", primary: "#93abff", glow: "rgba(147,171,255,0.5)", accent: "#e9eefb", accent2: "#ffd23f", hot: "#b9c7ff", text: "#ffffff", muted: "#d4d9e6" },
};

/** A TrueType font from its base64, or null when it does not decode to one. */
function decodeFont(base64: string): Buffer | null {
  const bytes = Buffer.from(base64, "base64");
  return bytes.byteLength > 12 && bytes.readUInt32BE(0) === 0x00010000 ? bytes : null;
}

// Decoded once, when the module loads.
const DISPLAY = decodeFont(POSTER_DISPLAY_FONT_BASE64);
const SANS = decodeFont(POSTER_SANS_FONT_BASE64);

function fonts() {
  return [
    ...(DISPLAY ? [{ name: "Bricolage", data: DISPLAY, weight: 800 as const, style: "normal" as const }] : []),
    ...(SANS ? [{ name: "Figtree", data: SANS, weight: 600 as const, style: "normal" as const }] : []),
  ];
}

/** The place lines: the store and its address (and phone), or the event's place with the store still named. */
export function where(text: Pick<PosterText, "location" | "store" | "address" | "phone">): { main: string; sub: string } {
  const phone = text.phone ? ` · ${text.phone}` : "";
  return text.location ? { main: text.location, sub: `Hosted by ${text.store}${phone}` } : { main: text.store, sub: `${text.address}${phone}` };
}

export interface PosterArt {
  /** The background as a data URI (fetched by the caller from Stoop's own storage). */
  dataUri: string;
}

/** A store's own official logo, supplied by the store (never generated), drawn at the top. */
export interface PosterLogo {
  dataUri: string;
  width: number;
  height: number;
}

// --- Fitting ---------------------------------------------------------------------------------------

/** Rough wrapped line count: the text's width at an average glyph width (a share of the size), plus slack for word breaks. */
const linesOf = (text: string, font: number, em: number, width: number) => Math.max(1, Math.ceil((text.length * font * em * 1.12) / width));
/** Bricolage condensed in capitals, and Figtree, as shares of the font size. */
const DISPLAY_EM = 0.55;
const SANS_EM = 0.53;

/** The deal cards a poster draws: at most 4, the rest summed up in one line. */
export const MAX_DEAL_CARDS = 4;
export const OG_DEAL_CARDS = 2;

/**
 * The headline at the largest size that keeps it to `maxLines`. Only when even the smallest size
 * cannot hold it is it shortened, by code: to the part before a colon or dash, else to its first words.
 */
export function fitHeadline(title: string, width: number, sizes: readonly number[], maxLines = 3): { text: string; size: number } {
  const fits = (text: string, size: number) => linesOf(text, size, DISPLAY_EM, width) <= maxLines;
  for (const size of sizes) if (fits(title, size)) return { text: title, size };
  const smallest = sizes[sizes.length - 1]!;
  const head = title.split(/\s*:\s*|\s+-\s+/)[0]!.trim();
  if (head && head !== title) for (const size of sizes) if (fits(head, size)) return { text: head, size };
  const words = title.split(/\s+/);
  for (let n = words.length - 1; n >= 1; n--) {
    const text = words.slice(0, n).join(" ").replace(/[,:;.-]+$/, "");
    if (fits(text, smallest)) return { text, size: smallest };
  }
  return { text: words[0] ?? title, size: smallest };
}

export interface PortraitLayout {
  headline: { text: string; size: number };
  label: number;
  body: number;
  /** Deal cards drawn (the rest are counted in one line). */
  shown: number;
}

const PORTRAIT_WIDTH = 960;
const HEADLINE_SIZES = [150, 130, 114, 100, 88];
const CARD_SIZES = [
  { label: 54, body: 23 },
  { label: 46, body: 21 },
  { label: 40, body: 19 },
];

/** Card rows' estimated height for `shown` deals at one size. */
function cardsHeight(text: PosterText, shown: number, size: { label: number; body: number }): number {
  if (shown === 0) return 0;
  const cols = shown === 1 ? 1 : 2;
  const inner = (cols === 1 ? PORTRAIT_WIDTH : (PORTRAIT_WIDTH - 20) / 2) - 48;
  const deals = text.deals.slice(0, shown);
  let height = 0;
  for (let row = 0; row < deals.length; row += cols) {
    const cards = deals.slice(row, row + cols);
    height += Math.max(...cards.map((d) => 44 + linesOf(d.label, size.label, DISPLAY_EM, inner) * size.label * 0.95 + 10 + linesOf(d.text, size.body, SANS_EM, inner) * size.body * 1.25)) + 18;
  }
  return height + (text.deals.length > shown ? 40 : 0);
}

/** The largest portrait layout whose estimated height fits 1350 px, so the footer never falls off. */
export function portraitLayout(text: PosterText, hasLogo = false): PortraitLayout {
  const shownMax = Math.min(MAX_DEAL_CARDS, text.deals.length);
  const top = 52 + (hasLogo ? 118 : 0) + 62 + 26;
  const wheel = text.wheel ? 132 + 26 : 0;
  const place = where(text);
  const footer = 46 * 1.05 + 8 + linesOf(place.sub, 25, SANS_EM, PORTRAIT_WIDTH) * 25 * 1.3 + (text.disclaimer ? 10 + 18 * 1.35 : 0) + 48;
  const budget = 1350 - top - wheel - footer - 40;
  for (const size of HEADLINE_SIZES) {
    const headline = fitHeadline(text.title, PORTRAIT_WIDTH, [size]);
    if (headline.text !== text.title) continue;
    const titleHeight = linesOf(headline.text, size, DISPLAY_EM, PORTRAIT_WIDTH) * size * 0.9 + 30;
    for (const cards of CARD_SIZES) if (titleHeight + cardsHeight(text, shownMax, cards) <= budget) return { headline, ...cards, shown: shownMax };
  }
  // Nothing fit at full length: the smallest sizes, the headline shortened only if it must be, fewer cards last.
  const smallest = CARD_SIZES[CARD_SIZES.length - 1]!;
  const headline = fitHeadline(text.title, PORTRAIT_WIDTH, HEADLINE_SIZES);
  const titleHeight = linesOf(headline.text, headline.size, DISPLAY_EM, PORTRAIT_WIDTH) * headline.size * 0.9 + 30;
  for (let shown = shownMax; shown >= 1; shown--) if (titleHeight + cardsHeight(text, shown, smallest) <= budget) return { headline, ...smallest, shown };
  return { headline, ...smallest, shown: Math.min(shownMax, 2) };
}

// --- Pieces ----------------------------------------------------------------------------------------

function Pill({ text, p, size }: { text: string; p: PosterPalette; size: PosterSize }) {
  const big = size === "portrait";
  return (
    <div
      style={{
        display: "flex",
        alignSelf: big ? "center" : "flex-start",
        padding: big ? "13px 34px" : "8px 22px",
        borderRadius: 999,
        border: `3px solid ${p.primary}`,
        background: "rgba(0,0,0,0.45)",
        boxShadow: `0 0 26px ${p.glow}`,
        color: p.text,
        fontSize: big ? 30 : 20,
        letterSpacing: big ? 2.5 : 1.5,
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  );
}

function Headline({ text, size, p, align }: { text: string; size: number; p: PosterPalette; align: "center" | "left" }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: align === "center" ? "center" : "flex-start",
        textAlign: align,
        fontFamily: "Bricolage",
        fontSize: size,
        lineHeight: 0.9,
        letterSpacing: -1,
        textTransform: "uppercase",
        color: p.text,
        textShadow: `0 0 22px ${p.glow}, 0 0 3px ${p.primary}`,
      }}
    >
      {text}
    </div>
  );
}

const labelColor = (p: PosterPalette, i: number) => [p.accent, p.accent2, p.hot, p.primary][i % 4]!;

function DealCards({ text, p, size, layout }: { text: PosterText; p: PosterPalette; size: PosterSize; layout: { label: number; body: number; shown: number } }) {
  const deals = text.deals.slice(0, layout.shown);
  if (deals.length === 0) return null;
  const big = size === "portrait";
  const width = big ? PORTRAIT_WIDTH : 680;
  const cols = deals.length === 1 ? 1 : 2;
  const cardWidth = cols === 1 ? width : (width - (big ? 20 : 14)) / 2;
  const more = text.deals.length - deals.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 18 : 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: big ? "center" : "flex-start", gap: big ? 18 : 12, width }}>
        {deals.map((deal, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              width: cardWidth,
              padding: big ? "22px 24px" : "12px 16px",
              borderRadius: big ? 26 : 16,
              border: `3px solid ${p.primary}`,
              background: p.card,
              boxShadow: `0 0 20px ${p.glow}`,
              gap: big ? 10 : 6,
            }}
          >
            <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: layout.label, lineHeight: 0.95, textTransform: "uppercase", color: labelColor(p, i) }}>{deal.label}</div>
            <div style={{ display: "flex", fontSize: layout.body, lineHeight: 1.25, color: p.muted }}>{deal.text}</div>
          </div>
        ))}
      </div>
      {more > 0 && <div style={{ display: "flex", justifyContent: big ? "center" : "flex-start", fontSize: big ? 26 : 16, color: p.accent }}>{`+${more} more ${more === 1 ? "deal" : "deals"} at the table`}</div>}
    </div>
  );
}

/** A prize wheel drawn by code: 8 wedges in the palette, a hub and a pointer. */
function WheelIcon({ p, size }: { p: PosterPalette; size: number }) {
  const r = 46;
  const c = 50;
  const colors = [p.primary, p.accent, p.accent2, p.hot];
  const at = (deg: number) => [c + r * Math.sin((deg * Math.PI) / 180), c - r * Math.cos((deg * Math.PI) / 180)] as const;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {Array.from({ length: 8 }, (_, i) => {
        const [x0, y0] = at(i * 45);
        const [x1, y1] = at((i + 1) * 45);
        return <path key={i} d={`M${c} ${c} L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} fill={colors[i % 4]} stroke="#0b0612" strokeWidth="1.5" />;
      })}
      <circle cx={c} cy={c} r="9" fill="#ffffff" stroke="#0b0612" strokeWidth="2" />
      <path d="M50 1 L57 13 L43 13 Z" fill="#ffffff" />
    </svg>
  );
}

function WheelBadge({ text, p, size }: { text: PosterText; p: PosterPalette; size: PosterSize }) {
  if (!text.wheel) return null;
  const big = size === "portrait";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        alignSelf: big ? "center" : "flex-start",
        gap: big ? 22 : 12,
        padding: big ? "16px 30px 16px 18px" : "8px 18px 8px 10px",
        borderRadius: 999,
        border: `3px solid ${p.accent2}`,
        background: "rgba(0,0,0,0.5)",
        boxShadow: `0 0 22px ${p.glow}`,
      }}
    >
      <WheelIcon p={p} size={big ? 96 : 52} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: big ? 44 : 24, lineHeight: 1, textTransform: "uppercase", color: p.accent2 }}>Spin the prize wheel</div>
        {text.wheelWhat && <div style={{ display: "flex", fontSize: big ? 22 : 14, color: p.text }}>{`${text.wheelWhat}.`}</div>}
        <div style={{ display: "flex", fontSize: big ? 22 : 14, color: p.accent }}>Free to spin, no purchase needed.</div>
      </div>
    </div>
  );
}

function Ground({ art, p, size }: { art: PosterArt | null; p: PosterPalette; size: PosterSize }) {
  const { width, height } = POSTER_SIZES[size];
  if (art) {
    const scrim =
      size === "portrait"
        ? "linear-gradient(180deg, rgba(5,3,10,0.78) 0%, rgba(5,3,10,0.35) 22%, rgba(5,3,10,0.45) 38%, rgba(5,3,10,0.7) 55%, rgba(5,3,10,0.82) 75%, rgba(5,3,10,0.92) 100%)"
        : "linear-gradient(90deg, rgba(5,3,10,0.94) 0%, rgba(5,3,10,0.82) 55%, rgba(5,3,10,0.3) 100%)";
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={art.dataUri} width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 0, left: 0, width, height, display: "flex", backgroundImage: scrim }} />
      </>
    );
  }
  return (
    <>
      <div style={{ position: "absolute", top: 0, left: 0, width, height, display: "flex", backgroundImage: `linear-gradient(160deg, ${p.ground2} 0%, ${p.ground} 50%, ${p.ground2} 100%)` }} />
      {/* Two soft neon glows, each a radial gradient inside the canvas. */}
      <div style={{ position: "absolute", top: 0, left: 0, width, height, display: "flex", backgroundImage: `radial-gradient(circle at 18% 16%, ${p.glow} 0%, rgba(0,0,0,0) 38%)` }} />
      <div style={{ position: "absolute", top: 0, left: 0, width, height, display: "flex", backgroundImage: `radial-gradient(circle at 88% 84%, ${p.glow} 0%, rgba(0,0,0,0) 32%)` }} />
    </>
  );
}

function Footer({ text, p, size }: { text: PosterText; p: PosterPalette; size: PosterSize }) {
  const big = size === "portrait";
  const place = where(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: big ? "center" : "flex-start", textAlign: big ? "center" : "left", gap: big ? 6 : 2 }}>
      <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: big ? 46 : 28, lineHeight: 1.05, color: p.text }}>{place.main}</div>
      <div style={{ display: "flex", fontSize: big ? 25 : 17, lineHeight: 1.3, color: p.muted }}>{place.sub}</div>
      {text.disclaimer && <div style={{ display: "flex", marginTop: big ? 8 : 4, fontSize: big ? 18 : 13, color: p.muted }}>{text.disclaimer}</div>}
    </div>
  );
}

function Logo({ logo, maxWidth, maxHeight }: { logo: PosterLogo; maxWidth: number; maxHeight: number }) {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1);
  const width = Math.round(logo.width * scale);
  const height = Math.round(logo.height * scale);
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img src={logo.dataUri} width={width} height={height} style={{ width, height }} />;
}

// --- The two sizes ---------------------------------------------------------------------------------

function Portrait({ text, art, logo }: { text: PosterText; art: PosterArt | null; logo: PosterLogo | null }) {
  const p = CARRIER_PALETTES[text.carrier];
  const layout = portraitLayout(text, logo !== null);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: p.ground, fontFamily: "Figtree", color: p.text }}>
      <Ground art={art} p={p} size="portrait" />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "52px 60px 48px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          {logo && <Logo logo={logo} maxWidth={420} maxHeight={100} />}
          <Pill text={`${text.date} · ${text.time}`} p={p} size="portrait" />
          <Headline text={layout.headline.text} size={layout.headline.size} p={p} align="center" />
        </div>
        <DealCards text={text} p={p} size="portrait" layout={layout} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <WheelBadge text={text} p={p} size="portrait" />
          <Footer text={text} p={p} size="portrait" />
        </div>
      </div>
    </div>
  );
}

function Og({ text, art, logo }: { text: PosterText; art: PosterArt | null; logo: PosterLogo | null }) {
  const p = CARRIER_PALETTES[text.carrier];
  const headline = fitHeadline(text.title, 700, [92, 78, 66, 56], text.deals.length > 0 ? 2 : 3);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: p.ground, fontFamily: "Figtree", color: p.text }}>
      <Ground art={art} p={p} size="og" />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: 800, height: "100%", padding: "40px 0 36px 56px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {logo && <Logo logo={logo} maxWidth={260} maxHeight={56} />}
          <Pill text={`${text.date} · ${text.time}`} p={p} size="og" />
          <Headline text={headline.text} size={headline.size} p={p} align="left" />
        </div>
        <DealCards text={text} p={p} size="og" layout={{ label: 28, body: 15, shown: Math.min(OG_DEAL_CARDS, text.deals.length) }} />
        <Footer text={text} p={p} size="og" />
      </div>
      {text.wheel && (
        <div style={{ position: "absolute", right: 40, bottom: 40, display: "flex" }}>
          <WheelBadge text={text} p={p} size="og" />
        </div>
      )}
    </div>
  );
}

/** The composited poster. `art` null draws the plain neon ground; `logo` is the store's own, or null. */
export function posterImage(text: PosterText, art: PosterArt | null, size: PosterSize, headers: Record<string, string> = {}, logo: PosterLogo | null = null): ImageResponse {
  return new ImageResponse(size === "og" ? <Og text={text} art={art} logo={logo} /> : <Portrait text={text} art={art} logo={logo} />, {
    ...POSTER_SIZES[size],
    fonts: fonts(),
    headers,
  });
}
