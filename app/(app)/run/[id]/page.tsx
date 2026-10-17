import type { Metadata } from "next";

// Stub: the live-flow lane builds the agent trace (SSE) here. It does not read the id yet, so it
// stays a static shell until that lane decides how the run streams.
export const metadata: Metadata = {
  title: "Live run · Stoop",
  robots: { index: false, follow: false },
};

export default function RunPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 px-4 pt-10 pb-20 sm:px-5">
      <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%]">Building your Campaign Kit</h1>
      <p className="text-sm text-ink-soft">Each Qloo call and agent decision shows up here as it happens.</p>
    </main>
  );
}
