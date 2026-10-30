import Link from "next/link";
import { FloorMark } from "@/components/stoop/floor/kit";
import { LEAD_PLAN_EXAMPLE } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";

/** The 404 body, shared by the root not-found page and the groups' (notFound() calls): it points to the example store. */
export function NotFoundMessage() {
  return (
    <main className="floor flex w-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-10 pb-20">
        <Link href="/" aria-label="Stoop home" className="self-start">
          <FloorMark />
        </Link>
        <h1 className="font-serif text-[2rem] leading-tight font-normal">Page not found</h1>
        <p className="text-[0.9375rem] text-fl-muted">
          This link doesn&apos;t lead anywhere.{" "}
          <Link href={exampleHrefs(LEAD_PLAN_EXAMPLE.slug).event} className="font-medium text-fl-ink underline underline-offset-[3px]">
            See an example store&apos;s event
          </Link>{" "}
          or{" "}
          <Link href="/start" className="font-medium text-fl-ink underline underline-offset-[3px]">
            plan your own
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
