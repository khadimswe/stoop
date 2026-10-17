// Memoized stages for live runs: every Claude step is kept in the store under the run, keyed exactly
// like the recorded fixtures (lib/agent/llm-replay.ts stepKey). A resumed run sends the same steps
// (its Qloo answers come back from the shared cache), so it replays them for free and goes on live
// from where the stopped attempt ended. Usage is counted for the run's cost.
import { wrapLanguageModel, type LanguageModel } from "ai";
import { revived, stepKey, stored, type StoredAnswer } from "../agent/llm-replay";
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";

export interface ClaudeTally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Steps served from the store (a resume), not counted as calls. */
  replayed: number;
}

export const emptyTally = (): ClaudeTally => ({ calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, replayed: 0 });

export function memoizedModel(model: LanguageModel & { modelId: string }, store: Store, runId: string, tally: ClaudeTally = emptyTally()): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        const key = stepKey(model.modelId, params);
        const hit = await store.get<StoredAnswer>(keys.run.llm(runId, key));
        if (hit) {
          tally.replayed++;
          return revived(hit);
        }
        const result = await doGenerate();
        tally.calls++;
        tally.inputTokens += result.usage.inputTokens.total ?? 0;
        tally.outputTokens += result.usage.outputTokens.total ?? 0;
        tally.cachedInputTokens += result.usage.inputTokens.cacheRead ?? 0;
        // The answer is paid for; a failed write only means a resume asks again.
        await store.set(keys.run.llm(runId, key), stored(key, model.modelId, params, result), { ttlSeconds: TTL.runEvents }).catch(() => undefined);
        return result;
      },
    },
  });
}
