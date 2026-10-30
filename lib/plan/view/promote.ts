// The Promote step's timeline: the announcement now, then a reminder at each of the plan's times (the
// one schedule in lib/social/schedule.ts), grouped by the store's local day, each with its own caption.
// The announcement is the plan's approved drafts; the reminders are code-built (lib/social/reminders.ts).
// The same rows feed the share timeline, posting from Stoop, and the calendar file of reminders. A
// plain module: the screens import it.
import { reminderCaption, reminderFacts } from "../../social/reminders";
import { postSlots, type PostTimeId } from "../../social/schedule";
import { planExampleSlug } from "../example-list";
import type { PlanInputs } from "../schema";
import { shareLinks, type PlanView } from "./plan";

// --- What the Poster and Promote steps read from a plan ------------------------------------------------

/** The Poster step's slice of a plan: small, so an example's page stays light. */
export type PosterScreenView = Pick<PlanView, "id" | "marketing"> & { header: Pick<PlanView["header"], "storeName" | "cityLine" | "fictional">; concept: Pick<NonNullable<PlanView["concept"]>, "title"> | null };

/** The Promote step's slice of a plan. */
export type PromoteScreenView = PosterScreenView & { wheel: { slices: { kind: string }[] } | null };

export function posterScreenView(view: PlanView): PosterScreenView {
  return { id: view.id, marketing: view.marketing, header: { storeName: view.header.storeName, cityLine: view.header.cityLine, fictional: view.header.fictional }, concept: view.concept ? { title: view.concept.title } : null };
}

export function promoteScreenView(view: PlanView): PromoteScreenView {
  return { ...posterScreenView(view), wheel: view.wheel ? { slices: view.wheel.slices.map((s) => ({ kind: s.kind })) } : null };
}

// --- The timeline ------------------------------------------------------------------------------------

export type TimelineId = "announce" | PostTimeId;

export interface TimelineRow {
  id: TimelineId;
  /** "Announce", "Evening before" */
  name: string;
  /** "Now", "7:00 pm" */
  clock: string;
  /** The instant, ISO with Z, or null for "now". */
  at: string | null;
  /** The Facebook caption (and what Copy copies). */
  text: string;
  /** The Instagram caption, hashtags included, as it is pasted. */
  instagram: string;
  /** The WhatsApp message, before the event link is added. */
  whatsapp: string;
}

export interface TimelineDay {
  /** "Now", or the store's local day ("Fri, Nov 6"). */
  label: string;
  rows: TimelineRow[];
}

/**
 * The plan's posts in time order, grouped by day. `now` (epoch ms) leaves out reminders whose time has
 * passed; null keeps them all (the server's render, before the browser knows the time). Empty while
 * the plan has no post drafts yet.
 */
export function promoteTimeline(view: Pick<PlanView, "id" | "marketing"> & { wheel: { slices: readonly { kind: string }[] } | null }, inputs: PlanInputs, now: number | null = null): TimelineDay[] {
  const posts = view.marketing.posts;
  if (!posts) return [];
  const hashtags = posts.hashtags.join(" ");
  // As Instagram is posted (lib/plan/share.ts instagramCopy): the caption trimmed, then its hashtags.
  const withTags = (caption: string) => (hashtags ? `${caption.trim()}\n\n${hashtags}` : caption.trim());
  const facts = reminderFacts(inputs, view.wheel?.slices.map((s) => s.kind) ?? null, { kind: planExampleSlug(view.id) ? "example" : "live", id: view.id });
  const days: TimelineDay[] = [{ label: "Now", rows: [{ id: "announce", name: "Announce", clock: "Now", at: null, text: posts.facebook, instagram: withTags(posts.instagram), whatsapp: posts.whatsapp }] }];
  for (const slot of postSlots({ inputs })) {
    if (now !== null && Date.parse(slot.at) <= now) continue;
    const caption = reminderCaption(facts, slot.id);
    const row: TimelineRow = { id: slot.id, name: slot.name, clock: slot.clock, at: slot.at, text: caption, instagram: withTags(caption), whatsapp: caption };
    const day = days.find((d) => d.label === slot.day);
    if (day) day.rows.push(row);
    else days.push({ label: slot.day, rows: [row] });
  }
  return days;
}

export const timelineRows = (days: readonly TimelineDay[]) => days.flatMap((d) => d.rows);

const POST_NOUNS: Readonly<Record<TimelineId, string>> = {
  announce: "announcement",
  evening_before: "evening-before reminder",
  morning_of: "morning-of reminder",
  hour_before: "hour-before reminder",
};

/** A post as a sentence names it: "announcement", "hour-before reminder" (after "the"). */
export const postNoun = (row: Pick<TimelineRow, "id">): string => POST_NOUNS[row.id];

// --- What each channel sends -------------------------------------------------------------------------

export const SHARE_CHANNELS = ["facebook", "instagram", "whatsapp"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];
export const CHANNEL_NAMES: Readonly<Record<ShareChannel, string>> = { facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" };

/** A channel's own words for a post, before any edit: Facebook's caption, Instagram's with its hashtags, WhatsApp's message. */
export function channelDraft(row: TimelineRow, channel: ShareChannel): string {
  return channel === "facebook" ? row.text : channel === "instagram" ? row.instagram : row.whatsapp;
}

/**
 * Exactly what a channel sends from the words shown: WhatsApp's message ends with the event link on
 * its own line (shown under the words and never edited, so the posts guard reads only the words);
 * Facebook and Instagram send the words as they are.
 */
export function channelMessage(channel: ShareChannel, words: string, eventUrl: string): string {
  if (channel !== "whatsapp" || !eventUrl || words.includes(eventUrl)) return words;
  return `${words.trimEnd()}\n${eventUrl}`;
}

/** Facebook's share dialog for the event page. It takes the link only, so the words are copied to paste. */
export const facebookShareUrl = (eventUrl: string): string => shareLinks(eventUrl, "").facebook;

/** WhatsApp's share sheet with exactly this message, nothing added. */
export const whatsappShareUrl = (message: string): string => `https://wa.me/?text=${encodeURIComponent(message)}`;

// --- The calendar file of reminders -----------------------------------------------------------------

const icsText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsStamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Folds a content line at 75 octets, as the format asks (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (bytes.encode(current + char).length > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * A calendar file with one event at each reminder's time: its caption and the event link in the
 * description, and an alert at that minute, so the manager is reminded to post on time. Plain text,
 * no tracking, nothing sent anywhere. Null when there is no reminder left to add.
 */
export function remindersCalendar(rows: readonly TimelineRow[], options: { planId: string; storeName: string; eventUrl: string; stamp: Date }): string | null {
  const timed = rows.filter((r): r is TimelineRow & { at: string } => r.at !== null);
  if (timed.length === 0) return null;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stoop//Event post reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const row of timed) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${options.planId}-${row.id}@stoop`,
      `DTSTAMP:${icsStamp(options.stamp)}`,
      `DTSTART:${icsStamp(new Date(row.at))}`,
      "DURATION:PT15M",
      `SUMMARY:${icsText(`Post the ${postNoun(row)} for ${options.storeName}`)}`,
      `DESCRIPTION:${icsText(`${row.text}\n\nEvent page: ${options.eventUrl}`)}`,
      `URL:${options.eventUrl}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`Time to post the ${postNoun(row)}`)}`,
      "TRIGGER:PT0M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
