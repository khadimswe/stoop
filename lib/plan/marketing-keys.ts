// The marketing job's store keys, in a plain module so the event stream and the plan routes can see
// whether a plan's poster and posts are still being made without loading the art renderer.

export const posterKeys = {
  /** A rendered background by its prompt hash: { url, modelId }. */
  render: (promptHash: string) => `poster:render:${promptHash}`,
  /** Held while one run's marketing job runs, so two clicks never generate twice. */
  lock: (runId: string) => `plan:${runId}:marketing:lock`,
  /** How many new versions of the poster art a plan has asked for. */
  version: (runId: string) => `plan:${runId}:marketing:version`,
} as const;
