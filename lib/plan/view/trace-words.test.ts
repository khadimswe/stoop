import { describe, expect, it } from "vitest";
import { PLAN_EXAMPLES } from "../example-list";
import { describeRecorded } from "../../testing/recorded";
import { loadExampleReport } from "../examples";
import { traceRows } from "./plan";
import { checkIssues, foodWords, hasCheckPath, leftOffReason, plainStep, tidyPlanText } from "./trace-words";

describe("the trace in plain words", () => {
  it("says what the checks did, never a validator path", () => {
    const dropped = plainStep("Dropped what still failed the checks", "concepts.1.items.2: a interpreted line must cite a Qloo artist, place or style; otherwise mark it creative.");
    expect(dropped).toEqual({ label: "Removed 1 line that didn't cite Qloo", reason: "A line that says it comes from Qloo has to name what Qloo found.", written: true });

    const sent = plainStep("Sent 12 problems back to Claude", 'concepts.1.title or hook: a genre word names a music genre. concepts.1.items.2: "$2": prices and deals come only from the manager\'s offers. concepts.1.items.3: is 305 characters once its keys become Qloo ids; the limit is 240.');
    expect(sent.label).toBe("Checked Claude's draft and sent 12 fixes back");
    expect(sent.reason).toBe("For example, lines that named a music genre, quoted a price the manager didn't type or ran too long.");

    expect(plainStep("Asked Claude again for the generic plan", "3 lines failed the checks: items.2: a genre word.")).toEqual({
      label: "Checked the generic plan's draft",
      reason: "3 lines broke the rules every plan follows, so Claude wrote it again.",
      written: true,
    });
  });

  it("counts removed lines only when the reason lists them all, and says the playlist comes next", () => {
    const four = "concepts.1.items.2: is 305 characters once its keys become Qloo ids. concepts.1: add the music line: the city's artists. concepts.2.items.2: is 305 characters once its keys become Qloo ids. concepts.2: add the music line.";
    expect(plainStep("Dropped what still failed the checks", four)).toEqual({ label: "Removed lines that ran too long", reason: "The city's playlist is added next.", written: true });
  });

  it("hides any other reason that carries a validator path, and keeps plain ones", () => {
    expect(hasCheckPath("concepts.1.items.2: too long")).toBe(true);
    expect(hasCheckPath("wheel.snack: too long")).toBe(true);
    expect(hasCheckPath("Every one has a Qloo receipt: partners come from this list.")).toBe(false);
    expect(plainStep("Asked Claude again for the concepts", "concepts.1: missing title")).toEqual({ label: "Asked Claude again for the concepts", reason: null, written: false });
    expect(plainStep("Kept 6 music styles for Houston", "From the genres the city's top artists share.").reason).toBe("From the genres the city's top artists share.");
    expect(checkIssues("concepts.1.items.2: a. items.3: b.")).toEqual(["a.", "b."]);
  });

  it("says each reason a place was left off once", () => {
    const why = "it is built around alcohol, and the table is on a public sidewalk";
    expect(leftOffReason("Left 4 places off the community list", `A (${why}); B (${why}); C (${why}); D (${why})`)).toBe("Built around alcohol (no alcohol at a sidewalk table): A, B, C and D.");
    expect(leftOffReason("Left 8 places off the community list", `A (${why}); B (an adults-only nightlife spot, not a partner for a sidewalk table)`)).toBe(
      "Built around alcohol (no alcohol at a sidewalk table): A. Adults-only nightlife: B. And 6 more.",
    );
    expect(leftOffReason("Left 1 place off the community list", "not in the usual shape")).toBeNull();
  });

  it("reads snack runs and snack spots as food", () => {
    expect(foodWords("fine for a gift card or a snack run; partners, gift cards and snack runs")).toBe("fine for a gift card or a food run; partners, gift cards and food runs");
    expect(foodWords("The snack spot")).toBe("The food spot");
  });
});

describe("plan text without a stray JSON tail", () => {
  it("strips a trailing unmatched quote and brace or bracket", () => {
    expect(tidyPlanText('Hand out cups by the door."}')).toBe("Hand out cups by the door.");
    expect(tidyPlanText('Wave people over."]')).toBe("Wave people over.");
    expect(tidyPlanText("Start the playlist.}")).toBe("Start the playlist.");
    expect(tidyPlanText("Start the playlist. }  ")).toBe("Start the playlist.");
  });

  it("keeps text that opened its own brackets, refs and quotes", () => {
    expect(tidyPlanText("Tacos from [[abc123]]")).toBe("Tacos from [[abc123]]");
    expect(tidyPlanText("Free spin {no purchase}")).toBe("Free spin {no purchase}");
    expect(tidyPlanText('A sign that says "Free spin"]')).toBe('A sign that says "Free spin"');
    expect(tidyPlanText("Plain line.")).toBe("Plain line.");
  });
});

describeRecorded("the recorded examples' trace on the event page", () => {
  it.each(PLAN_EXAMPLES.map((e) => e.slug))("%s shows no validator path, no failure wording and no snack runs", async (slug) => {
    const rows = traceRows((await loadExampleReport(slug)).trace);
    for (const r of rows) {
      expect(hasCheckPath(r.label), r.label).toBe(false);
      if (r.reason) expect(hasCheckPath(r.reason), r.reason).toBe(false);
      expect(r.label).not.toMatch(/^(Dropped what still failed|Sent \d+ problems?|Asked Claude again for the generic plan)/);
      if (r.stage !== "baseline") expect(`${r.label} ${r.reason ?? ""}`).not.toMatch(/\bsnack (runs?|spots?)\b/i);
      if (r.reason) expect(r.reason).not.toMatch(/\(it is built around alcohol, and the table is on a public sidewalk\)/);
    }
  });
});
