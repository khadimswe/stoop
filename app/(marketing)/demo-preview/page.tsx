import type { Metadata } from "next";
import { AgentDemo } from "@/components/stoop/marketing/agent-demo/agent-demo";
import { loadDemoScript } from "@/lib/marketing/demo-source";

// Review route for the landing's agent demo, until the landing places it (then this page goes).
// Static: the script is built at build time from the recorded run.
export const metadata: Metadata = {
  title: "Agent demo preview · Stoop",
  robots: { index: false, follow: false },
};

export default function DemoPreviewPage() {
  const script = loadDemoScript("food-hot-sauce");
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-10 pb-24 sm:px-5">
      <div className="flex flex-col gap-2">
        <p className="type-kicker text-ink-soft">Review only · not indexed</p>
        <h1 className="type-h3">Agent demo preview</h1>
        <p className="max-w-[60ch] text-sm text-ink-soft">A replay of the recorded {script.product.brandName ?? script.product.name} run, as the landing will show it.</p>
      </div>
      <AgentDemo script={script} />
    </main>
  );
}
