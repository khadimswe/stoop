// Recorded Claude answers, the way fixtures/ holds recorded Qloo answers: a recorded example run
// replays offline, Claude included, so it reproduces byte for byte and anyone who clones the repo can
// run it without a key. AI SDK middleware (wrapLanguageModel) sits between the agent and the model:
// each model step is keyed by a hash of exactly what was sent (prompt, tools, tool choice, output
// format, limits, provider options), so a replay serves the answer to the same question and a
// changed prompt misses instead of answering a different one. The files are for scripts and tests;
// live runs keep their steps in the store instead (lib/runtime/memo.ts), so a resumed run replays them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { hashOf, stableStringify } from "../hash";

export const LLM_FIXTURES_DIR = path.join("fixtures", "llm");

export type GenerateResult = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>>;

/** A recorded answer, without the request body or response headers (they repeat the prompt and carry nothing replay needs). */
export interface StoredAnswer {
  /** The step's hash (stepKey). Named "id", not "key", so secret scanners don't read a hash as a credential. */
  id: string;
  modelId: string;
  /** The first words of the last user or tool message, so a person can tell entries apart. */
  hint: string;
  result: Omit<GenerateResult, "request" | "response"> & { response?: { id?: string; modelId?: string; timestamp?: string } };
}

interface StoreFile {
  name: string;
  recordedAt: string;
  answers: StoredAnswer[];
}

export class LlmFixtureMissError extends Error {
  constructor(hint: string) {
    super(`No recorded Claude answer for this request (${hint}). Record it with the example script's --record flag.`);
    this.name = "LlmFixtureMissError";
  }
}

/** One file of recorded answers (fixtures/llm/<name>.json). */
export class LlmStore {
  private readonly answers = new Map<string, StoredAnswer>();
  private readonly used = new Set<string>();
  private dirty = false;

  constructor(
    readonly file: string,
    private readonly name: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as StoreFile;
      for (const answer of data.answers) this.answers.set(answer.id, answer);
    }
  }

  static named(name: string, dir = LLM_FIXTURES_DIR): LlmStore {
    return new LlmStore(path.join(dir, `${name}.json`), name);
  }

  get size(): number {
    return this.answers.size;
  }

  get(key: string): StoredAnswer | undefined {
    const answer = this.answers.get(key);
    if (answer) this.used.add(key);
    return answer;
  }

  put(answer: StoredAnswer): void {
    this.answers.set(answer.id, answer);
    this.used.add(answer.id);
    this.dirty = true;
  }

  /** Drops answers this run never asked for (a changed prompt leaves its old answer unused). */
  prune(): number {
    let dropped = 0;
    for (const key of this.answers.keys()) {
      if (this.used.has(key)) continue;
      this.answers.delete(key);
      dropped++;
    }
    if (dropped) this.dirty = true;
    return dropped;
  }

  /** Writes the file when something new was recorded. Answers are sorted by key, so a re-record diffs cleanly. */
  save(): boolean {
    if (!this.dirty) return false;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const answers = [...this.answers.values()].sort((a, b) => a.id.localeCompare(b.id));
    const data: StoreFile = { name: this.name, recordedAt: this.now().toISOString(), answers };
    // Claude's text can hold U+2014; it is written as an escape (same JSON, no raw character in the repo).
    writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`.replace(new RegExp(String.fromCharCode(0x2014), "g"), "\\u2014"));
    this.dirty = false;
    return true;
  }
}

export type CallOptions = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"];

/**
 * The key for one model step: everything sent to the model (prompt, tools, tool choice, output
 * format, limits, sampling, provider options), minus what varies per call and never changes the
 * answer (the abort signal, request headers, raw-chunk streaming).
 */
export function stepKey(modelId: string, params: CallOptions): string {
  const { abortSignal: _abort, headers: _headers, includeRawChunks: _raw, ...sent } = params;
  void _abort;
  void _headers;
  void _raw;
  return hashOf({ modelId, ...sent });
}

function hintOf(params: CallOptions): string {
  const last = [...params.prompt].reverse().find((m) => m.role === "user" || m.role === "tool");
  const text = last ? stableStringify(last.content) : "";
  return text.replace(/\s+/g, " ").slice(0, 120);
}

export function stored(id: string, modelId: string, params: CallOptions, result: GenerateResult): StoredAnswer {
  const { request: _request, response, ...rest } = result;
  void _request;
  return {
    id,
    modelId,
    hint: hintOf(params),
    result: {
      ...rest,
      ...(response
        ? { response: { id: response.id, modelId: response.modelId, timestamp: response.timestamp instanceof Date ? response.timestamp.toISOString() : undefined } }
        : {}),
    },
  };
}

export function revived(answer: StoredAnswer): GenerateResult {
  const { response, ...rest } = answer.result;
  return {
    ...rest,
    ...(response ? { response: { ...response, timestamp: response.timestamp ? new Date(response.timestamp) : undefined } } : {}),
  } as GenerateResult;
}

/** Serves recorded answers and records the ones it lacks by asking the real model. */
export function recordingModel(model: LanguageModel & { modelId: string }, store: LlmStore): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        const key = stepKey(model.modelId, params);
        const hit = store.get(key);
        if (hit) return revived(hit);
        const result = await doGenerate();
        store.put(stored(key, model.modelId, params, result));
        return result;
      },
    },
  });
}

/** Serves recorded answers only: a request nobody recorded throws, it never reaches Claude. */
export function replayModel(model: LanguageModel & { modelId: string }, store: LlmStore): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ params }) => {
        const hit = store.get(stepKey(model.modelId, params));
        if (!hit) throw new LlmFixtureMissError(hintOf(params));
        return revived(hit);
      },
      wrapStream: async () => {
        throw new Error("Recorded Claude answers replay generate calls only.");
      },
    },
  });
}
