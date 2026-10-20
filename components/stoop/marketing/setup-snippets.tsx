"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import { claudeCodeCommand, headerConfig, mcpPathUrl } from "@/lib/marketing/mcp-token";

const noSubscription = () => () => {};

/** The page's own origin once the browser can say; the configured site URL before that. */
function useOrigin(fallback: string): string {
  return useSyncExternalStore(noSubscription, () => window.location.origin, () => fallback);
}

function Snippet({ label, code, copyLabel }: { label: string; code: string; copyLabel: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        {label}
        <CopyButton text={code} label={copyLabel} variant="ghost" size="sm" />
      </figcaption>
      {/* Focusable, so a keyboard can scroll a long line sideways. */}
      <pre tabIndex={0} className="overflow-x-auto rounded-xl bg-screen p-4 font-mono text-[0.8125rem] leading-relaxed text-paper">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/**
 * Setup for Claude, token in a header first (recommended), then the path form for clients that only
 * take a URL. Every snippet carries a placeholder, never a real token.
 */
export function SetupSnippets({ fallbackOrigin }: { fallbackOrigin: string }) {
  const origin = useOrigin(fallbackOrigin);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h3 className="flex flex-wrap items-center gap-2 font-display text-xl font-extrabold [font-stretch:88%]">
          Token in a header
          <span className="rounded-full bg-ink px-2.5 py-0.5 font-sans text-xs font-bold text-paper">Recommended</span>
        </h3>
        <Snippet label="Claude Code: run this once" code={claudeCodeCommand(origin)} copyLabel="Copy command" />
        <Snippet label="Any client that reads a JSON config with headers" code={headerConfig(origin)} copyLabel="Copy config" />
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="font-display text-xl font-extrabold [font-stretch:88%]">Token in the URL, for clients that only take a URL</h3>
        <p className="text-sm leading-relaxed text-ink-soft">
          In Claude on the web or the desktop app, open Settings, then Connectors, add a custom connector and paste this URL with your token
          after <code className="font-mono text-ink">/api/mcp/</code> and no slash after it. The address carries the token, and hosting logs
          record addresses, so keep it as private as the token and use this form only where headers aren&apos;t an option.
        </p>
        <Snippet label="Connector URL" code={mcpPathUrl(origin)} copyLabel="Copy URL" />
      </div>
    </div>
  );
}
