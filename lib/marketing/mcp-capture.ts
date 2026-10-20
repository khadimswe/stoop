// The /mcp page's hero slot: a 30 to 60 s screen recording of Stoop running inside Claude, with
// captions, once the founder records it. Until then (null), the slot shows the example session's
// real score_brief exchange, labeled as an example session: never a placeholder box, never fake video.

export interface McpCapture {
  /** The recording, under public/demo (e.g. "/demo/mcp-capture.mp4"). */
  src: string;
  /** Its first frame, shown before it plays. */
  poster: string;
  /** WebVTT captions: the recording is voiced or shows text that must be read. */
  captions: string;
  /** What it shows, for screen readers. */
  description: string;
}

/** Set this when the recording exists, and the hero shows it instead of the example session. */
export const MCP_CAPTURE = null as McpCapture | null;

/** How many turns of the example session the hero shows: the request, score_brief's answer and Claude's reply. */
export const CAPTURE_TURNS = 3;
