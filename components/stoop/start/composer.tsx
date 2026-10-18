"use client";

import { CircleAlert, Info } from "lucide-react";
import Link from "next/link";
import { useId, useRef, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { DEFAULT_FORMAT, DESCRIPTION_MAX, DESCRIPTION_MIN } from "@/lib/run/start";
import { RegionChip } from "./region-chip";

export type ComposerMode = "link" | "describe";

/** A plain note under the composer, optionally with a way into an example run. */
export interface ComposerNotice {
  text: string;
  example?: { href: string; label: string };
}

const FIELD = "w-full rounded-lg border border-concrete-line bg-fill px-3 text-base text-ink placeholder:text-ink-soft aria-invalid:border-ink";

/**
 * Step 1, "What are you selling?": the store or product link first, a description as the fallback,
 * the format and the region, and "Read my page" (the one brick action). Validation is inline and
 * plain; the parent owns the values so "Edit link" comes back to them.
 */
export function Composer({
  mode,
  onModeChange,
  link,
  onLinkChange,
  description,
  onDescriptionChange,
  region,
  onRegionChange,
  error,
  notice,
  reading,
  onSubmit,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  link: string;
  onLinkChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  region: string;
  onRegionChange: (value: string) => void;
  error: string | null;
  notice: ComposerNotice | null;
  reading: boolean;
  onSubmit: () => void;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const errorId = `${id}-error`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const switchMode = () => {
    onModeChange(mode === "link" ? "describe" : "link");
    // The other field takes the place of this one: put the cursor there.
    window.setTimeout(() => field.current?.focus(), 0);
  };

  return (
    <form noValidate onSubmit={submit} aria-busy={reading} className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-l1 sm:p-5">
      {mode === "link" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-link`} className="text-[0.8125rem] font-semibold">
            Store or product link
          </label>
          <input
            ref={field}
            id={`${id}-link`}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://yourstore.com/products/..."
            value={link}
            onChange={(event) => onLinkChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(FIELD, "h-11")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-description`} className="text-[0.8125rem] font-semibold">
            Describe your product
          </label>
          <textarea
            ref={field}
            id={`${id}-description`}
            rows={4}
            maxLength={DESCRIPTION_MAX}
            placeholder="What it is, what it costs, what makes it different."
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-count${error ? ` ${errorId}` : ""}`}
            className={cn(FIELD, "resize-y py-2.5 leading-6")}
          />
          <p id={`${id}-count`} className="font-mono text-xs text-ink-soft">
            {description.trim().length} of {DESCRIPTION_MAX.toLocaleString("en-US")} · {DESCRIPTION_MIN} characters or more
          </p>
        </div>
      )}

      <button type="button" onClick={switchMode} className="-my-1.5 inline-flex min-h-11 items-center self-start rounded-sm text-[0.8125rem] font-semibold text-ink underline decoration-1 underline-offset-4 hover:decoration-brick">
        {mode === "link" ? "No website? Describe it instead" : "Use a link instead"}
      </button>

      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-2 text-sm font-semibold text-ink">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-fill px-3 py-2.5 text-sm text-ink">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-soft" />
          <p>
            {notice.text}
            {notice.example && (
              <>
                {" "}
                <Link href={notice.example.href} className="font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
                  {notice.example.label}
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      {reading && (
        <p role="status" className="text-sm text-ink-soft">
          {mode === "link" ? "Reading 1 page" : "Reading your description"}, then checking seed suggestions in Qloo. This can take up to a minute.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        <span className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-fill px-3 text-[0.8125rem] text-ink">
          <span className="sr-only text-ink-soft sm:not-sr-only">Format:</span>
          <span className="font-semibold">{DEFAULT_FORMAT}</span>
        </span>
        <RegionChip region={region} onChange={onRegionChange} disabled={reading} />
        <Button type="submit" disabled={reading} className="w-full sm:ml-auto sm:w-auto">
          {reading ? "Reading…" : mode === "link" ? "Read my page" : "Next"}
        </Button>
      </div>
    </form>
  );
}
