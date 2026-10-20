import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { liveRunIdSchema } from "@/lib/api/requests";
import { LiveReport } from "./live-report";
import { ReportSkeleton } from "./states";

// A live run's report. The shell (the app bar and the skeleton) is static; the run loads in the
// browser from GET /api/report/<id> and the run's event stream (live-report.tsx), so frames and
// revisions that land after the run show up in place. Examples live at /examples/[slug].
//
// Without generateStaticParams the id is request data, so it is read behind <Suspense>. A malformed
// id renders the not-found page (with noindex), but the status stays 200: the static shell (the app
// bar) has already streamed. A real 404 status needs the check in proxy.ts, before the page renders.
export const metadata: Metadata = {
  title: "Your report · Stoop",
  robots: { index: false, follow: false },
};

async function LiveReportLoader({ params }: { params: PageProps<"/report/[id]">["params"] }) {
  const { id } = await params;
  if (!liveRunIdSchema.safeParse(id).success) notFound();
  return <LiveReport runId={id} />;
}

// The page's one <main> sits outside the Suspense boundary, so the skeleton and the report that
// streams in to replace it never stand side by side as two landmarks.
export default function LiveReportPage({ params }: PageProps<"/report/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<ReportSkeleton />}>
        <LiveReportLoader params={params} />
      </Suspense>
    </main>
  );
}
