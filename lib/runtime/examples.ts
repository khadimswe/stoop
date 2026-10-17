// The stored example runs (data/runs/<slug>/), read from disk on the server: zero API calls, always
// there. next.config traces data/runs into the functions that read it.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import type { RunEvent } from "../events";
import type { Report } from "../report/schema";

const EXAMPLE_ID = /^example-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The example a run id names ("example-food-hot-sauce"), if it is one of the shipped examples. */
export function exampleSlug(runId: string): ExampleSlug | null {
  const slug = runId.match(EXAMPLE_ID)?.[1];
  return EXAMPLES.find((e) => e.slug === slug)?.slug ?? null;
}

const read = async <T>(slug: ExampleSlug, file: string) => JSON.parse(await readFile(path.join(process.cwd(), "data", "runs", slug, file), "utf8")) as T;

export const exampleEvents = (slug: ExampleSlug) => read<RunEvent[]>(slug, "run.events.json");
export const exampleReport = (slug: ExampleSlug) => read<Report>(slug, "run.report.json");
