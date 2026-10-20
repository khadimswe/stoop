"use client";

import { ThumbsDown } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "cn";
import { useLiveActions, type ReviseField } from "./live-actions";

/** The note's limit, as the API caps it (lib/api/requests.ts REASON_MAX). */
const NOTE_MAX = 280;

/** Only what happens: which picks are left out, and that a new take is written. Whether Qloo is asked again shows in the agent's own steps. */
function blurb(field: ReviseField, excluded: number): string {
  if (field === "world") return "Stoop writes a new take on this world's brief from the same Qloo candidates, then shows what changed and why.";
  const picks = excluded === 1 ? "the 1 Qloo pick" : `the ${excluded} Qloo picks`;
  return `Stoop leaves out ${excluded > 0 ? picks : "the Qloo picks"} behind this cue and writes a new take. You see what changed and why.`;
}

function ReviseForm({ segmentId, field, exclude, title, onDone }: { segmentId: string; field: ReviseField; exclude: string[]; title: string; onDone: () => void }) {
  const live = useLiveActions();
  const id = useId();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!live) return null;
  const busy = sending || ["sending", "revising"].includes(live.revisions[segmentId]?.state ?? "");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setSending(true);
    setMessage(null);
    const answer = await live.requestRevision({ segmentId, field, reason: note.trim(), exclude });
    setSending(false);
    if (answer.ok) onDone();
    else setMessage(answer.message);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-note`} className="text-sm font-semibold">
          What feels off? <span className="font-normal text-ink-soft">(optional)</span>
        </Label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          rows={3}
          aria-describedby={`${id}-help`}
          className="min-h-20 w-full resize-y rounded-lg border-[1.5px] border-concrete-line bg-surface px-3 py-2 text-base sm:text-sm"
        />
        <p id={`${id}-help`} className="text-xs text-ink-soft">
          <span className="font-mono">
            {note.length} of {NOTE_MAX}
          </span>{" "}
          · Your note goes to the agent as quoted data, never as instructions.
        </p>
      </div>
      <p role="status" aria-live="polite" className={cn("text-sm", message ? "text-ink" : "sr-only")}>
        {message ?? ""}
      </p>
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? "Sending" : "Revise"}
      </Button>
    </form>
  );
}

/**
 * "Not this vibe" on one Culture Brief field, or on the whole world (live reports only; it renders
 * nothing on examples). A popover on desktop, a bottom sheet on phones.
 */
export function NotThisVibe({
  segmentId,
  field,
  label,
  exclude = [],
  className,
}: {
  segmentId: string;
  field: ReviseField;
  label: string;
  /** The field's Qloo picks to leave out; empty for a whole world. */
  exclude?: string[];
  className?: string;
}) {
  const live = useLiveActions();
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const [open, setOpen] = useState(false);
  if (!live) return null;
  const title = `Not this vibe: ${label}`;
  const trigger = (
    <Button variant="ghost" size="sm" className={cn("h-11 gap-1.5 px-3 text-ink-soft hover:text-ink sm:h-9", className)} aria-label={title}>
      <ThumbsDown aria-hidden="true" />
      Not this vibe
    </Button>
  );
  const body = <ReviseForm segmentId={segmentId} field={field} exclude={exclude} title={title} onDone={() => setOpen(false)} />;

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} collisionPadding={12} aria-label={title} className="w-88 gap-2 rounded-xl border border-hairline bg-surface p-4 shadow-l2 ring-0">
          <p className="font-display text-lg leading-snug font-bold [font-stretch:90%]">{title}</p>
          <p className="text-sm text-ink-soft">{blurb(field, exclude.length)}</p>
          {body}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl border-t border-hairline bg-surface px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0">
          <SheetTitle className="font-display text-lg font-bold [font-stretch:90%]">{title}</SheetTitle>
          <SheetDescription className="text-ink-soft">{blurb(field, exclude.length)}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Where this world's latest revision stands, in plain words. `announce` makes it a live region (one
 * place per world announces it).
 */
export function ReviseStatus({ segmentId, announce = false, href }: { segmentId: string; announce?: boolean; href?: string }) {
  const live = useLiveActions();
  const note = live?.revisions[segmentId];
  const text = !note
    ? null
    : note.state === "sending"
      ? "Sending your note."
      : note.state === "revising"
        ? note.field === "world"
          ? "Revising: writing a new take on this world. What changed shows here when it lands."
          : "Revising: leaving out the picks behind this cue and writing a new take. What changed shows here when it lands."
        : note.state === "done"
          ? "Revised. What changed is marked below, with the old receipts kept."
          : note.message;
  if (!live) return null;
  return (
    <p role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined} className={cn("text-sm text-ink-soft", !text && "sr-only")}>
      {text}
      {text && note?.state === "done" && href && (
        <>
          {" "}
          <a href={href} className="font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
            See what changed
          </a>
        </>
      )}
    </p>
  );
}
