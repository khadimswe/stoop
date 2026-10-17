// The live run's emitter: the same `emit` the stages already call (synchronous, checked on the spot),
// writing to the run's event list in the store in small batches. Seqs come from the store's counter
// (lib/store/runs.ts), so frames written beside the run never collide with it. `events` holds what
// has been written, with its real seqs.
import { runEventSchema, type Emitter, type RunEvent, type RunEventInput } from "../events";
import { appendRunEvents } from "../store/runs";
import type { Store } from "../store/types";

/** Events emitted within this many ms are written together. */
export const FLUSH_MS = 150;

export interface StoreEmitter extends Emitter {
  /** Writes everything emitted so far. Rejects if a write failed. */
  flush(): Promise<void>;
}

export function storeEmitter(store: Store, runId: string, attempt: number, now: () => Date = () => new Date()): StoreEmitter {
  const events: RunEvent[] = [];
  let pending: RunEventInput[] = [];
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failure: unknown = null;

  const write = () => {
    timer = null;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return chain;
    chain = chain.then(async () => {
      if (failure) return;
      try {
        events.push(...(await appendRunEvents(store, runId, attempt, batch, now)));
      } catch (error) {
        failure = error;
      }
    });
    return chain;
  };

  return {
    events,
    emit(input: RunEventInput): RunEvent {
      // Checked now, so a bad event fails the stage that sent it, as with the recording emitter.
      const event = runEventSchema.parse({ ...input, seq: 0, at: now().toISOString(), attempt });
      pending.push(input);
      timer ??= setTimeout(write, FLUSH_MS);
      return event;
    },
    async flush() {
      if (timer) clearTimeout(timer);
      await write();
      if (failure) throw failure;
    },
  };
}
