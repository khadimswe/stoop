import type { Metadata } from "next";

// Stub: the live-flow lane builds the composer and the seed step here.
export const metadata: Metadata = {
  title: "Start · Stoop",
  description: "Paste a store or product link, confirm the seeds, and Stoop maps the audience around your product with Qloo.",
};

export default function StartPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pt-10 pb-20 sm:px-5">
      <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%]">What are you selling?</h1>
      <p className="text-sm text-ink-soft">Paste a store or product link. No website? You can describe it instead.</p>
    </main>
  );
}
