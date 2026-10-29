// The captions Stoop posts, and the posts guard once more right before they go out. A caption is the
// plan's approved draft exactly as stored (posts.facebook.text, and the Instagram caption with its
// hashtags as the copy button gives it): it is never rewritten at post time. Before posting, the
// writer's part of each draft is checked again with the posts guard (lib/plan/posts.ts checkPostText
// and checkHashtags): the lines code added (date, place, phone, the manager's offers verbatim, the
// wheel line, the example line) are set aside, the measured place names are turned back into their
// "[[id]]" refs, and what is left is the opening as the guard first saw it.
import { typedTextIssues } from "../plan/guard";
import { checkHashtags, checkPostText, postFacts } from "../plan/posts";
import { keptConcept, posterText, refNames } from "../plan/poster-text";
import type { MarketingReport } from "../plan/posts-store";
import type { Posts } from "../plan/schema";
import { instagramCopy } from "../plan/share";
import type { GuardIssue } from "../guardrails";
import type { SocialChannel } from "./trail";

/** The exact text each channel posts. */
export function approvedCaption(posts: Posts, channel: SocialChannel): string {
  return channel === "facebook" ? posts.facebook.text : instagramCopy(posts);
}

const MORE_OFFERS = /^\d+ more offers? at the table\.$/;

/** Every line composePosts adds to a post, so the rest is the writer's opening. */
function codeLines(report: MarketingReport): Set<string> {
  const f = postFacts(report);
  const disclaimer = posterText(report).disclaimer;
  return new Set([
    "",
    `When: ${f.when}`,
    `Where: ${f.where}`,
    f.when,
    f.where,
    ...(f.phone ? [`Call or text: ${f.phone}`] : []),
    ...f.offers.map((o) => `Offer: ${o}`),
    ...(f.wheel ? [f.wheel] : []),
    ...(disclaimer ? [disclaimer] : []),
  ]);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The opening of a composed post, with measured place names written back as refs. */
export function openingOf(text: string, report: MarketingReport): string {
  const code = codeLines(report);
  const opening = text
    .split("\n")
    .filter((line) => !code.has(line) && !MORE_OFFERS.test(line))
    .join("\n");
  // The kept concept's places, longest name first, so "Cafe Luna Annex" is not read as "Cafe Luna".
  const concept = keptConcept(report);
  const places = new Set((report.local.block?.places ?? []).map((p) => p.id));
  const ids = new Set((concept?.items ?? []).flatMap((i) => i.refs).filter((id) => places.has(id)));
  const names = [...refNames(report)].filter(([id]) => ids.has(id)).sort((a, b) => b[1].length - a[1].length);
  return names.reduce((rest, [id, name]) => (name.trim() ? rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "gu"), `[[${id}]]`) : rest), opening);
}

/**
 * The exact text that would go out, code lines included (the store's name and address, the place, the
 * offers): no links, alcohol or tobacco, implied carrier endorsement or settings aimed at minors, even
 * in what the manager typed. The plan start refuses such inputs too; this catches a plan that predates it.
 */
export function checkPostedText(text: string, path: string): GuardIssue[] {
  return typedTextIssues(text).map((message) => ({ rule: "fake-proof" as const, match: message.slice(0, 60), message, path }));
}

/** Every rule the approved drafts break now, for the channels about to post. Empty means they may go out. */
export function checkApprovedPosts(posts: Posts, report: MarketingReport, channels: readonly SocialChannel[]): GuardIssue[] {
  const issues: GuardIssue[] = [];
  for (const channel of channels) {
    const text = channel === "facebook" ? posts.facebook.text : posts.instagram.caption;
    if (/\[\[[^\]]*\]\]/.test(text)) issues.push({ rule: "fake-proof", match: "[[", message: "A ref token was never rendered into a name.", path: channel });
    issues.push(...checkPostText(openingOf(text, report), report, channel));
    issues.push(...checkPostedText(approvedCaption(posts, channel), channel));
    if (channel === "instagram") issues.push(...checkHashtags(posts.instagram.hashtags, report));
  }
  return issues;
}
