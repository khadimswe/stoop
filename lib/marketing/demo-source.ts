// The agent demo's script for an example, for pages. The recorded events are a static JSON import, so
// a page that shows the demo still prerenders with no file reads. Server only: the events and the
// report are about 500 KB each; the page hands the client player the small DemoScript instead.
import "server-only";
import { z } from "zod";
import foodHotSauce from "@/data/runs/food-hot-sauce/run.events.json";
import { runEventSchema } from "../events";
import { loadExampleMedia, loadExampleReport } from "../report/load";
import { buildDemoScript } from "./demo-script";
import type { DemoScript } from "./demo-types";

/** The examples with a recorded run the demo can replay. The landing replays the lead example. */
const EVENTS = { "food-hot-sauce": foodHotSauce } as const;
export type DemoSlug = keyof typeof EVENTS;

const scripts = new Map<DemoSlug, DemoScript>();

/** The demo script for one example, built and checked the first time it is asked for. */
export function loadDemoScript(slug: DemoSlug = "food-hot-sauce"): DemoScript {
  let script = scripts.get(slug);
  if (!script) {
    const events = z.array(runEventSchema).parse(EVENTS[slug]);
    script = buildDemoScript({ slug, events, report: loadExampleReport(slug), media: loadExampleMedia(slug) });
    scripts.set(slug, script);
  }
  return script;
}
