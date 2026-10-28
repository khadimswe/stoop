// The poster as one PNG, drawn with next/og: the background art (when it rendered) under a dark scrim,
// or the plain Stoop background (paper, a sun disc, a brick band) when there is none, and every word
// on top set by code from lib/plan/poster-text.ts, so the text is always exact. 1080 by 1350 for
// Instagram portrait; 1200 by 630 for link previews. No carrier logo is ever drawn.
// Fonts are the OG cards' static instances (SIL Open Font License 1.1), embedded in ./poster-fonts.ts
// so they ship with the route's bundle; a font that fails to decode falls back to next/og's built-in
// font, so the poster always draws.
import { ImageResponse } from "next/og";
import { POSTER_DISPLAY_FONT_BASE64, POSTER_SANS_FONT_BASE64 } from "./poster-fonts";
import type { PosterText } from "./poster-text";

export const POSTER_SIZES = {
  portrait: { width: 1080, height: 1350 },
  og: { width: 1200, height: 630 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

const C = {
  paper: "#fbf5ec",
  ink: "#1d1a2b",
  inkSoft: "#4b4660",
  screen: "#14121f",
  sunSoft: "#ffe7a8",
  sun: "#ffc23d",
  brick: "#e8572e",
  brickSoft: "#ffdccb",
} as const;

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

/** A title size that keeps up to 60 characters on a few lines. */
function titleSize(title: string, size: PosterSize): number {
  const n = title.length;
  if (size === "og") return n > 40 ? 60 : n > 24 ? 72 : 84;
  return n > 44 ? 96 : n > 28 ? 116 : n > 16 ? 136 : 156;
}

/** The place lines: the store and its address, or the event's place with the store still named. */
export function where(text: PosterText): { main: string; sub: string } {
  return text.location ? { main: text.location, sub: `Hosted by ${text.store}` } : { main: text.store, sub: text.address };
}

export interface PosterArt {
  /** The background as a data URI (fetched by the caller from Stoop's own storage). */
  dataUri: string;
}

function Offers({ offers, art, size }: { offers: string[]; art: boolean; size: PosterSize }) {
  if (offers.length === 0) return null;
  const big = size === "portrait";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 14 : 10 }}>
      {offers.map((offer, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignSelf: "flex-start",
            maxWidth: "100%",
            padding: big ? "14px 24px" : "8px 16px",
            borderRadius: big ? 22 : 14,
            border: `${big ? 4 : 3}px solid ${C.ink}`,
            background: art ? C.sun : C.brickSoft,
            color: C.ink,
            fontSize: big ? (offer.length > 70 ? 30 : 36) : offer.length > 70 ? 20 : 24,
            lineHeight: 1.2,
          }}
        >
          {offer}
        </div>
      ))}
    </div>
  );
}

function Portrait({ text, art }: { text: PosterText; art: PosterArt | null }) {
  const fg = art ? C.paper : C.ink;
  const soft = art ? C.paper : C.inkSoft;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: art ? C.screen : C.paper, fontFamily: "Figtree", color: fg }}>
      {art ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={art.dataUri} width={1080} height={1350} style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1350, objectFit: "cover" }} />
          <div style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1350, display: "flex", backgroundImage: "linear-gradient(180deg, rgba(20,18,31,0.88) 0%, rgba(20,18,31,0.35) 24%, rgba(20,18,31,0.3) 38%, rgba(20,18,31,0.72) 52%, rgba(20,18,31,0.92) 68%, rgba(20,18,31,0.96) 100%)" }} />
        </>
      ) : (
        <>
          <div style={{ position: "absolute", top: -220, left: 500, width: 780, height: 780, borderRadius: 999, background: C.sunSoft }} />
          <div style={{ position: "absolute", top: 90, left: 690, width: 300, height: 300, borderRadius: 999, background: C.sun }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: 1080, height: 26, background: C.brick }} />
        </>
      )}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "84px 80px 92px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 40, letterSpacing: 3, textTransform: "uppercase", color: art ? C.sun : C.brick }}>{text.date}</div>
          <div style={{ fontSize: 56, color: fg }}>{text.time}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
          <div style={{ fontFamily: "Bricolage", fontSize: titleSize(text.title, "portrait"), lineHeight: 0.92, letterSpacing: -2, color: fg, ...(art ? { textShadow: "0 4px 28px rgba(20,18,31,0.7)" } : {}) }}>{text.title}</div>
          <Offers offers={text.offers} art={art !== null} size="portrait" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <div style={{ fontFamily: "Bricolage", fontSize: 50, lineHeight: 1.05, color: fg }}>{where(text).main}</div>
            <div style={{ fontSize: 32, lineHeight: 1.25, color: soft }}>{where(text).sub}</div>
            {text.disclaimer && <div style={{ marginTop: 14, fontSize: 22, color: soft }}>{text.disclaimer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Og({ text, art }: { text: PosterText; art: PosterArt | null }) {
  const fg = art ? C.paper : C.ink;
  const soft = art ? C.paper : C.inkSoft;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: art ? C.screen : C.paper, fontFamily: "Figtree", color: fg }}>
      {art ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={art.dataUri} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
          <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", backgroundImage: "linear-gradient(90deg, rgba(20,18,31,0.94) 0%, rgba(20,18,31,0.8) 52%, rgba(20,18,31,0.25) 100%)" }} />
        </>
      ) : (
        <>
          <div style={{ position: "absolute", top: -140, left: 840, width: 560, height: 560, borderRadius: 999, background: C.sunSoft }} />
          <div style={{ position: "absolute", top: 40, left: 960, width: 240, height: 240, borderRadius: 999, background: C.sun }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: 1200, height: 18, background: C.brick }} />
        </>
      )}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: 860, height: "100%", padding: "52px 64px 56px" }}>
        <div style={{ fontSize: 28, letterSpacing: 2.5, textTransform: "uppercase", color: art ? C.sun : C.brick }}>{`${text.date} · ${text.time}`}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontFamily: "Bricolage", fontSize: titleSize(text.title, "og"), lineHeight: 0.94, letterSpacing: -1.5, color: fg }}>{text.title}</div>
          <Offers offers={text.offers.slice(0, 2)} art={art !== null} size="og" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: "Bricolage", fontSize: 34, color: fg }}>{where(text).main}</div>
          <div style={{ fontSize: 22, color: soft }}>{where(text).sub}</div>
          {text.disclaimer && <div style={{ marginTop: 8, fontSize: 17, color: soft }}>{text.disclaimer}</div>}
        </div>
      </div>
    </div>
  );
}

/** The composited poster. `art` null draws the plain Stoop background. */
export function posterImage(text: PosterText, art: PosterArt | null, size: PosterSize, headers: Record<string, string> = {}): ImageResponse {
  return new ImageResponse(size === "og" ? <Og text={text} art={art} /> : <Portrait text={text} art={art} />, {
    ...POSTER_SIZES[size],
    fonts: fonts(),
    headers,
  });
}
