// The live run's emitter: the same `emit` the stages already call (synchronous, checked on the spot),
// writing to the run's event list in the store in small batches. Seqs come from the store's counter
// (lib/store/runs.ts), so frames written beside the run never collide with it. `events` holds what
// has been written, with its real seqs.
import { runEventSchema, type Emitter, type RunEvent, type RunEventInput } from "../events";
import { appendRunEvents } from "../store/runs";
import type { Store } from "../store/types";

/** Events emitted within this many ms are written together. */
export const FLUSH_MS = 150;
/** A failed write is tried again after these waits, then the store counts as down. */
export const RETRY_WAITS_MS = [200, 800] as const;

export interface StoreEmitter extends Emitter {
  /** Writes everything emitted so far. Rejects if a write failed. */
  flush(): Promise<void>;
}

export interface StoreEmitterOptions {
  now?: () => Date;
  /** Called once when writes keep failing, so the run can stop spending: nothing it does would be kept. */
  onFailure?: (error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function storeEmitter(store: Store, runId: string, attempt: number, options: StoreEmitterOptions = {}): StoreEmitter {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? pause;
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
      for (let tries = 0; ; tries++) {
        try {
          events.push(...(await appendRunEvents(store, runId, attempt, batch, now)));
          return;
        } catch (error) {
          if (tries >= RETRY_WAITS_MS.length) {
            failure = error;
            options.onFailure?.(error);
            return;
          }
          await sleep(RETRY_WAITS_MS[tries]);
        }
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
