import { describe, expect, it } from "vitest";
import { itemIssues, textIssues, type GuardContext } from "./guard";

const ID = "AFBD8046-1234-4ABC-9DEF-0123456789AB";
const ctx: GuardContext = {
  offers: ["$25/mo unlimited when you switch, taxes and fees included", "Free 5G phone when you port in your number (select models)"],
  budgetUsd: 200,
  known: new Set([ID]),
  names: ["Quillon Hall", "Zevrin"],
};
const ok = (text: string) => expect(textIssues(text, ctx)).toEqual([]);
const flagged = (text: string, pattern: RegExp) => expect(textIssues(text, ctx).join(" ")).toMatch(pattern);

describe("offers", () => {
  it("passes an offer quoted exactly as the manager typed it", () => {
    ok('Sign: "$25/mo unlimited when you switch, taxes and fees included"');
    ok("Table sign: Free 5G phone when you port in your number (select models)");
  });
  it("refuses a reworded or invented price or deal", () => {
    flagged('Sign: "$25 unlimited, switch today"', /prices and deals come only from the manager's offers/);
    flagged("$5 tacos for anyone who stops", /prices and deals/);
    flagged("10% off accessories all day", /prices and deals/);
    flagged("Free phone for everyone who visits", /prices and deals/);
  });
  it("allows the budget and a gift card paid from it", () => {
    ok("Keep everything inside the $200 budget.");
    ok("A free drawing every hour for a $10 gift card to [[" + ID + "]].");
  });
  it("refuses a carrier promo day the manager did not type", () => {
    flagged("Time it for T-Mobile Tuesdays.", /prices and deals/);
  });
  it("lets the timing follow a promo day the manager named", () => {
    expect(textIssues("Time it for T-Mobile Tuesdays.", { ...ctx, offers: ["T-Mobile Tuesdays: free perks in the app"] })).toEqual([]);
    expect(textIssues('Run it on a Tuesday: "T-Mobile Tuesdays"', { ...ctx, offers: ["T-Mobile Tuesdays"] })).toEqual([]);
  });
});

describe("what a sidewalk event never does", () => {
  it.each([
    ["Hand out free beer to adults", /no alcohol or tobacco/],
    ["A hookah corner by the door", /no alcohol or tobacco/],
    ["Thank your customers with a raffle", /never a store's customers/],
    ["A Pride night table with rainbow flags", /no theme built on who people are/],
    ["A table for Latino families", /ethnicity/],
    ["Face painting for the kids", /under 18|kids/],
    ["A family-friendly afternoon", /invites kids/],
    ["Metro presents the block party", /carrier sponsors or endorses/],
    ["Sponsored by T-Mobile, with balloons", /carrier sponsors or endorses/],
    ["Print a Metro logo on the banner", /carrier sponsors or endorses/],
  ])("refuses %s", (text, pattern) => flagged(text, pattern));
  it("passes a plain, local line", () => ok(`Point people to [[${ID}]], 70 m away, for tonight's show.`));
});

describe("refs and names", () => {
  it("refuses an id this run did not measure", () => flagged("Coffee from [[11111111-2222-4333-8444-555555555555]]", /not an artist or place Qloo returned/));
  it("refuses a measured name written out instead of its key", () => {
    flagged("Point people to Quillon Hall for the show.", /written out/);
    flagged("Play Zevrin all afternoon.", /written out/);
  });
});

describe("origins and giveaways", () => {
  const item = (over: Partial<Parameters<typeof itemIssues>[0]>) => itemIssues({ kind: "music", text: "Play the city's most-played artists.", origin: "interpreted", refs: [], evidenceIds: ["ev_000000000001"], ...over }, ctx);
  it("needs a receipt for qloo and interpreted lines", () => {
    expect(item({ evidenceIds: [] }).join(" ")).toMatch(/must cite a Qloo/);
    expect(item({})).toEqual([]);
  });
  it("keeps creative and manager lines free of Qloo refs", () => {
    expect(item({ origin: "creative", refs: [ID], text: `Coffee from [[${ID}]]`, evidenceIds: [] }).join(" ")).toMatch(/names Qloo results/);
  });
  it("keeps giveaways free to enter", () => {
    expect(item({ kind: "giveaway", origin: "creative", evidenceIds: [], text: "Win a speaker with any purchase." }).join(" ")).toMatch(/free to enter/);
    expect(item({ kind: "giveaway", origin: "creative", evidenceIds: [], text: "A free drawing for a speaker, no purchase needed." })).toEqual([]);
  });
});
