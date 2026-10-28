// Copies MapLibre's web worker into public/maplibre, so the block map loads it from Stoop's own
// origin (worker-src 'self'). The worker's one em dash (a key in its vertical-punctuation table) is
// written as a JavaScript unicode escape: the same string to the engine, and the repository stays
// free of the character. The copy starts with an eslint-disable line: it is MapLibre's build, not
// Stoop's code. Run after upgrading maplibre-gl: node scripts/vendor-maplibre.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DASH = String.fromCharCode(0x2014);
const ESCAPED = ["\\", "u", "2014"].join("");
const from = path.join("node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const to = path.join("public", "maplibre", "maplibre-gl-worker.mjs");
const source = `/* eslint-disable */\n${readFileSync(from, "utf8").replaceAll(DASH, ESCAPED)}`;
mkdirSync(path.dirname(to), { recursive: true });
writeFileSync(to, source);
console.log(`Wrote ${to} (${source.length} bytes)`);
