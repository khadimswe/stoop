import type { Metadata } from "next";
import { StartFlow } from "@/components/stoop/start/start-flow";

// "What are you selling?": the link (or a description), then the seeds Qloo found, then the run.
// The page is a static shell; the two steps run in the browser against /api/intake and /api/run.
export const metadata: Metadata = {
  title: "Start · Stoop",
  description: "Paste a store or product link, confirm the seeds, and Stoop maps the audience around your product with Qloo.",
};

export default function StartPage() {
  return (
    <main className="mx-auto flex w-full max-w-[42.5rem] flex-1 flex-col px-4 pt-10 pb-20 sm:px-5">
      <StartFlow />
    </main>
  );
}
