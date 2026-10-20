// The agent demo's script for an example, for pages. The recorded events are read with a synchronous
// file read, so a page that shows the demo still prerenders statically and reads nothing at request
// time. They are Qloo response data, so the public repository leaves them out; a read then throws
// with the command that writes them. Server only: the events and the report are about 500 KB each;
// the page hands the client player the small DemoScript instead.
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runEventSchema } from "../events";
import { loadExampleMedia, loadExampleReport } from "../report/load";
import { buildDemoScript } from "./demo-script";
import type { DemoScript } from "./demo-types";

/** The examples with a recorded run the demo can replay. The landing replays the lead example. */
export type DemoSlug = "food-hot-sauce";

/** The lead example's recorded events. The path is written out in full so the build's file tracer can follow it. */
function readEvents(slug: DemoSlug): unknown {
  if (!existsSync(path.join(process.cwd(), "data", "runs", "food-hot-sauce", "run.events.json"))) {
    throw new Error(
      `The stored example run is missing (data/runs/${slug}/run.events.json). The examples are Qloo response data, so the public repository leaves them out. Write them from your own recordings with \`npm run example -- ${slug} --record\` (README: "Data and the Qloo API").`,
    );
  }
  return JSON.parse(readFileSync(path.join(process.cwd(), "data", "runs", "food-hot-sauce", "run.events.json"), "utf8"));
}

const scripts = new Map<DemoSlug, DemoScript>();

/** The demo script for one example, built and checked the first time it is asked for. */
export function loadDemoScript(slug: DemoSlug = "food-hot-sauce"): DemoScript {
  let script = scripts.get(slug);
  if (!script) {
    const events = z.array(runEventSchema).parse(readEvents(slug));
    script = buildDemoScript({ slug, events, report: loadExampleReport(slug), media: loadExampleMedia(slug) });
    scripts.set(slug, script);
  }
  return script;
}
