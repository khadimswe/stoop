import type { Metadata } from "next";

// Stub: the marketing lane builds the judge's guide (the 90-second path, what Qloo decides, the
// scoreboard, guardrails and limits).
export const metadata: Metadata = {
  title: "For judges · Stoop",
  description: "A 90-second path through Stoop: the Reality Check, the Screening Room and one receipt.",
};

export default function JudgesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-5 pt-14 pb-20">
      <h1 className="type-h2 text-balance">For judges</h1>
      <p className="type-lead text-ink-soft">
        Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.
      </p>
    </main>
  );
}
