// Verifies every design-token color pair Stoop uses meets WCAG AA.
// Reads hex tokens straight from app/globals.css so the check can never drift from the theme.
//   text pairs: 4.5:1   UI pairs (borders, focus rings, icons): 3:1
import { readFileSync } from "node:fs";
import { AA, contrastRatio } from "../lib/design/contrast";

const css = readFileSync("app/globals.css", "utf8");
const tokens = new Map<string, string>();
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\b/gi)) tokens.set(match[1], match[2]);

type Pair = [foreground: string, background: string, kind: keyof typeof AA, use: string];

const PAIRS: Pair[] = [
  // The floor (store-events app and landing): warm grey page, white surfaces, black ink
  ["fl-ink", "fl-page", "text", "floor: body text on the page"],
  ["fl-muted", "fl-page", "text", "floor: body copy on the page"],
  ["fl-dim", "fl-page", "text", "floor: meta text on the page"],
  ["fl-ink", "surface", "text", "floor: text on white rows"],
  ["fl-muted", "surface", "text", "floor: secondary text on rows"],
  ["fl-dim", "surface", "text", "floor: meta text on rows"],
  ["fl-ink", "fl-band", "text", "floor: text on the band and the segmented track"],
  ["fl-muted", "fl-band", "text", "floor: secondary text and draft pills on the band"],
  ["fl-dim", "fl-band", "text", "floor: meta text on the band"],
  ["fl-ink", "fl-sunk", "text", "floor: text on a picked row"],
  ["surface", "fl-ink", "text", "floor: primary button label, filled chips and badges"],
  ["fl-ok", "fl-ok-bg", "text", "floor: Posted pill"],
  ["fl-ok", "surface", "text", "floor: Connected"],
  ["fl-bad", "surface", "text", "floor: errors on white"],
  ["fl-bad", "fl-page", "text", "floor: errors on the page"],
  ["fl-line", "surface", "ui", "floor: input, chip and secondary button borders on white"],
  ["fl-line", "fl-page", "ui", "floor: chip and button borders on the page"],
  ["fl-chev", "surface", "ui", "floor: chevrons"],
  ["fl-ink", "surface", "ui", "floor: number badges, checkboxes and focus rings"],
  ["fl-dark-bright", "fl-dark", "text", "floor: text on dark sections"],
  ["fl-dark-dim", "fl-dark", "text", "floor: secondary text on dark sections"],
  ["fl-dark-dim", "fl-dark-2", "text", "floor: the dark segmented control's labels"],
  ["fl-signal", "fl-dark", "text", "floor: lime captions on dark (never text on light)"],
  ["fl-ink", "fl-dark-bright", "text", "floor: the picked format and the dark CTA's button"],
  ["fl-signal", "fl-dark", "ui", "floor: focus rings on dark sections"],
  // Daylight (paper) surfaces
  ["ink", "paper", "text", "body text"],
  ["ink-soft", "paper", "text", "secondary text"],
  ["ink", "sand", "text", "text on sand sections"],
  ["ink-soft", "sand", "text", "secondary text on sand"],
  ["ink", "brick", "text", "primary button label"],
  ["dusk", "paper", "text", "interpreted chip text (Qloo)"],
  ["paper", "dusk", "text", "solid Qloo chip label"],
  ["dusk", "paper", "ui", "focus ring, Qloo chip border"],
  ["concrete-line", "paper", "ui", "Control frame, creative-suggestion dashed border"],
  ["rose-deep", "paper", "text", "flagged text"],
  ["paper", "rose-deep", "text", "flagged stamp label"],
  ["ink", "sun", "text", "text on sun highlight"],
  ["rose-deep", "rose-soft", "text", "flagged chip text and tag"],
  ["dusk", "paper-raised", "text", "interpreted chip text and tag"],
  ["ink-soft", "paper-raised", "text", "creative chip text and tag"],
  ["ink", "paper-raised", "text", "provenance badge, nav text, Your-choice chip text"],
  ["ink", "paper-raised", "ui", "Your-choice chip border"],
  ["concrete-line", "paper-raised", "ui", "creative chip dashed border"],
  // App register: white cards and filled inputs (hairlines are decorative dividers, not UI boundaries)
  ["ink", "surface", "text", "text on app cards"],
  ["ink-soft", "surface", "text", "secondary text on app cards"],
  ["dusk", "surface", "text", "interpreted chip text on app cards"],
  ["paper", "dusk", "text", "solid Qloo and seed chips on app cards"],
  ["rose-deep", "surface", "text", "flagged text on app cards"],
  ["concrete-line", "surface", "ui", "input borders, unselected chips, dashed creative border on app cards"],
  ["ink", "fill", "text", "input text on filled inputs"],
  ["ink-soft", "fill", "text", "placeholders and quiet labels on fills"],
  ["concrete-line", "fill", "ui", "input border against its own fill"],
  // Screening-room (dark) surfaces
  ["paper", "screen", "text", "text on screens"],
  ["paper-dim", "screen", "text", "secondary text on screens"],
  ["paper", "screen-raised", "text", "text on raised screen panels"],
  ["paper", "screen", "ui", "Your-choice chip border on screens"],
  ["paper-dim", "screen-raised", "text", "secondary text on raised panels"],
  ["dusk-light", "screen", "text", "Qloo chip text on screens"],
  ["screen", "dusk-light", "text", "solid Qloo chip on screens"],
  ["dusk-light", "screen", "ui", "focus ring on screens"],
  ["concrete-screen", "screen", "text", "Control label on screens"],
  ["concrete-screen", "screen", "ui", "Control frame on screens"],
  ["rose-light", "screen", "text", "flagged text on screens"],
  ["concrete-screen", "screen-raised", "text", "creative chip tag on raised screen panels"],
  ["dusk-light", "screen-raised", "text", "Qloo chip text on raised screen panels"],
  ["dusk", "paper", "ui", "focus ring around a screen (drawn on paper)"],
  ["ink", "brick", "ui", "primary button on screens (brick fill vs ink label)"],
  ["brick", "screen", "ui", "agent demo: the brick button against its screen"],
];

let failures = 0;
for (const [fg, bg, kind, use] of PAIRS) {
  const a = tokens.get(fg);
  const b = tokens.get(bg);
  if (!a || !b) {
    console.error(`MISSING token: ${!a ? fg : bg} (needed for ${use})`);
    failures++;
    continue;
  }
  const ratio = contrastRatio(a, b);
  const ok = ratio >= AA[kind];
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${ratio.toFixed(2).padStart(5)}:1 >= ${AA[kind]}  ${fg} on ${bg}  (${use})`);
}

if (failures > 0) {
  console.error(`${failures} contrast pair(s) below WCAG AA.`);
  process.exit(1);
}
console.log(`All ${PAIRS.length} pairs meet WCAG AA.`);
