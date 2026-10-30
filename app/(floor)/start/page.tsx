import type { Metadata } from "next";
import { StartFlow } from "@/components/stoop/floor/start-flow";

// A new store: its name and where it is, then its block, then the event form. A static shell; the
// steps run in the browser against /api/geocode, /api/plan/block and /api/plan.
export const metadata: Metadata = {
  title: "Plan an event · Stoop",
  description: "Your store, its community and the day. Stoop plans an event for your community.",
};

export default function StartPage() {
  return <StartFlow />;
}
