import { Screen } from "@/components/stoop/screen";
import { CAPTURE_TURNS, MCP_CAPTURE } from "@/lib/marketing/mcp-capture";
import type { SessionTurn } from "@/lib/marketing/mcp-session";
import { cn } from "cn";

const WHO: Record<SessionTurn["who"], string> = { you: "You", claude: "Claude", stoop: "Stoop" };

/**
 * /mcp's hero screen. With the founder's recording (lib/marketing/mcp-capture.ts), that recording;
 * until then, the example session's opening exchange, as it ran: the request, score_brief's answer
 * on the recorded Qloo responses and Claude's reply, labeled "Example session".
 */
export function SessionCapture({ turns }: { turns: readonly SessionTurn[] }) {
  if (MCP_CAPTURE) {
    return (
      <figure className="flex min-w-0 flex-[1_1_28rem] flex-col gap-2">
        <Screen className="aspect-video w-full overflow-hidden">
          <video className="size-full object-cover" src={MCP_CAPTURE.src} poster={MCP_CAPTURE.poster} controls playsInline preload="none">
            <track kind="captions" src={MCP_CAPTURE.captions} srcLang="en" label="English" default />
          </video>
        </Screen>
        <figcaption className="sr-only">{MCP_CAPTURE.description}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="flex min-w-0 flex-[1_1_28rem] flex-col gap-2">
      <Screen className="flex w-full flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-paper/15 pb-3">
          <p className="font-mono text-xs font-semibold tracking-widest text-paper uppercase">Example session</p>
          <p className="font-mono text-[0.6875rem] text-paper-dim">Claude with Stoop&apos;s MCP · recorded Qloo responses</p>
        </div>
        <ol className="flex flex-col gap-3">
          {turns.slice(0, CAPTURE_TURNS).map((turn, i) => (
            <li key={i} className={cn("flex flex-col gap-1.5", turn.who === "you" && "items-end pl-8 sm:pl-14")}>
              <p className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-bold tracking-wide text-paper-dim uppercase">
                {WHO[turn.who]}
                {turn.tool && (
                  <span className="rounded-full border-[1.5px] border-dusk-light px-2 py-0.5 font-mono tracking-normal text-dusk-light normal-case">{turn.tool}</span>
                )}
              </p>
              <p
                className={cn(
                  "text-sm leading-relaxed break-words whitespace-pre-wrap",
                  turn.who === "stoop" && "w-full rounded-xl bg-screen-raised p-3 font-mono text-xs leading-relaxed text-paper",
                  turn.who === "you" && "rounded-xl border border-paper/25 px-3 py-2 text-paper",
                  turn.who === "claude" && "text-paper",
                )}
              >
                {turn.text}
              </p>
            </li>
          ))}
        </ol>
      </Screen>
      <figcaption className="sr-only">Example session: Stoop&apos;s score_brief tool inside Claude, on the recorded Qloo responses for the lead example.</figcaption>
    </figure>
  );
}
