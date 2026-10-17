// @ts-check
// "Render with your fal key" (/byok). Fetches the draft's plan from Stoop, shows the estimate, then sends
// the plan to fal's queue with the visitor's own fal key and polls it until the video is ready.
//
// The key: read from the password field when the visitor presses Render, the field cleared right away,
// kept only in this function's scope while the draft renders, sent only to https://queue.fal.run (the
// page's policy allows no other outside connection), never stored, never logged, never sent to Stoop.
// Only the endpoints the page lists (data-endpoints, from models.config) are called, and the draft
// settings are forced here whatever the plan says: draft mode, 480p, 9:16, 4 to 15 seconds.
// DOM APIs and textContent only: the page requires Trusted Types.

export const QUEUE_ORIGIN = "https://queue.fal.run";
/** Plans are presigned for an hour; one older than this is fetched again before rendering. */
export const PLAN_MAX_AGE_MS = 50 * 60 * 1000;
export const POLL_MS = 4000;
export const MAX_RENDER_MS = 20 * 60 * 1000;

const RUN_ID = /^(?:run_[0-9a-f]{24}|example-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SEGMENT = /^[a-z0-9-]{1,64}$/;

/**
 * @typedef {{ endpoint: string, name: string, maxRefs: number, setsAspectRatio: boolean, image: boolean }} Endpoint
 * @typedef {{ reportId: string, segment: string }} Target
 * @typedef {{ target: Target, endpoint: string, prompt: string, imageUrls: string[], durationSeconds: number, generateAudio: boolean, estimatedUsd: number, expiresAt: string }} Plan
 */

/**
 * The target from the page's query (?reportId=&segment=), or null.
 * @param {string} search
 * @returns {Target | null}
 */
export function readTarget(search) {
  const params = new URLSearchParams(search);
  const reportId = params.get("reportId") ?? "";
  const segment = params.get("segment") ?? "";
  return RUN_ID.test(reportId) && SEGMENT.test(segment) ? { reportId, segment } : null;
}

/**
 * Where "Back to the report" goes.
 * @param {string} reportId
 */
export function reportHref(reportId) {
  const example = /^example-(.+)$/.exec(reportId);
  return example ? `/examples/${example[1]}` : `/report/${reportId}`;
}

/**
 * The draft's length as sent: 4 to 15 whole seconds.
 * @param {{ durationSeconds: number }} plan
 */
export function draftSeconds(plan) {
  return Math.min(15, Math.max(4, Math.round(Number(plan.durationSeconds) || 4)));
}

/**
 * The fal input for a plan, with the draft settings forced. Null when the endpoint is not allowlisted
 * or the references do not fit it.
 * @param {Plan} plan
 * @param {readonly Endpoint[]} endpoints
 * @returns {Record<string, unknown> | null}
 */
export function falInput(plan, endpoints) {
  const model = endpoints.find((e) => e.endpoint === plan.endpoint);
  if (!model || !Array.isArray(plan.imageUrls)) return null;
  const refs = plan.imageUrls.filter((url) => typeof url === "string" && url.startsWith("https://"));
  if (refs.length < 1 || refs.length !== plan.imageUrls.length || refs.length > model.maxRefs) return null;
  /** @type {Record<string, unknown>} */
  const input = { prompt: String(plan.prompt), resolution: "480p", draft: true, duration: String(draftSeconds(plan)), generate_audio: plan.generateAudio !== false };
  if (model.image) {
    input.image_url = refs[0];
    if (refs[1]) input.end_image_url = refs[1];
  } else {
    input.image_urls = refs;
    if (model.setsAspectRatio) input.aspect_ratio = "9:16";
  }
  return input;
}

/** @param {string} value */
export function isQueueUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === QUEUE_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Where fal serves outputs; anything else is never shown. @param {string} value */
export function isFalMedia(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return /^(?:[a-z0-9-]+\.)*fal\.media$/.test(url.hostname) || (url.hostname === "storage.googleapis.com" && url.pathname.startsWith("/falserverless/"));
  } catch {
    return false;
  }
}

/**
 * The queue URLs for a submitted request: fal's own when they are on its queue host, else built from
 * the app id (fal's status and result live under owner/app, without the endpoint's path).
 * @param {string} endpoint
 * @param {{ request_id?: unknown, status_url?: unknown, response_url?: unknown }} queued
 */
export function queueUrls(endpoint, queued) {
  const id = typeof queued.request_id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(queued.request_id) ? queued.request_id : null;
  if (!id) return null;
  const app = endpoint.split("/").slice(0, 2).join("/");
  const status = typeof queued.status_url === "string" && isQueueUrl(queued.status_url) ? queued.status_url : `${QUEUE_ORIGIN}/${app}/requests/${id}/status`;
  const response = typeof queued.response_url === "string" && isQueueUrl(queued.response_url) ? queued.response_url : `${QUEUE_ORIGIN}/${app}/requests/${id}`;
  return { status, response };
}

/** fal's error text, short, as plain text. @param {Response} response */
async function falError(response) {
  let detail = "";
  try {
    const body = await response.json();
    const raw = body?.detail ?? body?.message ?? body?.error;
    detail = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? "") : "";
  } catch {
    // No JSON body.
  }
  if (response.status === 401 || response.status === 403) return "fal did not accept that key.";
  return `fal answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : "."}`;
}

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} id */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The page is missing #${id}.`);
  return found;
}

