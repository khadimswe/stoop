// The /mcp page's example session. The score_brief answer and Claude's reply to it are Qloo response
// data, so they are recorded in data/marketing/mcp-session.json (`npm run mcp:session` writes them by
// running score_brief on the recorded Qloo responses; mcp-session.test.ts checks they still match),
// read on the server (mcp-session-data.ts) and passed in here. The culture_brief answer has the
// tool's wording with a placeholder run id. Nothing here is a live call, and nothing here reads a file,
// so the page's client component can import it.
import type { ScoreBriefResult } from "../mcp/score-brief";

export interface SessionTurn {
  who: "you" | "claude" | "stoop";
  /** A tool call Claude makes before this turn's text, e.g. "score_brief". */
  tool?: "score_brief" | "culture_brief";
  text: string;
}

/** What the agent sends: the lead example's seeds and its LLM-only brief's music and mood. */
export const SCORE_INPUT = {
  product: "small-batch hot sauce",
  seeds: [
    { name: "Hot Ones", type: "tv_show" },
    { name: "Trader Joe's", type: "brand" },
    { name: "Parts Unknown", type: "tv_show" },
    { name: "Tabasco", type: "brand" },
  ],
  choices: { music: ["funk-soul"], mood: ["Warm"] },
} as const;

/** score_brief's text for SCORE_INPUT on the recorded responses, and Claude's reply built from the same result. */
export interface RecordedSession {
  scoreAnswer: string;
  claudeReply: string;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const listOf = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Claude's reply to a score_brief result: what each choice showed, then Qloo's own top music picks. */
export function sessionReply(result: Pick<ScoreBriefResult, "choices" | "qlooPicks">): string {
  const clauses = result.choices.map((c) => {
    if (c.status === "below") return `${capitalize(c.text)} sits below this audience's reference median`;
    if (c.status === "supported") return `${capitalize(c.text)} sits at or above this audience's reference median`;
    if (c.status === "missing") return `Qloo measures no affinity for ${c.text}`;
    return c.dimension === "mood" ? `Qloo has no mood tag for "${c.text.toLowerCase()}"` : `Qloo can't check "${c.text}"`;
  });
  const music = result.qlooPicks.filter((p) => p.dimension === "music").map((p) => p.name);
  const said = clauses.length < 2 ? clauses.join("") : `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
  return [said && `${said}.`, music.length ? `Qloo's own top music picks are ${listOf(music)}.` : null, "Want a full Culture Brief?"].filter(Boolean).join(" ");
}

export function exampleSession(origin: string, recorded: RecordedSession): SessionTurn[] {
  return [
    {
      who: "you",
      text: "Score this brief for my hot sauce. Customers also love Hot Ones, Trader Joe's, Parts Unknown and Tabasco. Music: funk-soul. Mood: warm.",
    },
    { who: "stoop", tool: "score_brief", text: recorded.scoreAnswer },
    { who: "claude", text: recorded.claudeReply },
    { who: "you", text: "Yes. It's a fermented red chile hot sauce made in small batches, $14." },
    {
      who: "stoop",
      tool: "culture_brief",
      text: [
        "Started run run_<id>.",
        `Report: ${origin}/report/run_<id>`,
        "The run takes a few minutes. Open the report link to watch it build, or read the events link as a server-sent event stream.",
      ].join("\n"),
    },
  ];
}
