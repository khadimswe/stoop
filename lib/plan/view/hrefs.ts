// Where each step of the floor lives, for example stores (prerendered) and live plans.
import type { PlanExampleSlug } from "../example-list";

type StepName = "Community" | "Create" | "Event" | "Poster" | "Promote";

export function exampleHrefs(slug: PlanExampleSlug | string) {
  const id = `ex-${slug}`;
  const event = `/plan/${id}`;
  return {
    block: `/s/${slug}`,
    create: `/s/${slug}/new`,
    event,
    poster: `${event}/poster`,
    promote: `${event}/promote`,
    steps: { Community: `/s/${slug}`, Create: `/s/${slug}/new`, Event: event, Poster: `${event}/poster` } as Partial<Record<StepName, string>>,
  };
}
