// WebVTT captions for a concept, from its scene timings: one cue per spoken line (bottom of the frame,
// the default position) and one per overlay line (near the top, "line:10%"), so an editor can import
// both tracks. Null when the concept has neither, since a silent clip with no text needs no captions.
//
// Source (read Oct 16, 2026): https://www.w3.org/TR/webvtt1/ (the file starts with "WEBVTT"; cues are
// "hh:mm:ss.ttt --> hh:mm:ss.ttt" plus optional settings such as "line:10%"; identifiers are unique;
// cue text writes "&" and "<" as "&amp;" and "&lt;" and never holds "-->", so ">" is escaped as
// "&gt;" too).
import type { Concept } from "../brief";
import { timecodes } from "../lines";

/** "00:00:03.000" */
export function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

const escapeCue = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s+/g, " ").trim();

export function conceptCaptions(concept: Concept): string | null {
  const spans = timecodes(concept);
  const cues: string[] = [];
  concept.scenes.forEach((scene, index) => {
    const timing = `${vttTime(spans[index].start)} --> ${vttTime(spans[index].end)}`;
    if (scene.dialogue) cues.push(`scene-${index + 1}-voice\n${timing}\n${escapeCue(scene.dialogue)}`);
    // An overlay that only repeats the spoken line would show the same words twice.
    if (scene.overlayText && escapeCue(scene.overlayText) !== escapeCue(scene.dialogue ?? "")) {
      cues.push(`scene-${index + 1}-text\n${timing} line:10%\n${escapeCue(scene.overlayText)}`);
    }
  });
  return cues.length === 0 ? null : `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
