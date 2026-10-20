import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RunView } from "@/components/stoop/trace/run-view";
import { runIdSchema } from "@/lib/api/requests";
import { exampleSlugOf, isReplayReason } from "@/lib/run/start";

// The live agent trace. The id is request data (no generateStaticParams), so it is read behind
// <Suspense>; the fallback is the same page with nothing measured yet, so the shell never flashes
// blank. The trace itself streams in the browser (Server-Sent Events, reduced on the client).
export const metadata: Metadata = {
  title: "Live run · Stoop",
  robots: { index: false, follow: false },
};

function Connecting() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-4 pt-8 pb-20 sm:px-5">
      <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%] sm:text-[1.875rem]">Building your Campaign Kit</h1>
      <p className="text-sm text-ink-soft">Connecting to the run…</p>
    </div>
  );
}

async function Run({ params, searchParams }: { params: PageProps<"/run/[id]">["params"]; searchParams: PageProps<"/run/[id]">["searchParams"] }) {
  const { id } = await params;
  // Live run ids, or one of the shipped examples' replays.
  if (!runIdSchema.safeParse(id).success || (id.startsWith("example-") && !exampleSlugOf(id))) notFound();
  const { why } = await searchParams;
  return <RunView runId={id} why={isReplayReason(why) ? why : null} />;
}

// The page's one <main> sits outside the Suspense boundary, so the "Connecting" fallback and the trace
// that streams in to replace it never stand side by side as two landmarks.
export default function RunPage({ params, searchParams }: PageProps<"/run/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<Connecting />}>
        <Run params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
