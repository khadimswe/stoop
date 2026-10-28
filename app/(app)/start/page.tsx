import type { Metadata } from "next";
import Link from "next/link";
import { StoreForm } from "@/components/stoop/start/store-form";

// The store form: the store, where it is, the event, the manager's offers, the adult age bands and notes.
// A static shell; the form checks itself and starts the plan in the browser (POST /api/plan).
export const metadata: Metadata = {
  title: "Plan an event · Stoop",
  description: "Tell Stoop about your store and the day. It plans an event your block wants, from your city's music and the spots near the store.",
};

export default function StartPage() {
  return (
    <main className="mx-auto flex w-full max-w-[42.5rem] flex-1 flex-col gap-6 px-4 pt-8 pb-20 sm:px-5 sm:pt-10">
      <div className="flex flex-col gap-2">
        <p className="type-kicker text-ink-soft">Plan an event</p>
        <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight text-balance [font-stretch:85%] sm:text-[2rem]">
          Give your block a reason to stop
        </h1>
        <p className="text-[0.9375rem] leading-relaxed text-pretty text-ink-soft">
          Stoop asks Qloo what your city listens to and which food spots, venues and parks sit around the store, then writes the plan, the poster and the
          posts. Want to look first?{" "}
          <Link href="/#examples" className="font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
            See an example store
          </Link>
          .
        </p>
      </div>
      <StoreForm />
    </main>
  );
}
