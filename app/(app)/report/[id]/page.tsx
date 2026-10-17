import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { liveRunIdSchema } from "@/lib/api/requests";

// Stub: a live run's report. The live-data lane loads the stored Report and renders <ReportPage>
// (components/stoop/report/report-page.tsx) from it; examples live at /examples/[slug].
//
// Without generateStaticParams the id is request data, so it is read behind <Suspense>. A malformed
// id renders the not-found page (with noindex), but the status stays 200: the static shell (the app
// bar) has already streamed. A real 404 status needs the check in proxy.ts, before the page renders.
export const metadata: Metadata = {
  title: "Your report · Stoop",
  robots: { index: false, follow: false },
};

async function LiveReport({ params }: { params: PageProps<"/report/[id]">["params"] }) {
  const { id } = await params;
  if (!liveRunIdSchema.safeParse(id).success) notFound();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-4 pt-10 pb-20 sm:px-5">
      <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%]">Your report</h1>
      <p className="text-sm text-ink-soft">Live reports open here once the run finishes.</p>
    </main>
  );
}

export default function LiveReportPage({ params }: PageProps<"/report/[id]">) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <LiveReport params={params} />
    </Suspense>
  );
}
