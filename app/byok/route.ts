// GET /byok?reportId=&segment=: "Render with your fal key". A static page that reads nothing from the
// request (Cache Components prerenders it at build time) and carries no inline script, style or event
// handler: its code is public/byok/app.js and public/byok/app.css. The visitor's fal key stays in that
// script's memory and goes only to fal's queue; Stoop never receives it. The page's strict policy
// (connect-src 'self' https://queue.fal.run, Trusted Types required) comes from next.config.ts headers()
// (lib/security/csp.ts byokHeaders), on a source the site-wide policy never matches.
//
// Reports link here with a plain anchor (a full page load), never a client-side navigation: a soft
// navigation would keep the report's own policy.
import { RENDER_ENDPOINTS } from "@/lib/render/schema";
import { VIDEO_MODELS } from "@/lib/prompts/models.config";

/** The endpoints the page may call, with what it needs to build their input, from models.config (model names live only there). */
const ENDPOINTS = Object.values(VIDEO_MODELS)
  .filter((model) => RENDER_ENDPOINTS.includes(model.endpoint))
  .map((model) => ({ endpoint: model.endpoint, name: model.displayName, maxRefs: model.maxRefs, setsAspectRatio: model.setsAspectRatio, image: model.role === "image" }));

const attribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Render with your fal key | Stoop</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/byok/app.css">
<script type="module" src="/byok/app.js"></script>
</head>
<body>
<header class="bar"><a class="brand" href="/">Stoop</a></header>
<main id="byok" data-endpoints="${attribute(JSON.stringify(ENDPOINTS))}">
<h1>Render with your fal key</h1>
<p class="lede">One 480p draft of this ad, rendered on your own fal account.</p>
<p class="note">Your key goes from this page straight to fal. Stoop never sees it and never stores it.</p>

<section class="card" aria-labelledby="plan-title">
<h2 id="plan-title">The draft</h2>
<p id="plan-status" aria-live="polite">Loading the draft plan...</p>
<dl id="plan-details" class="details" hidden>
<dt>Model</dt><dd id="plan-model"></dd>
<dt>Length</dt><dd id="plan-length"></dd>
<dt>References</dt><dd id="plan-refs"></dd>
<dt>Estimated cost</dt><dd id="plan-cost"></dd>
</dl>
<ul id="ref-thumbs" class="thumbs" hidden></ul>
</section>

<form id="key-form" class="card" autocomplete="off" hidden>
<label for="fal-key">Your fal key</label>
<input id="fal-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required minlength="8" maxlength="200">
<p class="hint">It stays in this tab's memory while the draft renders, and is gone when you close it.</p>
<button id="render" class="primary" type="submit">Render draft</button>
</form>

<section id="progress" class="card" hidden>
<h2>Rendering</h2>
<p id="progress-status" aria-live="polite"></p>
</section>

<section id="result" class="card" hidden>
<h2>Your draft</h2>
<video id="video" controls playsinline preload="metadata"></video>
<p><a id="video-link" rel="noreferrer noopener" target="_blank">Open the video</a></p>
<p class="hint">fal keeps this file for a limited time. Download it to keep it.</p>
</section>

<p id="error" class="error" role="alert" hidden></p>
<p class="back"><a id="back" href="/">Back to the report</a></p>
</main>
</body>
</html>
`;

// Not for search engines: the meta tag above, and this header for crawlers that read headers only.
// app/robots.ts leaves /byok crawlable on purpose, so crawlers can see both.
export function GET(): Response {
  return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" } });
}
