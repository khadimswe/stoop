// Offline replay of a recorded example plan, for tests and scripts: Qloo answers from the plan's own
// fixtures (fixtures/plan-<slug>*.json), Claude answers from fixtures/llm/plan-<slug>.json. A request
// nobody recorded throws; nothing reaches the network.
import { readdirSync } from "node:fs";
import path from "node:path";
import { LlmStore, replayModel } from "../agent/llm-replay";
import { stoopModel, stoopModelId } from "../agent/model";
import { createQlooClient, type QlooClient } from "../qloo/client";
import type { QlooCache } from "../qloo/cache";
import { FixtureCache, loadFixtures, readFixtureFile } from "../qloo/fixtures";
import type { LanguageModel } from "ai";
import type { PlanExampleSlug } from "./example-list";

/** The fixtures a plan example recorded: plan-<slug>.json(.gz), plan-<slug>-2.json and so on. */
export function planFixtureFiles(slug: PlanExampleSlug, dir = "fixtures"): string[] {
  const pattern = new RegExp(`^plan-${slug}(-\\d+)?\\.json(\\.gz)?$`);
  return readdirSync(dir).filter((f) => pattern.test(f)).map((f) => path.join(dir, f));
}

/**
 * A client that answers only from recordings: the plan's own fixtures first, and every other fixture
 * only on a miss (a search the recorder found already recorded elsewhere, such as a famous artist's
 * name, was never recorded again), so most replays never parse the whole recorded set.
 */
export function replayClient(slug: PlanExampleSlug, dir = "fixtures"): QlooClient {
  const own = new FixtureCache(planFixtureFiles(slug, dir).map(readFixtureFile));
  let all: FixtureCache | null = null;
  const cache: QlooCache = {
    async get(key, request) {
      const hit = await own.get(key);
      if (hit) return hit;
      all ??= new FixtureCache(loadFixtures(dir), { strict: true });
      return all.get(key, request);
    },
    async set() {},
  };
  return createQlooClient({ cache });
}

export function replayPlanModel(slug: PlanExampleSlug, dir = path.join("fixtures", "llm")): LanguageModel {
  const modelId = stoopModelId({});
  return replayModel(Object.assign(stoopModel(modelId), { modelId }), LlmStore.named(`plan-${slug}`, dir));
}
