import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reportSchema } from "./schema";

describe("the Report contract", () => {
  // The contract changes only through its own pull request. This snapshot makes any change to its
  // shape (including the schemas it borrows from lib/prompts: briefs, concepts, packs) show up in the
  // diff for review. Refinements (receipts, medians, counts) are tested where they are defined.
  it("keeps the shape reviewers approved", async () => {
    const shape = JSON.stringify(z.toJSONSchema(reportSchema, { unrepresentable: "any" }), null, 2);
    await expect(`${shape}\n`).toMatchFileSnapshot("./report.schema.json");
  });
});