function main() {
  const root = element("byok");
  /** @type {Endpoint[]} */
  let endpoints = [];
  try {
    endpoints = JSON.parse(root.dataset.endpoints ?? "[]");
  } catch {
    endpoints = [];
  }
  const status = element("plan-status");
  const details = element("plan-details");
  const thumbs = element("ref-thumbs");
  const form = /** @type {HTMLFormElement} */ (element("key-form"));
  const keyField = /** @type {HTMLInputElement} */ (element("fal-key"));
  const button = /** @type {HTMLButtonElement} */ (element("render"));
  const progress = element("progress");
  const progressStatus = element("progress-status");
  const result = element("result");
  const video = /** @type {HTMLVideoElement} */ (element("video"));
  const videoLink = /** @type {HTMLAnchorElement} */ (element("video-link"));
  const errorLine = element("error");
  const back = /** @type {HTMLAnchorElement} */ (element("back"));

  /** @param {string} text */
  const showError = (text) => {
    errorLine.textContent = text;
    errorLine.hidden = false;
  };
  const clearError = () => {
    errorLine.textContent = "";
    errorLine.hidden = true;
  };

  const target = readTarget(location.search);
  if (!target) {
    status.textContent = "This link does not name a report and a world to render.";
    return;
  }
  back.href = reportHref(target.reportId);

  /** @type {{ plan: Plan, at: number } | null} */
  let current = null;

  /** @returns {Promise<Plan>} */
  async function fetchPlan() {
    const response = await fetch("/api/render/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.plan) throw new Error(typeof body?.error?.message === "string" ? body.error.message : "The draft plan could not be loaded.");
    current = { plan: body.plan, at: Date.now() };
    return body.plan;
  }

  /** @param {Plan} plan */
  function showPlan(plan) {
    const model = endpoints.find((e) => e.endpoint === plan.endpoint);
    element("plan-model").textContent = model ? model.name : plan.endpoint;
    // What is actually sent (falInput forces 4 to 15 seconds), whatever the plan says.
    element("plan-length").textContent = `${draftSeconds(plan)} seconds, 480p, vertical 9:16${plan.generateAudio === false ? "" : ", with sound"}`;
    const frames = plan.imageUrls.length;
    element("plan-refs").textContent = `${frames} ${frames === 1 ? "image" : "images"} (storyboard frames and the product)`;
    element("plan-cost").textContent = `About $${Number(plan.estimatedUsd).toFixed(2)}, billed by fal to your account`;
    thumbs.replaceChildren();
    // Public images only: presigned private references carry their signature in the query and are not shown.
    for (const url of plan.imageUrls) {
      if (new URL(url).search !== "") continue;
      const item = document.createElement("li");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      item.append(img);
      thumbs.append(item);
    }
    thumbs.hidden = thumbs.childElementCount === 0;
    status.textContent = "Ready. Paste your fal key to render.";
    details.hidden = false;
    form.hidden = false;
  }

  /**
   * @param {Plan} plan
   * @param {string} key
   */
  async function render(plan, key) {
    const input = falInput(plan, endpoints);
    if (!input) throw new Error("This plan is not one this page can send to fal.");
    const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
    const init = { credentials: /** @type {RequestCredentials} */ ("omit"), referrerPolicy: /** @type {ReferrerPolicy} */ ("no-referrer"), cache: /** @type {RequestCache} */ ("no-store") };
    progressStatus.textContent = "Sending the draft to fal...";
    const submitted = await fetch(`${QUEUE_ORIGIN}/${plan.endpoint}`, { method: "POST", headers, body: JSON.stringify(input), ...init });
    if (!submitted.ok) throw new Error(await falError(submitted));
    const urls = queueUrls(plan.endpoint, await submitted.json());
    if (!urls) throw new Error("fal answered without a request id.");

    const started = Date.now();
    for (;;) {
      if (Date.now() - started > MAX_RENDER_MS) throw new Error("fal is taking longer than 20 minutes. Check your fal dashboard for the result.");
      await wait(POLL_MS);
      const polled = await fetch(urls.status, { headers: { Authorization: `Key ${key}` }, ...init });
      if (!polled.ok) throw new Error(await falError(polled));
      const state = (await polled.json())?.status;
      if (state === "COMPLETED") break;
      progressStatus.textContent = state === "IN_PROGRESS" ? "fal is rendering the draft. This usually takes a few minutes." : "Waiting in fal's queue...";
    }
    const finished = await fetch(urls.response, { headers: { Authorization: `Key ${key}` }, ...init });
    if (!finished.ok) throw new Error(await falError(finished));
    const url = (await finished.json())?.video?.url;
    if (typeof url !== "string" || !isFalMedia(url)) throw new Error("fal answered without a video Stoop can show.");
    return url;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();
    let key = keyField.value.trim();
    keyField.value = "";
    if (key.length < 8) {
      showError("Paste your fal key first.");
      return;
    }
    button.disabled = true;
    keyField.disabled = true;
    progress.hidden = false;
    result.hidden = true;
    void (async () => {
      try {
        const plan = current && Date.now() - current.at < PLAN_MAX_AGE_MS ? current.plan : await fetchPlan();
        const url = await render(plan, key);
        video.src = url;
        videoLink.href = url;
        result.hidden = false;
        progressStatus.textContent = "Done.";
      } catch (error) {
        progressStatus.textContent = "The draft did not render.";
        showError(error instanceof Error ? error.message : "Something went wrong.");
      } finally {
        key = "";
        button.disabled = false;
        keyField.disabled = false;
      }
    })();
  });

  fetchPlan().then(showPlan, (error) => {
    status.textContent = "The draft plan could not be loaded.";
    showError(error instanceof Error ? error.message : "Try again in a moment.");
  });
}

if (typeof document !== "undefined") main();
