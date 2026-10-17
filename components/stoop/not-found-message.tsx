import Link from "next/link";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";

/** The 404 body, shared by the root not-found page (unmatched URLs) and the app group's (notFound() calls). */
export function NotFoundMessage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pt-10 pb-20 sm:px-5">
      <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%]">Page not found</h1>
      <p className="text-sm text-ink-soft">
        This link doesn&apos;t lead anywhere.{" "}
        <Link href={`/examples/${LEAD_EXAMPLE.slug}`} className="font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
          See an example report
        </Link>
      </p>
    </main>
  );
}
