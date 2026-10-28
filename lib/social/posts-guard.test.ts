// The posts guard at post time: the approved drafts pass as they were written, the caption is the stored
// text exactly, and a draft that was changed after approval (a name written out, deal talk) is refused.
import { describe, expect, it } from "vitest";
import { composePosts } from "../plan/posts";
import { samplePlanReport } from "../plan/posts-fixture";
import { loadExampleReport } from "../plan/examples";
import { PLAN_EXAMPLES } from "../plan/example-list";
import { instagramCopy } from "../plan/share";
import { approvedCaption, checkApprovedPosts, openingOf } from "./posts-guard";

const openings = {
  facebook: "We're out front this Saturday with tacos from [[place-taqueria]]. Come say hi.",
  instagram: "Tacos from [[place-taqueria]] out front this Saturday.",
  hashtags: ["Testville", "ShopLocal"],
  whatsapp: "Out front Saturday with tacos from [[place-taqueria]].",
};

describe("approved captions", () => {
  const report = samplePlanReport();
  const posts = composePosts(openings, report);

  it("posts the stored text exactly, with Instagram's hashtags as the copy button gives them", () => {
    expect(approvedCaption(posts, "facebook")).toBe(posts.facebook.text);
    expect(approvedCaption(posts, "instagram")).toBe(instagramCopy(posts));
  });

  it("finds the writer's opening again, with the place written back as its ref", () => {
    expect(openingOf(posts.facebook.text, report)).toBe(openings.facebook);
    expect(openingOf(posts.instagram.caption, report)).toBe(openings.instagram);
  });

  it("passes drafts the guard passed when they were written", () => {
    expect(checkApprovedPosts(posts, report, ["facebook", "instagram"])).toEqual([]);
  });

  it("refuses a draft changed after approval", () => {
    const changed = { ...posts, facebook: { text: posts.facebook.text.replace("Come say hi.", "Best deals in town, guaranteed.") } };
    expect(checkApprovedPosts(changed, report, ["facebook"]).length).toBeGreaterThan(0);
    const tagged = { ...posts, instagram: { ...posts.instagram, hashtags: ["FreePhones"] } };
    expect(checkApprovedPosts(tagged, report, ["instagram"]).length).toBeGreaterThan(0);
    const token = { ...posts, facebook: { text: `${posts.facebook.text} [[place-x]]` } };
    expect(checkApprovedPosts(token, report, ["facebook"]).some((i) => i.message.includes("never rendered"))).toBe(true);
  });
});

describe("the examples' approved posts", () => {
  it.each(PLAN_EXAMPLES.map((e) => e.slug))("%s passes the posts guard again", async (slug) => {
    const report = await loadExampleReport(slug);
    expect(report.posts).not.toBeNull();
    expect(checkApprovedPosts(report.posts!, report, ["facebook", "instagram"])).toEqual([]);
  });
});
