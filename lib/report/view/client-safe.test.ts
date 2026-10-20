import { afterEach, describe, expect, it, vi } from "vitest";

// The live report builds its view models in the browser, so nothing they import may be server-only.
// lib/agent/model.ts (and anything like it) throws when `window` exists; this imports the view models
// with a window present and expects no throw.
describe("report view models in the browser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("import without pulling in server-only modules", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    await expect(import("./report")).resolves.toHaveProperty("reportView");
    await expect(import("../../events")).resolves.toHaveProperty("reduce");
  });
});
