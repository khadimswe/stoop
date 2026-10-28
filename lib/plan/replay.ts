// Offline replay of a recorded example plan, for tests and scripts: Qloo answers from the plan's own
// fixtures (fixtures/plan-<slug>*.json), Claude answers from fixtures/llm/plan-<slug>.json. A request
// nobody recorded throws; nothing reaches the network.
import { readdirSync } from "node:fs";
import path from "node:path";
import { LlmStore, replayModel } from "../agent/llm-replay";
import { stoopModel, stoopModelId } from "../agent/model";
import { createQlooClient, type QlooClient } from "../qloo/client";
import { FixtureCache, loadFixtures } from "../qloo/fixtures";
import type { LanguageModel } from "ai";
import type { PlanExampleSlug } from "./example-list";

/** The fixtures a plan example recorded: plan-<slug>.json(.gz), plan-<slug>-2.json and so on. */
export function planFixtureFiles(slug: PlanExampleSlug, dir = "fixtures"): string[] {
  const pattern = new RegExp(`^plan-${slug}(-\\d+)?\\.json(\\.gz)?$`);
  return readdirSync(dir).filter((f) => pattern.test(f)).map((f) => path.join(dir, f));
}

/**
 * A client that answers only from recordings. Every fixture is loaded, not only the plan's own: a
 * search the recorder found already recorded elsewhere (a famous artist's name) was never re-recorded.
 */
export function replayClient(_slug: PlanExampleSlug, dir = "fixtures"): QlooClient {
  return createQlooClient({ cache: new FixtureCache(loadFixtures(dir), { strict: true }) });
}

export function replayPlanModel(slug: PlanExampleSlug, dir = path.join("fixtures", "llm")): LanguageModel {
  const modelId = stoopModelId({});
  return replayModel(Object.assign(stoopModel(modelId), { modelId }), LlmStore.named(`plan-${slug}`, dir));
}
