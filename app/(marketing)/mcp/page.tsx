import type { Metadata } from "next";

// Stub: the MCP lane adds the screen capture, the token step, setup and an example session.
export const metadata: Metadata = {
  title: "Use Stoop inside your Claude · Stoop",
  description: "Works inside your Claude, with your own video tools: start a Culture Brief or score a brief with Qloo.",
};

export default function McpPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-5 pt-14 pb-20">
      <h1 className="type-h2 text-balance">Use Stoop inside your Claude</h1>
      <p className="type-lead text-ink-soft">Works inside your Claude, with your own video tools.</p>
    </main>
  );
}
